#!/usr/bin/env tsx
/**
 * Registers a recurring read-only Polymarket resolution watch.
 *
 * This is a paper-readiness monitor only. It does not fetch markets, mutate
 * trades, change caps, place orders, lift halts, or enable live flags.
 */
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';

import { STORE_DIR } from '../src/config.js';
import { computeNextRun } from '../src/scheduler.js';

const SCHEDULE = '0 */2 * * *';
const SCRIPT_PATH =
  'scripts/poly-resolution-watch.ts --due-days 7 --near-term-days 30 --overdue-grace-days 2 --max-items 20';
const PROMPT =
  '[shell] Every 2h Polymarket paper resolution watch. Reports due, overdue, closed-cache, and missing-market open trades for Box 2 evidence.';

function main(): number {
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
  db.pragma('journal_mode = WAL');
  try {
    const existing = db.prepare(
      `SELECT id, schedule, next_run, status FROM scheduled_tasks WHERE script_path = ? AND status != 'paused'`,
    ).get(SCRIPT_PATH) as { id: string; schedule: string; next_run: number; status: string } | undefined;
    if (existing) {
      console.log(`already registered: ${existing.id} schedule=${existing.schedule} status=${existing.status}`);
      console.log(`next_run unix: ${existing.next_run}`);
      return 0;
    }

    const id = `poly-resolution-watch-${randomBytes(2).toString('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    const nextRun = computeNextRun(SCHEDULE);

    db.prepare(`
      INSERT INTO scheduled_tasks
        (id, prompt, schedule, next_run, status, created_at, agent_id, kind, script_path)
      VALUES (?, ?, ?, ?, 'active', ?, 'main', 'shell', ?)
    `).run(id, PROMPT, SCHEDULE, nextRun, now, SCRIPT_PATH);

    console.log(`registered: ${id} schedule=${SCHEDULE} script=${SCRIPT_PATH}`);
    console.log(`next_run unix: ${nextRun}`);
    return 0;
  } finally {
    db.close();
  }
}

try {
  process.exitCode = main();
} catch (error) {
  console.error('FATAL:', error);
  process.exitCode = 1;
}
