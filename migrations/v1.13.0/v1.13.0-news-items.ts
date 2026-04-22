import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add news_items table for Sprint 18 news-sync revival (kind=shell via Perplexity REST API)';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * news-sync was paused 2026-04-20 (per scripts/migrate-cron-kinds.ts:5)
 * because the original kind=claude-agent task required Perplexity MCP
 * access that headless Node lacks. Sprint 18 (plan cheerful-rossum B8)
 * revives it as kind=shell via direct Perplexity REST API.
 *
 * news_items differs from research_items (Sprint 4):
 *   - news_items = short Perplexity summaries on a 2h cadence
 *   - research_items = long-form articles from RSS/Atom on a daily cadence
 *
 * prompt_hash dedupes near-duplicate runs: the same prompt against
 * Perplexity often returns substantively the same summary within a tick
 * window, and we don't want to inflate row count when nothing changed.
 *
 * raw_json keeps the full Perplexity response (citations, model, usage)
 * so future analyzers can mine for trends without re-querying.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS news_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        fetched_at    INTEGER NOT NULL,
        prompt_hash   TEXT NOT NULL,
        summary       TEXT NOT NULL,
        raw_json      TEXT,
        model         TEXT,
        status        TEXT NOT NULL DEFAULT 'ok'
      );
      CREATE INDEX IF NOT EXISTS idx_news_items_fetched
        ON news_items(fetched_at DESC);
      CREATE INDEX IF NOT EXISTS idx_news_items_hash
        ON news_items(prompt_hash);
    `);
  } finally {
    db.close();
  }
}
