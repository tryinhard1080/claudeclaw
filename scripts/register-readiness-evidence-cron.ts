#!/usr/bin/env tsx
/**
 * One-shot script: registers a daily readiness evidence snapshot.
 *
 * Safe to re-run. The task records one upserted row per UTC day in
 * readiness_evidence_snapshots after the weekday regime Sharpe snapshot has
 * had time to run.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { randomBytes } from 'crypto';

import { STORE_DIR } from '../src/config.js';
import { computeNextRun } from '../src/scheduler.js';

const SCHEDULE = '15 17 * * *';
const SCRIPT_PATH = 'scripts/readiness-evidence.ts --record --history 14';
const PROMPT =
  '[shell] Daily 17:15 CT readiness evidence snapshot. Records Polymarket settlement pipeline, TTL filter freshness, and regime Sharpe sample depth.';

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

    const id = `readiness-evidence-${randomBytes(2).toString('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    const nextRun = computeNextRun(SCHEDULE);

    db.prepare(`
      INSERT INTO scheduled_tasks
        (id, prompt, schedule, next_run, status, created_at, agent_id, kind, script_path)
      VALUES (?, ?, ?, ?, 'active', ?, 'main', 'shell', ?)
    `).run(id, PROMPT, SCHEDULE, nextRun, now, SCRIPT_PATH);

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
