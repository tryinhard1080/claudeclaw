import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description = 'Add research_items table for Sprint 4 research ingestion pipeline';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * url is UNIQUE — dedupes the same article appearing twice in a feed
 * (common for Substack edits) or across re-runs of the ingest cron.
 * upload_status tracks whether we pushed the item to NotebookLM; keeps
 * retry semantics simple.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS research_items (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        source         TEXT NOT NULL,
        url            TEXT NOT NULL UNIQUE,
        title          TEXT NOT NULL,
        published_at   INTEGER,
        fetched_at     INTEGER NOT NULL,
        tier           INTEGER NOT NULL,
        notebook       TEXT,
        snippet        TEXT,
        upload_status  TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_research_items_fetched
        ON research_items(fetched_at DESC);
      CREATE INDEX IF NOT EXISTS idx_research_items_source
        ON research_items(source);
      CREATE INDEX IF NOT EXISTS idx_research_items_upload
        ON research_items(upload_status);
    `);
  } finally {
    db.close();
  }
}
