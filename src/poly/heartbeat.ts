import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { STORE_DIR, POLY_SCAN_INTERVAL_MIN } from '../config.js';
import { logger } from '../logger.js';

type Sender = (text: string) => Promise<void>;

/**
 * Three alert signals on one timer, keyed so a given alert type fires
 * at most once per throttle window. Reuses the same "per-type + per-
 * target" pattern as TradingAlertManager.
 */
type AlertKey = 'scan_stale' | 'wal_size' | 'db_size';

export interface HeartbeatOptions {
  /** Poll interval in ms. Default 60_000 (1 min). */
  pollMs?: number;
  /** Scan is considered stale after this many minutes with no 'ok' row. Default 2 * POLY_SCAN_INTERVAL_MIN. */
  staleMinutes?: number;
  /** Seconds of bot uptime before any alert is eligible to fire. Default 300 (5 min). */
  graceSeconds?: number;
  /** WAL size alert threshold in bytes. Default 100 MB. */
  walWarnBytes?: number;
  /** DB file size alert threshold in bytes. Default 500 MB. */
  dbWarnBytes?: number;
  /** Throttle per-alert-type in ms. Default 900_000 (15 min). */
  throttleMs?: number;
  /** Override clock for tests. */
  now?: () => number;
}

/**
 * Scan heartbeat + storage-size watchdog.
 *
 * Purpose: the 2026-04-20 scanner hang went undetected for 83 minutes
 * because pino was silent and no scan-run rows were being written. A
 * heartbeat that samples poly_scan_runs independently of pino and pm2
 * pings the operator the moment the cadence breaks.
 *
 * Three alerts:
 *   - scan_stale: MAX(started_at) older than 2 × scan interval.
 *   - wal_size: claudeclaw.db-wal > 100 MB (checkpointer falling behind).
 *   - db_size: claudeclaw.db > 500 MB (unpruned data accumulating).
 *
 * All three throttle to one send per 15 min. Returns a stop() fn.
 */
export function startScanHeartbeat(
  db: Database.Database,
  sender: Sender,
  opts: HeartbeatOptions = {},
): () => void {
  const pollMs = opts.pollMs ?? 60_000;
  const staleMinutes = opts.staleMinutes ?? 2 * POLY_SCAN_INTERVAL_MIN;
  const staleThresholdMs = staleMinutes * 60_000;
  const graceMs = (opts.graceSeconds ?? 300) * 1000;
  const walWarn = opts.walWarnBytes ?? 100 * 1024 * 1024;
  const dbWarn = opts.dbWarnBytes ?? 500 * 1024 * 1024;
  const throttleMs = opts.throttleMs ?? 15 * 60_000;
  const now = opts.now ?? (() => Date.now());

  const startedAt = now();
  const lastAlertAt = new Map<AlertKey, number>();

  function throttledSend(key: AlertKey, text: string): void {
    const last = lastAlertAt.get(key);
    if (last !== undefined && now() - last < throttleMs) return;
    lastAlertAt.set(key, now());
    sender(text).catch(err =>
      logger.warn({ err: String(err), key }, 'heartbeat alert send failed'),
    );
  }

  function check(): void {
    if (now() - startedAt < graceMs) return;

    // scan_stale
    try {
      const row = db
        .prepare(`SELECT MAX(started_at) AS last FROM poly_scan_runs WHERE status = 'ok'`)
        .get() as { last: number | null } | undefined;
      const lastOk = row?.last ?? null;
      const lastAgeMs = lastOk === null ? Infinity : now() - lastOk * 1000;
      if (lastAgeMs > staleThresholdMs) {
        const ageMin = Math.floor(lastAgeMs / 60_000);
        const lastStr = lastOk === null ? 'never' : new Date(lastOk * 1000).toISOString();
        throttledSend(
          'scan_stale',
          `🚨 Heartbeat: no successful poly scan in ${ageMin} min (last: ${lastStr}). PID ${process.pid}. Check pm2 logs.`,
        );
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'heartbeat scan_stale check failed');
    }

    // wal_size + db_size
    try {
      const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
      const walPath = dbPath + '-wal';
      const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
      const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
      if (walSize > walWarn) {
        throttledSend(
          'wal_size',
          `⚠️ WAL is ${Math.round(walSize / 1024 / 1024)} MB (threshold ${Math.round(walWarn / 1024 / 1024)} MB). Checkpointer may be blocked.`,
        );
      }
      if (dbSize > dbWarn) {
        throttledSend(
          'db_size',
          `⚠️ DB file is ${Math.round(dbSize / 1024 / 1024)} MB (threshold ${Math.round(dbWarn / 1024 / 1024)} MB). Investigate poly_price_history growth.`,
        );
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'heartbeat size check failed');
    }
  }

  const timer = setInterval(check, pollMs);
  logger.info(
    { pollMs, staleMinutes, walWarnMb: Math.round(walWarn / 1024 / 1024), dbWarnMb: Math.round(dbWarn / 1024 / 1024) },
    'poly scan heartbeat started',
  );
  return () => clearInterval(timer);
}

/**
 * Pure core used by the tests. Takes a sample-time and returns alerts
 * that would fire (without actually sending). Extracted so tests can
 * stub the DB + filesystem + clock without spinning setInterval.
 */
export interface HeartbeatSample {
  lastOkAtSec: number | null;
  walSizeBytes: number;
  dbSizeBytes: number;
  nowMs: number;
  uptimeMs: number;
}

export interface HeartbeatCheckResult {
  alerts: AlertKey[];
  details: Record<AlertKey, string>;
}

export function computeHeartbeatAlerts(
  sample: HeartbeatSample,
  cfg: Required<Pick<HeartbeatOptions, 'staleMinutes' | 'graceSeconds' | 'walWarnBytes' | 'dbWarnBytes'>>,
): HeartbeatCheckResult {
  const result: HeartbeatCheckResult = { alerts: [], details: {} as Record<AlertKey, string> };
  if (sample.uptimeMs < cfg.graceSeconds * 1000) return result;

  const staleThresholdMs = cfg.staleMinutes * 60_000;
  const lastAgeMs = sample.lastOkAtSec === null ? Infinity : sample.nowMs - sample.lastOkAtSec * 1000;
  if (lastAgeMs > staleThresholdMs) {
    result.alerts.push('scan_stale');
    result.details.scan_stale = `stale ${Math.floor(lastAgeMs / 60_000)}min`;
  }
  if (sample.walSizeBytes > cfg.walWarnBytes) {
    result.alerts.push('wal_size');
    result.details.wal_size = `wal ${Math.round(sample.walSizeBytes / 1024 / 1024)}MB`;
  }
  if (sample.dbSizeBytes > cfg.dbWarnBytes) {
    result.alerts.push('db_size');
    result.details.db_size = `db ${Math.round(sample.dbSizeBytes / 1024 / 1024)}MB`;
  }
  return result;
}
