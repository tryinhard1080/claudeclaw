/**
 * One-shot chunked DELETE of old poly_price_history rows. Use after the
 * 2026-04-20 DB rescue to clear the 14M+ row backlog in a controlled
 * way, rather than letting the scanner's first runOnce grind through
 * it inside a 2+ GB WAL transaction.
 *
 * Each chunk is its own small transaction, so WAL checkpoints fire
 * naturally in between and disk usage stays bounded.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR, POLY_PRICE_HISTORY_HOURS } from '../src/config.js';

const CHUNK_SIZE = 100_000; // rows per sub-transaction

function main(): void {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 2000');
  db.pragma('synchronous = NORMAL');

  const cutoff = Math.floor(Date.now() / 1000) - POLY_PRICE_HISTORY_HOURS * 3600;
  console.log(`Pruning poly_price_history WHERE captured_at < ${cutoff} (${POLY_PRICE_HISTORY_HOURS}h ago)`);

  const totalBefore = (db.prepare(`SELECT COUNT(*) AS n FROM poly_price_history`).get() as { n: number }).n;
  console.log(`  before: ${totalBefore.toLocaleString()} rows`);

  // Chunked delete using the composite PK. better-sqlite3 supports LIMIT
  // inside DELETE only when SQLite was compiled with SQLITE_ENABLE_UPDATE_DELETE_LIMIT.
  // It isn't by default, so we use a subquery on rowid.
  const chunkStmt = db.prepare(`
    DELETE FROM poly_price_history
    WHERE rowid IN (
      SELECT rowid FROM poly_price_history WHERE captured_at < ? LIMIT ?
    )
  `);

  let deleted = 0;
  let iter = 0;
  const start = Date.now();
  while (true) {
    const t0 = Date.now();
    const r = chunkStmt.run(cutoff, CHUNK_SIZE);
    const n = r.changes;
    deleted += n;
    iter++;
    const chunkMs = Date.now() - t0;
    console.log(`  iter ${iter.toString().padStart(3)}: -${n.toLocaleString()} rows (${chunkMs} ms) — total ${deleted.toLocaleString()} / est ${totalBefore.toLocaleString()}`);
    if (n < CHUNK_SIZE) break;
  }

  console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)} s. Pruned ${deleted.toLocaleString()} rows.`);

  const totalAfter = (db.prepare(`SELECT COUNT(*) AS n FROM poly_price_history`).get() as { n: number }).n;
  console.log(`  after:  ${totalAfter.toLocaleString()} rows`);

  // One final checkpoint to reclaim any lingering WAL.
  const ckpt = db.pragma('wal_checkpoint(TRUNCATE)');
  console.log(`  final checkpoint: ${JSON.stringify(ckpt)}`);

  db.close();
}

main();
