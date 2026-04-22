#!/usr/bin/env tsx
/**
 * Plan cheerful-rossum B9 — flip news-sync (3d623e0e) to kind=shell + active.
 *
 * Run AFTER:
 *   1. Operator has set PPLX_API_KEY in .env
 *   2. pm2 restart claudeclaw has run the v1.13.0 migration (news_items table)
 *
 * Idempotent. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/activate-news-sync.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';

const NEWS_SYNC_ID = '3d623e0e';

function main(): void {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  try {
    // Sanity: confirm news_items table exists (v1.13.0 migration ran)
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='news_items'`,
    ).get() as { name: string } | undefined;
    if (!tableCheck) {
      console.error('[activate-news-sync] FAILED: news_items table not present.');
      console.error('[activate-news-sync] Migration v1.13.0 has not run. Restart claudeclaw and retry.');
      process.exit(1);
    }

    const before = db.prepare(
      `SELECT id, kind, script_path, status FROM scheduled_tasks WHERE id = ?`,
    ).get(NEWS_SYNC_ID);
    if (!before) {
      console.error(`[activate-news-sync] FAILED: task ${NEWS_SYNC_ID} not found in scheduled_tasks`);
      process.exit(1);
    }

    const result = db.prepare(`
      UPDATE scheduled_tasks
         SET kind = 'shell',
             script_path = 'scripts/news-sync.ts',
             status = 'active'
       WHERE id = ?
    `).run(NEWS_SYNC_ID);

    const after = db.prepare(
      `SELECT id, kind, script_path, status, schedule FROM scheduled_tasks WHERE id = ?`,
    ).get(NEWS_SYNC_ID);

    console.log(`[activate-news-sync] before: ${JSON.stringify(before)}`);
    console.log(`[activate-news-sync] after : ${JSON.stringify(after)}`);
    console.log(`[activate-news-sync] rows changed: ${result.changes}`);
    console.log('[activate-news-sync] OK. Scheduler picks this up on next poll; first fire on next 2h boundary.');
    process.exit(0);
  } finally {
    db.close();
  }
}

main();
