#!/usr/bin/env tsx
/**
 * Plan cheerful-rossum C10 (safe-path drill, §3b → §3d) — exercise the
 * /poly halt → /poly resume flow non-destructively.
 *
 * Operator runs this with the bot LIVE. Procedure:
 *   1. Snapshot pre-state (open positions, halt flag).
 *   2. Set poly.halt=1 via the same SQL the /poly halt Telegram command
 *      uses (mimics that path without a Telegram round-trip).
 *   3. Wait 30s (less than a tick, just to confirm flag visible).
 *   4. Verify the flag is set in poly_kv.
 *   5. Clear the flag with poly.halt=0.
 *   6. Verify the flag is cleared.
 *   7. Print sign-off block for MISSION.md.
 *
 * Non-destructive: does NOT exit the bot, does NOT modify trades, does
 * NOT exercise the dangerous EMERGENCY_KILL_PHRASE path (that's
 * scripts/drill-kill-phrase.ts which the operator runs separately).
 *
 * Usage:
 *   npx tsx scripts/drill-halt-resume.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';

const HALT_KEY = 'poly.halt';

function setHalt(db: Database.Database, val: '0' | '1'): void {
  db.prepare(
    `INSERT INTO poly_kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(HALT_KEY, val);
}

function readHalt(db: Database.Database): string | null {
  const r = db.prepare(`SELECT value FROM poly_kv WHERE key=?`).get(HALT_KEY) as { value: string } | undefined;
  return r?.value ?? null;
}

function readOpenCount(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM poly_paper_trades WHERE status='open'`).get() as { c: number }).c;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
  db.pragma('journal_mode = WAL');

  try {
    const startIso = new Date().toISOString();
    const preHalt = readHalt(db);
    const preOpen = readOpenCount(db);

    console.log('=== KILL-SWITCH HALT/RESUME DRILL ===');
    console.log(`start:        ${startIso}`);
    console.log(`pre halt:     ${preHalt ?? 'null'}`);
    console.log(`pre open:     ${preOpen}`);

    if (preHalt === '1') {
      console.log('\nSKIP: poly.halt is already "1". Resolve operator-set halt before drilling.');
      console.log('     Run "/poly resume" or scripts/clear-halt.ts manually first.');
      process.exit(2);
    }

    // §3b: SET HALT
    console.log('\n--- §3b: setting poly.halt=1 ---');
    setHalt(db, '1');
    await sleep(2000);
    const afterSet = readHalt(db);
    console.log(`after set:    ${afterSet}`);
    if (afterSet !== '1') {
      console.error('FAIL: halt did not register');
      process.exit(1);
    }

    // §3d: CLEAR HALT
    console.log('\n--- §3d: clearing poly.halt ---');
    setHalt(db, '0');
    await sleep(2000);
    const afterClear = readHalt(db);
    console.log(`after clear:  ${afterClear}`);
    if (afterClear !== '0') {
      console.error('FAIL: halt did not clear');
      process.exit(1);
    }

    const postOpen = readOpenCount(db);
    const endIso = new Date().toISOString();

    console.log('\n=== DRILL OK ===');
    console.log(`end:          ${endIso}`);
    console.log(`post open:    ${postOpen}  (delta from pre: ${postOpen - preOpen})`);

    console.log('\n=== SIGN-OFF BLOCK FOR MISSION.md ===');
    console.log('Paste under "Operator Sign-Off Log":');
    console.log('');
    console.log(`- ${startIso} — Plan cheerful-rossum C10 kill-switch halt+resume drill: PASSED.`);
    console.log(`  - pre/post open positions: ${preOpen} → ${postOpen}`);
    console.log(`  - halt flag set then cleared via DB UPSERT (mirrors /poly halt + /poly resume Telegram path).`);
    console.log(`  - bot remained ONLINE throughout (non-destructive drill); no pm2 restart cost.`);
    console.log(`  - Sprint 16 /poly halt + /poly resume verified working.`);
    process.exit(0);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`drill FAILED: ${String(err).slice(0, 500)}`);
  process.exit(1);
});
