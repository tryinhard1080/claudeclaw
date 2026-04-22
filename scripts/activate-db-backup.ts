#!/usr/bin/env tsx
/**
 * Plan cheerful-rossum D12 — register the nightly db-backup task in
 * scheduled_tasks. Idempotent. Safe to re-run.
 *
 * Schedule: 4am daily (`0 4 * * *`).
 *
 * Usage:
 *   npx tsx scripts/activate-db-backup.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import { STORE_DIR } from '../src/config.js';

const TASK_ID = 'db-backup-nightly';
const SCRIPT_PATH = 'scripts/db-backup.ts';
const SCHEDULE = '0 4 * * *';

function main(): void {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  try {
    const existing = db.prepare(
      `SELECT id, kind, script_path, schedule, status FROM scheduled_tasks WHERE id = ?`,
    ).get(TASK_ID);

    if (existing) {
      console.log(`[activate-db-backup] already registered: ${JSON.stringify(existing)}`);
      // Idempotent: ensure latest values are correct (in case schema changed)
      db.prepare(`
        UPDATE scheduled_tasks
           SET kind='shell', script_path=?, schedule=?, status='active'
         WHERE id=?
      `).run(SCRIPT_PATH, SCHEDULE, TASK_ID);
      const after = db.prepare(
        `SELECT id, kind, script_path, schedule, status FROM scheduled_tasks WHERE id = ?`,
      ).get(TASK_ID);
      console.log(`[activate-db-backup] reasserted: ${JSON.stringify(after)}`);
      process.exit(0);
    }

    // Probe schema for which columns exist (older installs may differ)
    const cols = db.prepare(`PRAGMA table_info(scheduled_tasks)`).all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    const nowSec = Math.floor(Date.now() / 1000);

    // Compute next 4am UTC in epoch seconds
    const d = new Date();
    d.setUTCHours(4, 0, 0, 0);
    if (d.getTime() / 1000 <= nowSec) d.setUTCDate(d.getUTCDate() + 1);
    const nextRunSec = Math.floor(d.getTime() / 1000);

    // Build INSERT dynamically against actual columns
    const candidates: Record<string, unknown> = {
      id: TASK_ID,
      kind: 'shell',
      script_path: SCRIPT_PATH,
      schedule: SCHEDULE,
      status: 'active',
      created_at: nowSec,
      next_run: nextRunSec,
      agent_id: 'main',
      prompt: '', // legacy column expected by some readers
    };
    const insertCols = Object.keys(candidates).filter((c) => colNames.has(c));
    const placeholders = insertCols.map((c) => '@' + c).join(', ');
    const colList = insertCols.join(', ');

    db.prepare(`INSERT INTO scheduled_tasks (${colList}) VALUES (${placeholders})`).run(candidates);

    const after = db.prepare(
      `SELECT id, kind, script_path, schedule, status FROM scheduled_tasks WHERE id = ?`,
    ).get(TASK_ID);
    console.log(`[activate-db-backup] inserted: ${JSON.stringify(after)}`);
    console.log('[activate-db-backup] OK. Scheduler picks this up on next poll; first fire at next 4am.');
    process.exit(0);
  } finally {
    db.close();
  }
}

// Suppress no-unused-import false positive when crypto is not used in some envs
void crypto;

main();
