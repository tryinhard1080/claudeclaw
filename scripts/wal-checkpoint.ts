/**
 * One-shot WAL checkpoint + truncate. Use after operations that balloon
 * the WAL (VACUUM, large bulk imports) to reclaim disk space.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { STORE_DIR } from '../src/config.js';

const dbPath = path.join(STORE_DIR, 'claudeclaw.db');

function logSizes(label: string): void {
  console.log(`${label}:`);
  for (const s of ['', '-wal', '-shm']) {
    const p = dbPath + s;
    if (fs.existsSync(p)) {
      const mb = fs.statSync(p).size / 1024 / 1024;
      console.log(`  ${path.basename(p).padEnd(22)} ${mb.toFixed(1)} MB`);
    }
  }
}

logSizes('before');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
const r = db.pragma('wal_checkpoint(TRUNCATE)');
console.log('checkpoint:', JSON.stringify(r));
db.close();
logSizes('after');
