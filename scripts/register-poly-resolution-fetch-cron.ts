#!/usr/bin/env tsx
/**
 * Registers a recurring prioritized Polymarket resolution-cache refresh.
 *
 * The fetcher updates only poly_resolutions, with open-trade slugs prioritized
 * by scripts/fetch-resolutions.ts. It does not settle paper trades, place
 * orders, change caps, lift halts, or enable live flags.
 */
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';

import { STORE_DIR } from '../src/config.js';
import { computeNextRun } from '../src/scheduler.js';

const SCHEDULE = '55 1,3,5,7,9,11,13,15,17,19,21,23 * * *';
const SCRIPT_PATH = 'scripts/fetch-resolutions.ts --limit 75';
const PROMPT =
  '[shell] Every 2h prioritized Polymarket resolution-cache refresh. Fetches open-trade slugs first so Box 2 evidence and the resolution watchdog stay fresh.';

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

    const id = `poly-resolution-fetch-${randomBytes(2).toString('hex')}`;
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
