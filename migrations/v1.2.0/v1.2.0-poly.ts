import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description = 'Add poly_* tables for Polymarket bot (Phase A + C)';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS poly_markets (
        slug TEXT PRIMARY KEY,
        condition_id TEXT NOT NULL,
        question TEXT NOT NULL,
        category TEXT,
        outcomes_json TEXT NOT NULL,
        volume_24h REAL NOT NULL DEFAULT 0,
        liquidity REAL NOT NULL DEFAULT 0,
        end_date INTEGER NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0,
        resolution TEXT,
        last_scan_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_poly_markets_volume ON poly_markets(volume_24h DESC);
      CREATE INDEX IF NOT EXISTS idx_poly_markets_end ON poly_markets(end_date);

      CREATE TABLE IF NOT EXISTS poly_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        outcome_token_id TEXT NOT NULL,
        outcome_label TEXT NOT NULL,
        market_price REAL NOT NULL,
        estimated_prob REAL NOT NULL,
        edge_pct REAL NOT NULL,
        confidence TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        contrarian TEXT,
        approved INTEGER NOT NULL,
        rejection_reasons TEXT,
        paper_trade_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_poly_signals_created ON poly_signals(created_at DESC);

      CREATE TABLE IF NOT EXISTS poly_paper_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        outcome_token_id TEXT NOT NULL,
        outcome_label TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        size_usd REAL NOT NULL,
        shares REAL NOT NULL,
        kelly_fraction REAL NOT NULL,
        strategy TEXT NOT NULL,
        status TEXT NOT NULL,
        resolved_at INTEGER,
        realized_pnl REAL,
        voided_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_poly_paper_trades_status ON poly_paper_trades(status);

      CREATE TABLE IF NOT EXISTS poly_positions (
        paper_trade_id INTEGER PRIMARY KEY REFERENCES poly_paper_trades(id),
        market_slug TEXT NOT NULL,
        current_price REAL NOT NULL,
        unrealized_pnl REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS poly_price_history (
        token_id TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        price REAL NOT NULL,
        PRIMARY KEY (token_id, captured_at)
      );

      CREATE TABLE IF NOT EXISTS poly_eval_cache (
        cache_key TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        outcome_token_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        probability REAL NOT NULL,
        confidence TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        contrarian TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_poly_eval_cache_created ON poly_eval_cache(created_at);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }
}
