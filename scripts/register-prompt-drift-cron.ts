#!/usr/bin/env tsx
/**
 * One-shot script: registers the Sprint 22 prompt-drift audit as a daily
 * kind=shell cron at 0 8 * * * (08:00 local). Idempotent — checks for an
 * existing prompt-drift-* task and exits cleanly if one is present.
 *
 * Sprint 22 wire-up. Safe to re-run.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { randomBytes } from 'crypto';
import { STORE_DIR } from '../src/config.js';
import { computeNextRun } from '../src/scheduler.js';

const SCHEDULE = '0 8 * * *';
const SCRIPT_PATH = 'scripts/check-prompt-drift.ts';

async function main(): Promise<void> {
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
  db.pragma('journal_mode = WAL');
  try {
    const existing = db.prepare(
      `SELECT id FROM scheduled_tasks WHERE script_path = ? AND status != 'paused'`,
    ).get(SCRIPT_PATH) as { id: string } | undefined;
    if (existing) {
      console.log(`already registered: ${existing.id}`);
      return;
    }

    const id = `prompt-drift-${randomBytes(2).toString('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    const nextRun = computeNextRun(SCHEDULE);

    db.prepare(`
      INSERT INTO scheduled_tasks
        (id, prompt, schedule, next_run, status, created_at, agent_id, kind, script_path)
      VALUES (?, ?, ?, ?, 'active', ?, 'main', 'shell', ?)
    `).run(id, '[shell] prompt-drift audit', SCHEDULE, nextRun, now, SCRIPT_PATH);

    console.log(`registered: ${id} schedule=${SCHEDULE} script=${SCRIPT_PATH}`);
    console.log(`next_run unix: ${nextRun}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
