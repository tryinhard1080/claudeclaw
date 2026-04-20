import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add index on poly_price_history.captured_at for fast pruneOldPrices';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * 2026-04-20 DB bloat remediation. poly_price_history previously had only
 * the composite PK (token_id, captured_at). pruneOldPrices runs
 *   DELETE FROM poly_price_history WHERE captured_at < ?
 * which SQLite planned as a full table scan — O(n) on ~43M rows, multiple
 * seconds of locked write per scan, which compounded into a 5.5 GB WAL.
 *
 * A secondary index on (captured_at) lets the prune use a range scan
 * instead of a full scan. Roughly 100x faster on the scaled data.
 *
 * Idempotent: CREATE INDEX IF NOT EXISTS. The scanner's initPoly also
 * runs the same statement defensively on boot (see src/poly/index.ts) so
 * upgraded installs work even if npm run migrate was forgotten.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_poly_price_history_captured
        ON poly_price_history(captured_at);
    `);
  } finally {
    db.close();
  }
}
