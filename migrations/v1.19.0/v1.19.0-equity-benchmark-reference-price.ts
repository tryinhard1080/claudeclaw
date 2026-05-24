import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add reference_price to equity_benchmark_snapshots for benchmark writer';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    const cols = db.prepare('PRAGMA table_info(equity_benchmark_snapshots)').all() as Array<{ name: string }>;
    if (!cols.some(col => col.name === 'reference_price')) {
      db.exec('ALTER TABLE equity_benchmark_snapshots ADD COLUMN reference_price REAL;');
    }
  } finally {
    db.close();
  }
}

