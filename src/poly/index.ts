import type { Bot, Context } from 'grammy';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import {
  POLY_ENABLED,
  POLY_SCAN_INTERVAL_MIN,
  POLY_TIMEZONE,
  POLY_DIGEST_HOUR,
  POLY_CALIBRATION_HOUR,
  POLY_CALIBRATION_BRIER_ALERT,
  POLY_CALIBRATION_LOOKBACK_DAYS,
  POLY_REGIME_REFRESH_MIN,
} from '../config.js';
import { MarketScanner } from './market-scanner.js';
import { registerPolyCommands } from './telegram-commands.js';
import { composeDigest, shouldRunDigest } from './digest.js';
import { StrategyEngine } from './strategy-engine.js';
import { PnlTracker } from './pnl-tracker.js';
import { registerPolyAlerts } from './alerts.js';
import {
  composeSnapshot, persistSnapshot,
  shouldRunCalibration, formatCalibrationAlert, todayYmd,
} from './calibration.js';
import {
  composeRegimeSnapshot, fetchRegimeInputs, latestRegimeSnapshot,
  persistRegimeSnapshot, shouldRunRegimeSnapshot, defaultHttpJson,
} from './regime.js';

type Sender = (text: string) => Promise<void>;

interface KvRow { key: string; value: string }

const polyKvGet = (db: Database.Database, key: string): string | null =>
  (db.prepare(`SELECT value FROM poly_kv WHERE key=?`).get(key) as KvRow | undefined)?.value ?? null;

