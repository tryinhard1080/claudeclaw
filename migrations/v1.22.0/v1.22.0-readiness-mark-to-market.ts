import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add Polymarket mark-to-market fields to readiness evidence snapshots';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  if (cols.some(col => col.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
}

export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS readiness_evidence_snapshots (
        snapshot_ymd                  TEXT PRIMARY KEY,
        captured_at                   INTEGER NOT NULL,
        status                        TEXT NOT NULL,
        poly_settled_trades           INTEGER NOT NULL,
        poly_target_settled_trades    INTEGER NOT NULL,
        poly_realized_pnl_usd         REAL NOT NULL,
        poly_open_trades              INTEGER NOT NULL,
        poly_voided_trades            INTEGER NOT NULL,
        poly_due_next_7d              INTEGER NOT NULL,
        poly_due_next_30d             INTEGER NOT NULL,
        poly_overdue_open_trades      INTEGER NOT NULL,
        regime_min_days               INTEGER NOT NULL,
        regime_target_days            INTEGER NOT NULL,
        regime_all_instances_positive INTEGER NOT NULL,
        ttl_candidates_total          INTEGER NOT NULL,
        ttl_candidates_ttl_pass       INTEGER NOT NULL,
        ttl_pass_rate                 REAL,
        payload_json                  TEXT NOT NULL
      );
    `);
    addColumnIfMissing(db, 'readiness_evidence_snapshots', 'poly_unrealized_pnl_usd', 'poly_unrealized_pnl_usd REAL NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'readiness_evidence_snapshots', 'poly_total_pnl_usd', 'poly_total_pnl_usd REAL NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'readiness_evidence_snapshots', 'poly_paper_equity_usd', 'poly_paper_equity_usd REAL NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'readiness_evidence_snapshots', 'poly_approval_rate_24h', 'poly_approval_rate_24h REAL');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_readiness_evidence_captured_at
        ON readiness_evidence_snapshots(captured_at DESC);
    `);
  } finally {
    db.close();
  }
}
