import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description = 'Add prompt_version + model columns to poly_signals (Sprint 2 strategy versioning)';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * SQLite ADD COLUMN is idempotency-unfriendly (it throws "duplicate column")
 * if the column already exists, unlike CREATE TABLE IF NOT EXISTS. We guard
 * by inspecting PRAGMA table_info first so rerunning the migration is safe.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info(poly_signals)`).all() as Array<{ name: string }>)
        .map(c => c.name),
    );
    if (!existing.has('prompt_version')) {
      db.exec(`ALTER TABLE poly_signals ADD COLUMN prompt_version TEXT`);
    }
    if (!existing.has('model')) {
      db.exec(`ALTER TABLE poly_signals ADD COLUMN model TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_poly_signals_version ON poly_signals(prompt_version)`);
  } finally {
    db.close();
  }
}
