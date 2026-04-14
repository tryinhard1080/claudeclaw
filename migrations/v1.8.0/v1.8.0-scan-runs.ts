import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description = 'Add poly_scan_runs table for Sprint 1.5 drift dashboards';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * One row per scan tick. Tracks duration + market count + error flag so
 * drift.ts can compute p50/p95/p99 latency and market-count anomalies
 * over rolling windows. Status 'ok' = successful scan; 'error' = upstream
 * failure (count/duration may be null). Retention is unbounded for now;
 * ~288 rows/day at 5-min cadence = ~105k/year, negligible.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
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
  } finally {
    db.close();
  }
}
