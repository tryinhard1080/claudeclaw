import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add source_context_json to poly_signals for per-signal source provenance';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    const cols = db.prepare('PRAGMA table_info(poly_signals)').all() as Array<{ name: string }>;
    if (!cols.some(col => col.name === 'source_context_json')) {
      db.exec('ALTER TABLE poly_signals ADD COLUMN source_context_json TEXT;');
    }
  } finally {
    db.close();
  }
}
