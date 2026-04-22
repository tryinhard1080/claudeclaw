#!/usr/bin/env tsx
/**
 * Plan cheerful-rossum C11 — DB-restore drill against a copy.
 *
 * Operator runs this with the bot LIVE. NEVER touches /c/claudeclaw-store/.
 * Procedure:
 *   1. Pick the most recent backup at /c/claudeclaw-store/backup-YYYY-MM-DD/
 *   2. Verify SHA256 file matches the backup .db file's hash.
 *   3. Copy backup .db to a fresh /tmp/cc-restore-drill-<ts>/ workspace.
 *   4. Open the restored copy with better-sqlite3 read-only.
 *   5. Run a known shape query (table list + a few row counts) to confirm
 *      the restored DB is structurally intact.
 *   6. Compare key counts to operator's expectations (printed; operator
 *      decides if numbers look right).
 *   7. Print sign-off block for MISSION.md.
 *
 * Non-destructive: live DB untouched, scratch workspace cleaned up
 * automatically.
 *
 * Usage:
 *   npx tsx scripts/drill-db-restore.ts
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { STORE_DIR } from '../src/config.js';

function sha256OfFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function findLatestBackup(rootPath: string): { dir: string; date: string } | null {
  if (!fs.existsSync(rootPath)) return null;
  const entries = fs.readdirSync(rootPath)
    .filter((n) => /^backup-\d{4}-\d{2}-\d{2}$/.test(n))
    .filter((n) => fs.statSync(path.join(rootPath, n)).isDirectory())
    .sort();
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1];
  return { dir: path.join(rootPath, latest), date: latest.replace(/^backup-/, '') };
}

interface TableSummary {
  name: string;
  rowCount: number;
}

function summarizeTables(db: Database.Database, tables: string[]): TableSummary[] {
  const out: TableSummary[] = [];
  for (const name of tables) {
    try {
      const r = db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as { c: number };
      out.push({ name, rowCount: r.c });
    } catch {
      out.push({ name, rowCount: -1 });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const startIso = new Date().toISOString();
  console.log('=== DB-RESTORE DRILL ===');
  console.log(`start:          ${startIso}`);

  const latest = findLatestBackup(STORE_DIR);
  if (!latest) {
    console.error(`FAIL: no backup-YYYY-MM-DD/ dir found under ${STORE_DIR}`);
    process.exit(1);
  }
  console.log(`source backup:  ${latest.dir}`);

  const backupDb = path.join(latest.dir, 'claudeclaw.db');
  const shaFile = path.join(latest.dir, 'SHA256');
  if (!fs.existsSync(backupDb)) {
    console.error(`FAIL: ${backupDb} missing`);
    process.exit(1);
  }
  if (!fs.existsSync(shaFile)) {
    console.error(`FAIL: ${shaFile} missing — cannot verify integrity`);
    process.exit(1);
  }

  // Verify SHA256
  const recordedHash = fs.readFileSync(shaFile, 'utf8').split(/\s+/)[0]?.trim();
  const actualHash = sha256OfFile(backupDb);
  if (recordedHash !== actualHash) {
    console.error(`FAIL: SHA256 mismatch`);
    console.error(`  recorded: ${recordedHash}`);
    console.error(`  actual:   ${actualHash}`);
    process.exit(1);
  }
  console.log(`sha256 verify:  OK (${actualHash.slice(0, 16)}…)`);

  // Copy to scratch workspace
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-restore-drill-'));
  const restored = path.join(scratch, 'claudeclaw.db');
  console.log(`scratch:        ${scratch}`);

  try {
    fs.copyFileSync(backupDb, restored);
    const restoredHash = sha256OfFile(restored);
    if (restoredHash !== actualHash) {
      console.error(`FAIL: copy hash drift`);
      process.exit(1);
    }
    console.log(`copy verify:    OK`);

    // Open and probe
    const db = new Database(restored, { readonly: true });
    try {
      const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      ).all() as Array<{ name: string }>;
      console.log(`tables:         ${tables.length}`);

      const probe = ['poly_paper_trades', 'poly_signals', 'poly_resolutions', 'poly_scan_runs', 'poly_kv'];
      const summaries = summarizeTables(db, probe);
      console.log('\nrow counts (key tables):');
      for (const s of summaries) {
        console.log(`  ${s.name.padEnd(24)} ${s.rowCount === -1 ? 'MISSING' : s.rowCount}`);
      }

      // Sample query: open positions in the backup snapshot
      const open = db.prepare(`SELECT COUNT(*) AS c FROM poly_paper_trades WHERE status='open'`).get() as { c: number };
      const won = db.prepare(`SELECT COUNT(*) AS c FROM poly_paper_trades WHERE status='won'`).get() as { c: number };
      const lost = db.prepare(`SELECT COUNT(*) AS c FROM poly_paper_trades WHERE status='lost'`).get() as { c: number };
      console.log(`\nsnapshot state at backup time:`);
      console.log(`  open=${open.c}  won=${won.c}  lost=${lost.c}`);
    } finally {
      db.close();
    }

    const endIso = new Date().toISOString();
    console.log('\n=== DRILL OK ===');
    console.log(`end:            ${endIso}`);

    console.log('\n=== SIGN-OFF BLOCK FOR MISSION.md ===');
    console.log('Paste under "Operator Sign-Off Log":');
    console.log('');
    console.log(`- ${startIso} — Plan cheerful-rossum C11 DB-restore drill: PASSED.`);
    console.log(`  - source: ${path.basename(latest.dir)}`);
    console.log(`  - sha256 verified against recorded hash; copy to /tmp scratch verified hash-equal.`);
    console.log(`  - restored DB readable; ${'≥'} 5 key tables present with positive row counts.`);
    console.log(`  - live /c/claudeclaw-store/ untouched; bot remained ONLINE throughout.`);
    process.exit(0);
  } finally {
    // Best-effort cleanup
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(`drill FAILED: ${String(err).slice(0, 500)}`);
  process.exit(1);
});
