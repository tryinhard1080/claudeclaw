import { EventEmitter } from 'events';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { fetchActiveMarkets } from './gamma-client.js';
import type { Market } from './types.js';

export class MarketScanner extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(private db: Database.Database, private intervalMs: number) {
    super();
  }

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runOnce(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    const started = Date.now();
    try {
      const markets = await fetchActiveMarkets();
      upsertMarkets(this.db, markets);
      capturePrices(this.db, markets);
      pruneOldPrices(this.db);
      logger.info({ count: markets.length, ms: Date.now() - started }, 'poly scan complete');
      this.emit('scan_complete', { markets });
    } catch (err) {
      logger.error({ err: String(err) }, 'poly scan failed');
      this.emit('scan_error', { error: String(err) });
    } finally {
      this.scanning = false;
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
