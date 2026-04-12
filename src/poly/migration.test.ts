import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runAt } from '../../migrations/v1.2.0/v1.2.0-poly.js';

describe('poly migration', () => {
  it('creates 6 tables, 3 expected indexes, and is idempotent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polymigr-'));
    const dbPath = path.join(dir, 'test.db');
    await runAt(dbPath);
    await runAt(dbPath); // second run must not throw

    const db = new Database(dbPath);
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'poly_%' ORDER BY name`,
      )
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual([
      'poly_eval_cache',
      'poly_markets',
      'poly_paper_trades',
      'poly_positions',
      'poly_price_history',
      'poly_signals',
    ]);

    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_poly_%' ORDER BY name`,
      )
      .all()
      .map((r: any) => r.name);
    expect(idx).toContain('idx_poly_markets_volume');
    expect(idx).toContain('idx_poly_signals_created');
    expect(idx).toContain('idx_poly_paper_trades_status');

    // Spot-check poly_paper_trades schema has voided_reason column
    const cols = db
      .prepare(`PRAGMA table_info(poly_paper_trades)`)
      .all()
      .map((r: any) => r.name);
    expect(cols).toContain('voided_reason');
    expect(cols).toContain('status');

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
