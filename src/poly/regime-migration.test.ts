import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { runAt } from '../../migrations/v1.5.0/v1.5.0-regime-tagging.js';

function bootWithSignalsTable(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE poly_signals (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, market_price REAL, estimated_prob REAL, edge_pct REAL,
      confidence TEXT, reasoning TEXT, contrarian TEXT, approved INTEGER NOT NULL,
      rejection_reasons TEXT, paper_trade_id INTEGER,
      prompt_version TEXT, model TEXT);
  `);
  db.close();
}

describe('v1.5.0 regime-tagging migration', () => {
  it('creates poly_regime_snapshots with expected columns + index', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-rg-mig-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    bootWithSignalsTable(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const cols = db.prepare(`PRAGMA table_info(poly_regime_snapshots)`).all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['id', 'created_at', 'vix', 'btc_dominance', 'yield_10y', 'regime_label']),
    );
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='poly_regime_snapshots'`).all() as Array<{ name: string }>;
    expect(idx.map(i => i.name)).toContain('idx_poly_regime_snapshots_created');
    db.close();
    fs.unlinkSync(tmp);
  });

  it('adds regime_label column to poly_signals (nullable) + index', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-rg-mig-sig-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    bootWithSignalsTable(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const cols = db.prepare(`PRAGMA table_info(poly_signals)`).all() as Array<{ name: string; notnull: number }>;
    const reg = cols.find(c => c.name === 'regime_label');
    expect(reg).toBeDefined();
    expect(reg!.notnull).toBe(0);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='poly_signals'`).all() as Array<{ name: string }>;
    expect(idx.map(i => i.name)).toContain('idx_poly_signals_regime');
    db.close();
    fs.unlinkSync(tmp);
  });

  it('is idempotent (safe to run twice)', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-rg-mig-idem-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    bootWithSignalsTable(tmp);
    await runAt(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const sigCols = db.prepare(`PRAGMA table_info(poly_signals)`).all() as Array<{ name: string }>;
    expect(sigCols.filter(c => c.name === 'regime_label')).toHaveLength(1);
    const tabs = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='poly_regime_snapshots'`).all();
    expect(tabs).toHaveLength(1);
    db.close();
    fs.unlinkSync(tmp);
  });

  it('preserves existing signal data', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-rg-mig-data-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    bootWithSignalsTable(tmp);
    const db = new Database(tmp);
    db.prepare(`INSERT INTO poly_signals (created_at,market_slug,outcome_token_id,outcome_label,market_price,estimated_prob,edge_pct,confidence,reasoning,approved) VALUES (100,'slug','tok','Yes',0.4,0.6,20,'high','r',1)`).run();
    db.close();
    await runAt(tmp);
    const r = new Database(tmp, { readonly: true });
    const row = r.prepare(`SELECT market_slug, regime_label FROM poly_signals WHERE id=1`).get() as { market_slug: string; regime_label: string | null };
    expect(row.market_slug).toBe('slug');
    expect(row.regime_label).toBeNull();
    r.close();
    fs.unlinkSync(tmp);
  });
});
