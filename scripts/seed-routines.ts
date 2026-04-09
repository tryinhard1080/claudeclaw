#!/usr/bin/env npx tsx
/**
 * Seed the scheduled_tasks table with system routines.
 *
 * Idempotent: skips routines that already exist (by ID).
 * Run: npx tsx scripts/seed-routines.ts
 */

import { CronExpressionParser } from 'cron-parser';
import Database from 'better-sqlite3';
import path from 'path';

// Import routine definitions
import { ROUTINES } from '../src/routines.js';

// Resolve store directory (same logic as config.ts)
const STORE_DIR = process.env.STORE_DIR || path.resolve(import.meta.dirname ?? '.', '..', 'store');
const DB_PATH = path.join(STORE_DIR, 'claudeclaw.db');

console.log(`Database: ${DB_PATH}`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Ensure scheduled_tasks table exists (it should from normal bot startup)
const tableExists = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_tasks'`,
).get();

if (!tableExists) {
  console.error('Error: scheduled_tasks table does not exist. Start the bot first to initialize the database.');
  process.exit(1);
}

// Add routine_type column if missing
const cols = db.prepare('PRAGMA table_info(scheduled_tasks)').all() as Array<{ name: string }>;
if (!cols.some((c) => c.name === 'routine_type')) {
  db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN routine_type TEXT`);
  console.log('Added routine_type column to scheduled_tasks');
}

// Seed routines
let created = 0;
let skipped = 0;

for (const routine of ROUTINES) {
  const existing = db.prepare('SELECT id FROM scheduled_tasks WHERE id = ?').get(routine.id);
  if (existing) {
    console.log(`  SKIP: ${routine.id} (already exists)`);
    skipped++;
    continue;
  }

  const nextRun = Math.floor(CronExpressionParser.parse(routine.schedule).next().getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO scheduled_tasks (id, prompt, schedule, next_run, status, created_at, agent_id, routine_type)
     VALUES (?, ?, ?, ?, 'active', ?, 'main', 'system')`,
  ).run(routine.id, routine.buildPrompt(), routine.schedule, nextRun, now);

  console.log(`  CREATE: ${routine.id} — ${routine.name} (${routine.schedule})`);
  created++;
}

console.log(`\nDone. Created: ${created}, Skipped: ${skipped}, Total routines: ${ROUTINES.length}`);
db.close();
