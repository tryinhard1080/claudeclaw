import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add poly_ttl_shadow_ticks table for Sprint S2 TTL filter shadow comparison';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * Sprint S2 (docs/research/sprint-s2-ttl-filter-shadow.md §3.2). One row per
 * scan tick records what the candidate set looks like under the TTL band, so
 * the day-14 comparison report can compute the would-be approval rate without
 * any change to the live pipeline. UNIQUE(scan_tick_at) makes a manual
 * re-write idempotent.
 *
 * band_min_days / band_max_days are snapshotted per row so the report stays
 * interpretable if the operator tunes POLY_MIN_MARKET_TTL_DAYS or
 * POLY_MAX_MARKET_TTL_DAYS mid-window.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS poly_ttl_shadow_ticks (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_tick_at        INTEGER NOT NULL,
        candidates_total    INTEGER NOT NULL,
        candidates_ttl_pass INTEGER NOT NULL,
        filtered_min        INTEGER NOT NULL,
        filtered_max        INTEGER NOT NULL,
        avg_ttl_pass        REAL,
        avg_ttl_filtered    REAL,
        band_min_days       REAL    NOT NULL,
        band_max_days       REAL    NOT NULL,
        created_at          INTEGER NOT NULL,
        UNIQUE(scan_tick_at)
      );
      CREATE INDEX IF NOT EXISTS idx_poly_ttl_shadow_ticks_at
        ON poly_ttl_shadow_ticks(scan_tick_at DESC);
    `);
  } finally {
    db.close();
  }
}
