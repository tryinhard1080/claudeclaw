#!/usr/bin/env tsx
/**
 * Plan cheerful-rossum D12 — nightly DB backup via SQLite Online Backup API.
 *
 * Safe to run while bot is live (unlike scripts/db-rescue.ts which requires
 * the bot stopped). Uses better-sqlite3's db.backup() under the hood, which
 * wraps SQLite's online backup pages-at-a-time mechanism.
 *
 * Cron: `0 4 * * *` (4am daily) once activate-db-backup.ts has registered
 * the scheduled_tasks row.
 *
 * Exit codes:
 *   0 = success (backup created OR today already backed up — heartbeat updated)
 *   1 = real failure (db.backup threw, FS error, etc.)
 *
 * Usage:
 *   npx tsx scripts/db-backup.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';
import { runBackup } from '../src/poly/db-backup.js';

async function main(): Promise<void> {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  try {
    const result = await runBackup(db, { storeDir: STORE_DIR });
    if (!result.ok) {
      console.error(`[db-backup] FAILED: ${result.reason} (${result.durationMs}ms)`);
      process.exit(1);
    }
    const sizeMb = result.backupBytes ? (result.backupBytes / 1_000_000).toFixed(1) : '-';
    if (result.reason) {
      console.log(`[db-backup] ${result.reason} — ${result.backupDir} (${sizeMb} MB) ${result.durationMs}ms`);
    } else {
      console.log(`[db-backup] ok ${result.backupDir} (${sizeMb} MB) sha256=${result.sha256?.slice(0, 12)} ${result.durationMs}ms`);
    }
    if (result.pruned && result.pruned.length > 0) {
      console.log(`[db-backup] pruned ${result.pruned.length} old backup(s): ${result.pruned.map((e) => e.name).join(', ')}`);
    }
    process.exit(0);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`[db-backup] FATAL: ${String(err).slice(0, 500)}`);
  process.exit(1);
});
