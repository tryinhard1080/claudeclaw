import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { runAt } from '../../migrations/v1.20.0/v1.20.0-signal-source-context.js';

function bootWithSignalsTable(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE poly_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      market_slug TEXT,
      outcome_token_id TEXT,
      outcome_label TEXT,
      market_price REAL,
      estimated_prob REAL,
      edge_pct REAL,
      confidence TEXT,
      reasoning TEXT,
      contrarian TEXT,
      approved INTEGER NOT NULL,
      rejection_reasons TEXT,
      paper_trade_id INTEGER,
      prompt_version TEXT,
      model TEXT,
      regime_label TEXT,
      provider TEXT
    );
  `);
  db.close();
}

describe('v1.20.0 signal source context migration', () => {
  it('adds nullable source_context_json to poly_signals', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-source-context-mig-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    bootWithSignalsTable(tmp);

    await runAt(tmp);

    const db = new Database(tmp, { readonly: true });
    const cols = db.prepare('PRAGMA table_info(poly_signals)').all() as Array<{ name: string; notnull: number }>;
    const sourceContext = cols.find(col => col.name === 'source_context_json');
    expect(sourceContext).toBeDefined();
    expect(sourceContext!.notnull).toBe(0);
    db.close();
    fs.unlinkSync(tmp);
  });

  it('is idempotent', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-source-context-mig-idem-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    bootWithSignalsTable(tmp);

    await runAt(tmp);
    await runAt(tmp);

    const db = new Database(tmp, { readonly: true });
    const cols = db.prepare('PRAGMA table_info(poly_signals)').all() as Array<{ name: string }>;
    expect(cols.filter(col => col.name === 'source_context_json')).toHaveLength(1);
    db.close();
    fs.unlinkSync(tmp);
  });
});
