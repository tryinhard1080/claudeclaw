#!/usr/bin/env tsx
/**
 * One-shot script: registers the Sprint S1 regime-trader Sharpe snapshot as a
 * daily kind=shell cron at 0 17 * * 1-5 (17:00 local, weekdays). Idempotent —
 * checks for an existing regime-sharpe-* task and exits cleanly if present.
 *
 * Sprint S1 wire-up. Safe to re-run.
 *
 * Reference: docs/research/sprint-s1-sharpe-instrumentation.md §5.3
 * Mirrors: scripts/register-prompt-drift-cron.ts (Sprint 22 precedent).
 */
import Database from 'better-sqlite3';
import path from 'path';
import { randomBytes } from 'crypto';
import { STORE_DIR } from '../src/config.js';
import { computeNextRun } from '../src/scheduler.js';

const SCHEDULE = '0 17 * * 1-5';
const SCRIPT_PATH = 'scripts/regime-sharpe-snapshot.ts';
const PROMPT =
  '[shell] Daily 17:00 CT regime-trader Sharpe snapshot. Reads state.json per instance, computes daily return + rolling Sharpe-60d, writes to regime_sharpe_snapshots.';

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

    const id = `regime-sharpe-${randomBytes(2).toString('hex')}`;
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
