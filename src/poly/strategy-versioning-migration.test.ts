import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { runAt } from '../../migrations/v1.4.0/v1.4.0-strategy-versioning.js';

function bootWithSignalsTable(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE poly_signals (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, market_price REAL, estimated_prob REAL, edge_pct REAL,
      confidence TEXT, reasoning TEXT, contrarian TEXT, approved INTEGER NOT NULL,
      rejection_reasons TEXT, paper_trade_id INTEGER);
  `);
  db.close();
}

describe('v1.4.0 strategy-versioning migration', () => {
  it('adds prompt_version + model columns (nullable) and an index', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-sv-mig-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    bootWithSignalsTable(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const cols = db.prepare(`PRAGMA table_info(poly_signals)`).all() as Array<{ name: string; notnull: number }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('prompt_version');
    expect(names).toContain('model');
    const pv = cols.find(c => c.name === 'prompt_version')!;
    const mo = cols.find(c => c.name === 'model')!;
    expect(pv.notnull).toBe(0);
    expect(mo.notnull).toBe(0);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='poly_signals'`).all() as Array<{ name: string }>;
    expect(idx.map(i => i.name)).toContain('idx_poly_signals_version');
    db.close();
    fs.unlinkSync(tmp);
  });

  it('is idempotent (safe to run twice)', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-sv-mig-idem-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    bootWithSignalsTable(tmp);
    await runAt(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const cols = db.prepare(`PRAGMA table_info(poly_signals)`).all() as Array<{ name: string }>;
    expect(cols.filter(c => c.name === 'prompt_version')).toHaveLength(1);
    expect(cols.filter(c => c.name === 'model')).toHaveLength(1);
    db.close();
    fs.unlinkSync(tmp);
  });

  it('preserves existing signal data (no corruption)', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-sv-mig-data-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    bootWithSignalsTable(tmp);
    const db = new Database(tmp);
    db.prepare(`INSERT INTO poly_signals (created_at,market_slug,outcome_token_id,outcome_label,market_price,estimated_prob,edge_pct,confidence,reasoning,approved) VALUES (100,'slug','tok','Yes',0.4,0.6,20,'high','r',1)`).run();
    db.close();
    await runAt(tmp);
    const readDb = new Database(tmp, { readonly: true });
    const row = readDb.prepare(`SELECT market_slug, prompt_version, model FROM poly_signals WHERE id=1`).get() as { market_slug: string; prompt_version: string | null; model: string | null };
    expect(row.market_slug).toBe('slug');
    expect(row.prompt_version).toBeNull();
    expect(row.model).toBeNull();
    readDb.close();
    fs.unlinkSync(tmp);
  });
});
