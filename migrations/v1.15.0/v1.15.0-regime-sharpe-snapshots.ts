import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add regime_sharpe_snapshots table for Sprint S1 Box-3 Sharpe instrumentation';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * Sprint S1 (docs/research/sprint-s1-sharpe-instrumentation.md §4.1).
 * Per-instance daily equity snapshots with rolling 60d Sharpe computed
 * at write time. UNIQUE(instance, snapshot_date) makes the daily cron
 * idempotent — a manual re-run on the same day overwrites via
 * INSERT OR REPLACE rather than producing a duplicate row.
 *
 * source defaults to 'state_json' because v1 reads from regime-trader
 * state.json; future sources (Alpaca direct API, backtest replay) can
 * tag rows distinctly.
 *
 * daily_return and rolling_sharpe_60d are nullable so day 1 (no prior
 * equity) and days 1-2 of a fresh window (insufficient std-dev) can
 * still be recorded without polluting Sharpe with sentinel values.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS regime_sharpe_snapshots (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        instance        TEXT    NOT NULL,
        snapshot_date   TEXT    NOT NULL,
        equity          REAL    NOT NULL,
        cash            REAL,
        peak_equity     REAL,
        daily_return    REAL,
        rolling_sharpe_60d  REAL,
        n_days          INTEGER NOT NULL,
        source          TEXT    NOT NULL DEFAULT 'state_json',
        created_at      INTEGER NOT NULL,
        UNIQUE(instance, snapshot_date)
      );
      CREATE INDEX IF NOT EXISTS idx_regime_sharpe_snapshots_instance_date
        ON regime_sharpe_snapshots(instance, snapshot_date DESC);
    `);
  } finally {
    db.close();
  }
}