const polyKvSet = (db: Database.Database, key: string, value: string): void => {
  db.prepare(
    `INSERT INTO poly_kv(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(key, value);
};

export interface InitPolyResult {
  scanner: MarketScanner;
  strategyEngine: StrategyEngine | null;
  pnlTracker: PnlTracker | null;
  stop: () => void;
}

export function initPoly(opts: {
  bot: Bot<Context>;
  sender: Sender;
  db: Database.Database;
}): InitPolyResult {
  if (!POLY_ENABLED) {
    logger.info('POLY_ENABLED=false — polymarket module disabled');
    return {
      scanner: null as unknown as MarketScanner,
      strategyEngine: null, pnlTracker: null,
      stop: () => {},
    };
  }

  // Poly-scoped kv table (no shared `kv` table exists in the DB).
  opts.db.exec(
    `CREATE TABLE IF NOT EXISTS poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );

  // Defensive: ensure poly_calibration_snapshots exists even on upgraded
  // installs that haven't run `npm run migrate` yet. Migration state is
  // tracked outside the DB; without this guard, the daily calibration
  // pass would throw "no such table" every 5 minutes all day.
  opts.db.exec(`
    CREATE TABLE IF NOT EXISTS poly_calibration_snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    INTEGER NOT NULL,
      window_start  INTEGER NOT NULL,
      window_end    INTEGER NOT NULL,
      n_samples     INTEGER NOT NULL,
      brier_score   REAL,
      log_loss      REAL,
      win_rate      REAL,
      curve_json    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_poly_calibration_created
      ON poly_calibration_snapshots(created_at DESC);
  `);

  // by_regime_json (Sprint 3) — idempotent add for installs that ran the
  // v1.3.0 migration before v1.5.0 existed. Same PRAGMA-guard pattern as
  // in the migration itself.
  const calCols = new Set(
    (opts.db.prepare(`PRAGMA table_info(poly_calibration_snapshots)`).all() as Array<{ name: string }>)
      .map(c => c.name),
  );
  if (!calCols.has('by_regime_json')) {
    opts.db.exec(`ALTER TABLE poly_calibration_snapshots ADD COLUMN by_regime_json TEXT`);
  }

  // Sprint 1.5 drift dashboards — scan run log. Defensive IF NOT EXISTS
  // so upgraded installs don't crash on the scanner's first recordScanRun.
  opts.db.exec(`
    CREATE TABLE IF NOT EXISTS poly_scan_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at   INTEGER NOT NULL,
      duration_ms  INTEGER,
      market_count INTEGER,
      status       TEXT NOT NULL,
      error        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_poly_scan_runs_started
      ON poly_scan_runs(started_at DESC);
  `);

  // v1.10.0 — defensive index on poly_price_history.captured_at. Without
  // it, pruneOldPrices does a full table scan on ~43M rows and the WAL
  // outruns the auto-checkpoint. See migrations/v1.10.0/ and
  // docs/research/sprint-scanner-bloat-fix.md.
  opts.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_poly_price_history_captured
      ON poly_price_history(captured_at);
  `);

  // Sprint 3: regime snapshots table. Defensive create so an upgraded
  // install without `npm run migrate` doesn't crash every 5 minutes.
  opts.db.exec(`
    CREATE TABLE IF NOT EXISTS poly_regime_snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    INTEGER NOT NULL,
      vix           REAL,
      btc_dominance REAL,
      yield_10y     REAL,
      regime_label  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_poly_regime_snapshots_created
      ON poly_regime_snapshots(created_at DESC);
  `);

  const scanner = new MarketScanner(opts.db, POLY_SCAN_INTERVAL_MIN * 60_000);

  // Phase C: strategy engine + P&L tracker + alerts. Engine subscribes to
  // scanner `scan_complete` in its constructor, so it must be built BEFORE
  // scanner.start() to avoid missing the first tick.
  const strategyEngine = new StrategyEngine({ db: opts.db, scanner });
  const pnlTracker = new PnlTracker(opts.db);
  registerPolyAlerts({ strategyEngine, pnlTracker, sender: opts.sender });
  pnlTracker.start();
  scanner.start();
  registerPolyCommands(opts.bot, opts.db);

  // Digest tick — every 5 minutes, fires at most once per target-tz day.
  // `digestInFlight` + explicit .catch() guard against two failure modes:
  //   (1) A slow/hung sender would otherwise let subsequent 5-min ticks see
  //       the same unwritten last_digest_ymd and fire the digest again.
  //   (2) A sender rejection would bypass the outer try/catch (it's inside
  //       a promise chain), causing unhandled rejections to accumulate.
  let digestInFlight = false;
  let regimeInFlight = false;
  const digestTimer = setInterval(() => {
    try {
      if (digestInFlight) return;
      const lastYmd = polyKvGet(opts.db, 'poly.last_digest_ymd');
      if (
        shouldRunDigest({
          hour: POLY_DIGEST_HOUR,
          timezone: POLY_TIMEZONE,
          now: new Date(),
          lastRunYmd: lastYmd,
        })
      ) {
        const { text, ymd } = composeDigest(opts.db);
        digestInFlight = true;
        opts
          .sender(text)
          .then(() => polyKvSet(opts.db, 'poly.last_digest_ymd', ymd))
          .catch(err => logger.error({ err: String(err) }, 'digest send failed'))
          .finally(() => { digestInFlight = false; });
      }

      // Daily calibration tick — gated by last-run-ymd so it fires once per
      // target-timezone day. Alert only if we persisted a snapshot and it
      // breached the Brier threshold with n >= MIN_ALERT_SAMPLES.
      // Stamp logic (codex-review P2):
      //   - no samples: stamp (nothing to retry).
      //   - persisted, no alert: stamp (work is done).
      //   - alert fires: stamp ONLY on successful send so a transient
      //     Telegram outage lets the next tick retry the alert today.
      const lastCal = polyKvGet(opts.db, 'poly.last_calibration_ymd');
      if (
        shouldRunCalibration({
          hour: POLY_CALIBRATION_HOUR,
          timezone: POLY_TIMEZONE,
          now: new Date(),
          lastRunYmd: lastCal,
        })
      ) {
        const snap = composeSnapshot(opts.db, Date.now(), POLY_CALIBRATION_LOOKBACK_DAYS);
        const ymd = todayYmd(new Date(), POLY_TIMEZONE);
        if (snap === null) {
          polyKvSet(opts.db, 'poly.last_calibration_ymd', ymd);
        } else {
          persistSnapshot(opts.db, snap);
          const alert = formatCalibrationAlert(snap, POLY_CALIBRATION_BRIER_ALERT);
          if (alert === null) {
            polyKvSet(opts.db, 'poly.last_calibration_ymd', ymd);
          } else {
            opts
              .sender(alert)
              .then(() => polyKvSet(opts.db, 'poly.last_calibration_ymd', ymd))
              .catch(err => logger.warn({ err: String(err) }, 'calibration alert send failed; will retry next tick'));
          }
        }
      }
      // Regime refresh tick — gated by last snapshot's created_at so a
      // slow or failing upstream doesn't re-fire every 5 minutes. Network
      // errors are isolated inside fetchRegimeInputs (per-upstream
      // try/catch) so a persistent snapshot always lands even if one or
      // two components fall back to 'unk'. regimeInFlight guards against
      // overlapping HTTP cycles when one call hangs past the next tick.
      if (!regimeInFlight) {
        const last = latestRegimeSnapshot(opts.db);
        if (shouldRunRegimeSnapshot({
          refreshMinutes: POLY_REGIME_REFRESH_MIN,
          lastRunAtSec: last?.createdAt ?? null,
          nowSec: Math.floor(Date.now() / 1000),
        })) {
          regimeInFlight = true;
          fetchRegimeInputs(defaultHttpJson)
            .then(inputs => {
              const snap = composeRegimeSnapshot(inputs, Math.floor(Date.now() / 1000));
              persistRegimeSnapshot(opts.db, snap);
              logger.info({ regime: snap.regimeLabel, vix: snap.vix, btcDom: snap.btcDominance, y10: snap.yield10y }, 'regime snapshot captured');
            })
            .catch(err => logger.warn({ err: String(err) }, 'regime snapshot failed (skipping tick)'))
            .finally(() => { regimeInFlight = false; });
        }
      }
    } catch (err) {
      logger.error({ err: String(err) }, 'digest tick failed');
    }
  }, 5 * 60_000);

  logger.info('Polymarket module initialized (Phase C: scanner + strategy + pnl tracker)');
  return {
    scanner,
    strategyEngine,
    pnlTracker,
    stop: () => {
      scanner.stop();
      pnlTracker.stop();
      clearInterval(digestTimer);
    },
  };
}
