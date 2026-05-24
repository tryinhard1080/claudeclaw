import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add equity_benchmark_snapshots table for regime-trader benchmark comparisons';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS equity_benchmark_snapshots (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        benchmark       TEXT    NOT NULL,
        snapshot_date   TEXT    NOT NULL,
        reference_price REAL,
        equity          REAL    NOT NULL,
        daily_return    REAL,
        source          TEXT    NOT NULL,
        created_at      INTEGER NOT NULL,
        UNIQUE(benchmark, snapshot_date)
      );
      CREATE INDEX IF NOT EXISTS idx_equity_benchmark_snapshots_date
        ON equity_benchmark_snapshots(benchmark, snapshot_date DESC);
    `);
  } finally {
    db.close();
  }
}
