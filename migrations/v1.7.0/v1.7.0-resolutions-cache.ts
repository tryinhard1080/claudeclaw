import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description = 'Add poly_resolutions cache table for Sprint 5 backtesting';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * Resolution cache — stores the last-seen market state for slugs we've
 * evaluated. `closed=1` with a single price=1 outcome means resolved;
 * otherwise the slug is still open and backtesting will skip it.
 * outcomes_json mirrors the Market.outcomes shape so we can feed it
 * back into classifyResolution() without re-parsing gamma payloads.
 * slug is PK — one row per market regardless of how many times we
 * re-fetch.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS poly_resolutions (
        slug          TEXT PRIMARY KEY,
        closed        INTEGER NOT NULL,
        outcomes_json TEXT NOT NULL,
        fetched_at    INTEGER NOT NULL,
        resolved_at   INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_poly_resolutions_closed
        ON poly_resolutions(closed);
      CREATE INDEX IF NOT EXISTS idx_poly_resolutions_fetched
        ON poly_resolutions(fetched_at DESC);
    `);
  } finally {
    db.close();
  }
}
