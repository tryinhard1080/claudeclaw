/**
 * Fast-path retention: rebuild poly_price_history with only the most
 * recent POLY_PRICE_HISTORY_HOURS of rows via a CREATE+INSERT+DROP+RENAME
 * swap. Avoids deleting 35M+ individual rows which is 60-90x slower than
 * copying 300k survivors to a fresh table.
 *
 * Use after the 2026-04-20 DB rescue to clear the backlog accumulated
 * during the pre-fix 100k-rows-per-tick era.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR, POLY_PRICE_HISTORY_HOURS } from '../src/config.js';

function main(): void {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 2000');
  db.pragma('synchronous = NORMAL');

  const cutoff = Math.floor(Date.now() / 1000) - POLY_PRICE_HISTORY_HOURS * 3600;
  console.log(`Rebuilding poly_price_history keeping rows captured_at >= ${cutoff} (${POLY_PRICE_HISTORY_HOURS}h window)`);

  const totalBefore = (db.prepare(`SELECT COUNT(*) AS n FROM poly_price_history`).get() as { n: number }).n;
  console.log(`  before: ${totalBefore.toLocaleString()} rows`);

  const keepCount = (db.prepare(`SELECT COUNT(*) AS n FROM poly_price_history WHERE captured_at >= ?`).get(cutoff) as { n: number }).n;
  console.log(`  will keep: ${keepCount.toLocaleString()} rows`);

  const t0 = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE poly_price_history_new (
        token_id    TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        price       REAL NOT NULL,
        PRIMARY KEY (token_id, captured_at)
      );
    `);
    const ins = db.prepare(`
      INSERT INTO poly_price_history_new (token_id, captured_at, price)
      SELECT token_id, captured_at, price FROM poly_price_history WHERE captured_at >= ?
    `);
    ins.run(cutoff);

    db.exec(`DROP TABLE poly_price_history`);
    db.exec(`ALTER TABLE poly_price_history_new RENAME TO poly_price_history`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_poly_price_history_captured ON poly_price_history(captured_at)`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log(`Swap done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const totalAfter = (db.prepare(`SELECT COUNT(*) AS n FROM poly_price_history`).get() as { n: number }).n;
  console.log(`  after:  ${totalAfter.toLocaleString()} rows`);

  const ckpt = db.pragma('wal_checkpoint(TRUNCATE)');
  console.log(`  final checkpoint: ${JSON.stringify(ckpt)}`);

  // VACUUM to reclaim the space freed by dropping the old table.
  console.log(`Running VACUUM to reclaim dropped-table pages...`);
  const vt0 = Date.now();
  db.exec('VACUUM');
  console.log(`VACUUM done in ${((Date.now() - vt0) / 1000).toFixed(1)} s`);

  db.close();

  console.log(`✅ Prune-via-swap complete.`);
}

main();
