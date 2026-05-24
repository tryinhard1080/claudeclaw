import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add source_freshness table for full-capacity gate and source tracking';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS source_freshness (
        source_name      TEXT PRIMARY KEY,
        last_fetch_at    INTEGER,
        last_success_at  INTEGER,
        stale_after_sec  INTEGER NOT NULL,
        last_error       TEXT,
        used_by_signal   INTEGER NOT NULL DEFAULT 0,
        updated_at       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_source_freshness_success
        ON source_freshness(last_success_at DESC);
    `);
  } finally {
    db.close();
  }
}

