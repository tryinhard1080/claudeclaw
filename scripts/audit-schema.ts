/**
 * Read-only schema audit for claudeclaw.db.
 *
 * Prints every table + index in the live DB and cross-references them
 * against the migrations/ directory. Used before and after npm run
 * migrate to verify the applied state matches what's registered in
 * migrations/version.json + migrations/.applied.json.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { STORE_DIR, PROJECT_ROOT } from '../src/config.js';

interface AppliedState {
  lastApplied: string | null;
}

function main(): void {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');

  console.log(`DB: ${dbPath}`);
  const dbSize = fs.statSync(dbPath).size;
  console.log(`  size: ${(dbSize / 1024 / 1024).toFixed(1)} MB`);
  const walPath = dbPath + '-wal';
  if (fs.existsSync(walPath)) {
    const walSize = fs.statSync(walPath).size;
    console.log(`  wal:  ${(walSize / 1024 / 1024).toFixed(1)} MB`);
  }
  console.log();

  const appliedPath = path.join(PROJECT_ROOT, 'migrations', '.applied.json');
  const applied: AppliedState = fs.existsSync(appliedPath)
    ? JSON.parse(fs.readFileSync(appliedPath, 'utf-8'))
    : { lastApplied: null };
  console.log(`Applied: ${applied.lastApplied ?? '(none)'}`);

  const versionPath = path.join(PROJECT_ROOT, 'migrations', 'version.json');
  const registry = JSON.parse(fs.readFileSync(versionPath, 'utf-8')) as {
    migrations: Record<string, string[]>;
  };
  const versions = Object.keys(registry.migrations).sort();
  const latest = versions[versions.length - 1]!;
  console.log(`Latest:  ${latest}`);
  console.log(`Known:   ${versions.join(', ')}`);
  console.log();

  const tables = db
    .prepare(
      `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as Array<{ name: string; sql: string | null }>;
  console.log(`Tables (${tables.length}):`);
  for (const t of tables) {
    let rowCount: string;
    try {
      const r = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number };
      rowCount = r.n.toLocaleString();
    } catch {
      rowCount = '?';
    }
    console.log(`  ${t.name.padEnd(36)} ${rowCount.padStart(12)} rows`);
  }
  console.log();

  const indexes = db
    .prepare(
      `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name`,
    )
    .all() as Array<{ name: string; tbl_name: string; sql: string | null }>;
  console.log(`Indexes (${indexes.length}):`);
  for (const i of indexes) {
    console.log(`  ${i.tbl_name}.${i.name}`);
  }
  console.log();

  // Cross-reference: which tables appear in migrations that the registry
  // knows about? We can't perfectly diff without executing migrations,
  // but we can surface tables the live DB has that are not in the
  // expected set (zombies) and tables the registry implies that are
  // missing.
  const expectedTables = new Set<string>([
    'scheduled_tasks', 'sessions', 'conversation_log',
    'memories', 'consolidations', 'memories_fts',
    'mission_tasks', 'hive_mind', 'inter_agent_tasks',
    'token_usage', 'pin_attempts', 'audit_log',
    'poly_markets', 'poly_price_history', 'poly_signals', 'poly_paper_trades',
    'poly_positions', 'poly_eval_cache', 'poly_kv',
    'poly_calibration_snapshots', 'poly_regime_snapshots',
    'research_items', 'poly_scan_runs', 'poly_resolutions',
  ]);
  const liveTableNames = new Set(tables.map(t => t.name));
  const unexpected = [...liveTableNames].filter(n => !expectedTables.has(n)).sort();
  const missing = [...expectedTables].filter(n => !liveTableNames.has(n)).sort();
  console.log('Cross-ref against expected schema:');
  console.log(`  Unexpected (live but not in expected set): ${unexpected.length === 0 ? '(none)' : unexpected.join(', ')}`);
  console.log(`  Missing    (expected but not in live DB): ${missing.length === 0 ? '(none)' : missing.join(', ')}`);

  db.close();
}

main();
