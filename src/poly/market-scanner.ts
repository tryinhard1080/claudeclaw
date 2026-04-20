import { EventEmitter } from 'events';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { POLY_SCAN_DEBUG } from '../config.js';
import { fetchActiveMarkets } from './gamma-client.js';
import type { Market } from './types.js';
import { recordScanRun } from './drift.js';

// Diagnostic instrumentation for the 2026-04-20 scanner hang bug. Writes
// directly to process.stdout (bypassing pino's worker thread) so it produces
// output even if pino-pretty stalls. Enable with POLY_SCAN_DEBUG=1 in .env.
// Kept as a permanent knob — zero cost when off, single source of truth when on.
// POLY_SCAN_DEBUG is read via config.ts/readEnvFile so it respects the project's
// "don't leak env into child processes" convention.
function scanTrace(tag: string, extra: Record<string, unknown> = {}): void {
  if (!POLY_SCAN_DEBUG) return;
  const ts = new Date().toISOString();
  const kv = Object.entries(extra).map(([k, v]) => `${k}=${String(v)}`).join(' ');
  process.stdout.write(`[SCAN ${ts}] ${tag}${kv ? ' ' + kv : ''}\n`);
}

export class MarketScanner extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(private db: Database.Database, private intervalMs: number) {
    super();
  }

  start(): void {
    if (this.timer) return;
    scanTrace('start() scheduling first runOnce', { intervalMs: this.intervalMs });
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    scanTrace('start() returned; setInterval armed');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runOnce(): Promise<void> {
    scanTrace('runOnce entry', { scanning: this.scanning });
    if (this.scanning) return;
    this.scanning = true;
    const started = Date.now();
    try {
      scanTrace('pre-fetch');
      const markets = await fetchActiveMarkets();
      scanTrace('post-fetch', { count: markets.length, ms: Date.now() - started });
      upsertMarkets(this.db, markets);
      capturePrices(this.db, markets);
      pruneOldPrices(this.db);
      scanTrace('post-db');
      const duration = Date.now() - started;
      logger.info({ count: markets.length, ms: duration }, 'poly scan complete');
      // Sprint 1.5: persist per-run metrics for drift dashboards. Wrapped
      // in try/catch so a scan-run write failure can't break the tick.
      try {
        recordScanRun(this.db, {
          startedAt: Math.floor(started / 1000),
          durationMs: duration,
          marketCount: markets.length,
          status: 'ok',
        });
      } catch (e) {
        logger.warn({ err: String(e) }, 'recordScanRun failed');
      }
      this.emit('scan_complete', { markets });
      scanTrace('post-emit scan_complete');
    } catch (err) {
      scanTrace('catch', { err: String(err).slice(0, 120) });
      logger.error({ err: String(err) }, 'poly scan failed');
      try {
        recordScanRun(this.db, {
          startedAt: Math.floor(started / 1000),
          durationMs: null, marketCount: null,
          status: 'error', error: String(err).slice(0, 200),
        });
      } catch { /* table may not exist on pre-v1.8.0 installs */ }
      this.emit('scan_error', { error: String(err) });
    } finally {
      this.scanning = false;
      scanTrace('finally — scanning=false');
    }
  }
}

export function upsertMarkets(db: Database.Database, markets: Market[]): void {
  const stmt = db.prepare(`
    INSERT INTO poly_markets (slug, condition_id, question, category, outcomes_json, volume_24h, liquidity, end_date, closed, last_scan_at)
    VALUES (@slug, @condition_id, @question, @category, @outcomes_json, @volume_24h, @liquidity, @end_date, @closed, @last_scan_at)
    ON CONFLICT(slug) DO UPDATE SET
      question=excluded.question, category=excluded.category, outcomes_json=excluded.outcomes_json,
      volume_24h=excluded.volume_24h, liquidity=excluded.liquidity, end_date=excluded.end_date,
      closed=excluded.closed, last_scan_at=excluded.last_scan_at
  `);
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction((rows: Market[]) => {
    for (const m of rows) {
      stmt.run({
        slug: m.slug,
        condition_id: m.conditionId,
        question: m.question,
        category: m.category ?? null,
        outcomes_json: JSON.stringify(m.outcomes),
        volume_24h: m.volume24h,
        liquidity: m.liquidity,
        end_date: m.endDate,
        closed: m.closed ? 1 : 0,
        last_scan_at: now,
      });
    }
  });
  tx(markets);
}

export function capturePrices(db: Database.Database, markets: Market[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO poly_price_history (token_id, captured_at, price) VALUES (?, ?, ?)`,
  );
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction((rows: Market[]) => {
    for (const m of rows) for (const o of m.outcomes) stmt.run(o.tokenId, now, o.price);
  });
  tx(markets);
}

export function pruneOldPrices(db: Database.Database): void {
  const cutoff = Math.floor(Date.now() / 1000) - 36 * 3600;
  db.prepare(`DELETE FROM poly_price_history WHERE captured_at < ?`).run(cutoff);
}
