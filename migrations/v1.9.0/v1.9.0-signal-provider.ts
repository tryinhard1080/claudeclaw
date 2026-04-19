import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description = 'Add poly_signals.provider column to distinguish Anthropic vs GLM-era signals';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * Phase 0.5 Stage 4 — observability column for LLM provider partitioning.
 *
 * Pre-2026-04-18 halt, every approved signal came from Anthropic (Opus by
 * default per the now-stale POLY_MODEL='claude-opus-4-6'). Post-restart,
 * signals come from Z.ai's GLM 5.1 subscription. The existing `model` column
 * tracks the fine-grained model ID, but we also want a coarse-grained
 * `provider` dimension so Brier/log-loss reports can partition cleanly by
 * vendor without hard-coding model-name-to-vendor mappings.
 *
 * Values: 'anthropic' | 'glm' | future vendors.
 *
 * Backfill: all pre-migration rows tagged 'anthropic' (safe assumption — no
 * GLM code path existed before 2026-04-19). New rows populated by
 * strategy-engine.ts::insertSignal going forward.
 *
 * ALTER TABLE ADD COLUMN on SQLite is O(1) metadata-only — zero-downtime
 * safe even on tables with millions of rows. NOT NULL is deliberately
 * omitted so existing rows without the column (pre-backfill) don't trip
 * constraint errors mid-migration.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    // ALTER TABLE ADD COLUMN is idempotent only if we guard with PRAGMA
    // table_info — ADD COLUMN on an existing column raises a hard error.
    const cols = db.prepare(`PRAGMA table_info(poly_signals)`).all() as Array<{ name: string }>;
    const hasProvider = cols.some(c => c.name === 'provider');
    if (!hasProvider) {
      db.exec(`ALTER TABLE poly_signals ADD COLUMN provider TEXT`);
    }
    // Backfill pre-migration rows. Safe to re-run — WHERE provider IS NULL
    // ensures we don't clobber new rows that already have a provider set.
    db.exec(`UPDATE poly_signals SET provider='anthropic' WHERE provider IS NULL`);
  } finally {
    db.close();
  }
}
