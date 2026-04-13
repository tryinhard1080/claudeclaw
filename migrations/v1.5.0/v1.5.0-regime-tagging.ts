import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description = 'Add poly_regime_snapshots table + regime_label column on poly_signals (Sprint 3 regime tagging)';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * Idempotent: CREATE TABLE IF NOT EXISTS is safe; column add is guarded
 * by PRAGMA table_info since SQLite ADD COLUMN throws on duplicates.
 *
 * regime_label is the composed bucket tag from regime.ts (e.g. "vnorm_bmix_ymid"),
 * not the raw numeric snapshot — stored per-signal so historical Brier can be
 * grouped by regime even if bucket thresholds later change.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS poly_regime_snapshots (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at    INTEGER NOT NULL,
        vix           REAL,
        btc_dominance REAL,
        yield_10y     REAL,
        regime_label  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_poly_regime_snapshots_created
        ON poly_regime_snapshots(created_at DESC);
    `);

    const existing = new Set(
      (db.prepare(`PRAGMA table_info(poly_signals)`).all() as Array<{ name: string }>)
        .map(c => c.name),
    );
    if (!existing.has('regime_label')) {
      db.exec(`ALTER TABLE poly_signals ADD COLUMN regime_label TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_poly_signals_regime ON poly_signals(regime_label)`);

    // Per-regime Brier breakdown lives in a JSON blob on the calibration
    // snapshot row so we don't need a separate snapshots×regimes table.
    // Guard with PRAGMA to stay idempotent. Only add if the base
    // calibration table exists (it will on any post-v1.3.0 install).
    const hasCal = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='poly_calibration_snapshots'`,
    ).get();
    if (hasCal) {
      const calCols = new Set(
        (db.prepare(`PRAGMA table_info(poly_calibration_snapshots)`).all() as Array<{ name: string }>)
          .map(c => c.name),
      );
      if (!calCols.has('by_regime_json')) {
        db.exec(`ALTER TABLE poly_calibration_snapshots ADD COLUMN by_regime_json TEXT`);
      }
    }
  } finally {
    db.close();
  }
}
