/**
 * 2026-04-20 DB rescue: backup + WAL truncate + VACUUM + row-count
 * summary.
 *
 * Prerequisites:
 *   - claudeclaw pm2 process MUST be stopped. Script refuses to run
 *     otherwise by checking STORE_DIR/claudeclaw.pid's liveness.
 *   - ~20 GB free disk space for the backup copy.
 *
 * Phases (each logs before/after state):
 *   A1. Copy claudeclaw.db + .db-wal + .db-shm to backup-YYYY-MM-DD/.
 *   A2. Open writer, PRAGMA wal_checkpoint(TRUNCATE).
 *   A3. VACUUM (may take 5-15 min on a 9 GB DB).
 *   A4. Reopen readonly, print top-10 tables by row count.
 *
 * Exit code 0 on success, non-zero on any phase failure.
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { STORE_DIR } from '../src/config.js';

function sha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(64 * 1024);
  let bytes: number;
  while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
    hash.update(buf.subarray(0, bytes));
  }
  fs.closeSync(fd);
  return hash.digest('hex');
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function logSizes(label: string, dbPath: string): void {
  console.log(`  [${label}]`);
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) {
      console.log(`    ${path.basename(p).padEnd(22)} ${fmtSize(fs.statSync(p).size)}`);
    } else {
      console.log(`    ${path.basename(p).padEnd(22)} (missing)`);
    }
  }
}

function checkBotStopped(): void {
  const pidFile = path.join(STORE_DIR, 'claudeclaw.pid');
  if (!fs.existsSync(pidFile)) {
    console.log('No claudeclaw.pid file — bot not running.');
    return;
  }
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  if (isNaN(pid)) {
    console.log('claudeclaw.pid unreadable — proceeding.');
    return;
  }
  try {
    process.kill(pid, 0); // signal 0 = check existence
    // If no error, process exists. Abort.
    console.error(`FATAL: claudeclaw is still running (PID ${pid}). Run \`pm2 stop claudeclaw\` first.`);
    process.exit(1);
  } catch {
    // ESRCH → process is dead. Stale pid file, safe to proceed.
    console.log(`Stale claudeclaw.pid (PID ${pid} is dead) — proceeding.`);
  }
}

function main(): void {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`FATAL: ${dbPath} not found.`);
    process.exit(1);
  }

  checkBotStopped();

  // ── A1. Backup ────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const backupDir = path.join(STORE_DIR, `backup-${today}`);
  if (fs.existsSync(backupDir)) {
    console.error(`FATAL: backup dir already exists at ${backupDir}. Remove or rename first.`);
    process.exit(1);
  }
  fs.mkdirSync(backupDir);

  console.log(`\n=== A1. Backup → ${backupDir} ===`);
  logSizes('live', dbPath);
  for (const suffix of ['', '-wal', '-shm']) {
    const src = dbPath + suffix;
    if (!fs.existsSync(src)) continue;
    const dst = path.join(backupDir, path.basename(src));
    fs.copyFileSync(src, dst);
    console.log(`    copied ${path.basename(src)} (${fmtSize(fs.statSync(dst).size)})`);
  }
  const backupDbPath = path.join(backupDir, 'claudeclaw.db');
  const backupHash = sha256(backupDbPath);
  console.log(`    sha256(${path.basename(backupDbPath)}): ${backupHash}`);
  fs.writeFileSync(path.join(backupDir, 'SHA256'), `${backupHash}  claudeclaw.db\n`);

  // ── A2. WAL checkpoint ────────────────────────────────────────────
  console.log(`\n=== A2. WAL checkpoint (TRUNCATE) ===`);
  logSizes('before', dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const t2 = Date.now();
  const ckpt = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number; log: number; checkpointed: number }>;
  console.log(`    checkpoint result: ${JSON.stringify(ckpt)} (${Date.now() - t2} ms)`);
  logSizes('after checkpoint', dbPath);

  // ── A3. VACUUM ────────────────────────────────────────────────────
  console.log(`\n=== A3. VACUUM ===`);
  console.log(`    (may take 5-15 minutes on a multi-GB DB; no progress ticker — be patient)`);
  const t3 = Date.now();
  db.exec('VACUUM');
  console.log(`    VACUUM done in ${((Date.now() - t3) / 1000).toFixed(1)} s`);
  logSizes('after vacuum', dbPath);
  db.close();

  // ── A4. Row-count summary ─────────────────────────────────────────
  console.log(`\n=== A4. Row counts (readonly) ===`);
  const dbRo = new Database(dbPath, { readonly: true, fileMustExist: true });
  dbRo.pragma('busy_timeout = 5000');
  const tables = dbRo
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  const rows: Array<{ table: string; n: number }> = [];
  for (const t of tables) {
    try {
      const r = dbRo.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number };
      rows.push({ table: t.name, n: r.n });
    } catch {
      rows.push({ table: t.name, n: -1 });
    }
  }
  rows.sort((a, b) => b.n - a.n);
  for (const r of rows.slice(0, 15)) {
    console.log(`    ${r.table.padEnd(36)} ${r.n.toLocaleString().padStart(14)} rows`);
  }
  dbRo.close();

  console.log(`\n✅ Rescue complete. Backup at ${backupDir}.`);
  console.log(`   If anything looks wrong: \`cp ${backupDir}/* ${STORE_DIR}/\` restores pre-rescue state.`);
}

main();
