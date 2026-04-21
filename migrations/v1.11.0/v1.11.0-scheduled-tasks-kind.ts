import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add kind + script_path to scheduled_tasks so non-agentic crons skip the Claude CLI';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * 2026-04-20 scheduler exorcism. The 2026-04-13 trading-only pivot did
 * not migrate the scheduler off @anthropic-ai/claude-agent-sdk. Every
 * cron fire still spawns the claude CLI, which:
 *   - is ToS grey area for headless production use of Max OAuth, and
 *   - can hang silently when ANTHROPIC_API_KEY is blank (observed during
 *     the 2026-04-20 halt — subprocess initialized a session but never
 *     completed, holding the messageQueue chain on ALLOWED_CHAT_ID).
 *
 * This migration adds two columns. `scripts/migrate-cron-kinds.ts` then
 * routes three of the four crons (news-sync, research-ingest,
 * resolution-fetch) to kind='shell' which spawns `npx tsx <script_path>`
 * directly. adversarial-review remains kind='claude-agent' (legitimately
 * agentic) with a runtime auth preflight.
 *
 * Idempotent via PRAGMA table_info check (ALTER TABLE ADD COLUMN is not
 * idempotent in SQLite). Default 'claude-agent' preserves behavior for
 * every existing row.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    const cols = (db.prepare(`PRAGMA table_info(scheduled_tasks)`).all() as Array<{ name: string }>).map(c => c.name);
    if (!cols.includes('kind')) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'claude-agent'`);
    }
    if (!cols.includes('script_path')) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN script_path TEXT`);
    }
  } finally {
    db.close();
  }
}
