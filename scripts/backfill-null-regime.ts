/**
 * Backfill NULL regime_label rows to 'vunk_bunk_yunk' per Sprint 3 design rule.
 * Historic rows from cold-start windows before the first regime snapshot
 * landed. Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/backfill-null-regime.ts           # dry-run
 *   npx tsx scripts/backfill-null-regime.ts --apply   # write
 */
import Database from 'better-sqlite3';
import { STORE_DIR } from '../src/config.js';
import path from 'path';

const apply = process.argv.includes('--apply');
const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
const db = new Database(dbPath);

try {
  const before = db.prepare('SELECT COUNT(*) c FROM poly_signals WHERE regime_label IS NULL').get() as { c: number };
  console.log(`poly_signals with NULL regime_label: ${before.c}`);

  if (before.c === 0) {
    console.log('Nothing to backfill.');
    process.exit(0);
  }

  if (!apply) {
    const sample = db.prepare("SELECT id, datetime(created_at,'unixepoch') as dt, market_slug FROM poly_signals WHERE regime_label IS NULL ORDER BY created_at DESC LIMIT 3").all();
    console.log('Sample NULL rows:', sample);
    console.log("\nDRY-RUN: would UPDATE poly_signals SET regime_label='vunk_bunk_yunk' WHERE regime_label IS NULL");
    console.log('Re-run with --apply to write.');
    process.exit(0);
  }

  const result = db.prepare("UPDATE poly_signals SET regime_label='vunk_bunk_yunk' WHERE regime_label IS NULL").run();
  console.log(`Updated ${result.changes} rows.`);

  const after = db.prepare('SELECT COUNT(*) c FROM poly_signals WHERE regime_label IS NULL').get() as { c: number };
  console.log(`Remaining NULL rows: ${after.c}`);
} finally {
  db.close();
}
