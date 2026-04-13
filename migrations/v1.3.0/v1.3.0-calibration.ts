import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description = 'Add poly_calibration_snapshots for Sprint 1 (calibration tracker)';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
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
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }
}
