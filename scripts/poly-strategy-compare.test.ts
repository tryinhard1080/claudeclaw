import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import {
  formatStrategyComparison,
  runStrategyComparison,
} from './poly-strategy-compare.js';

function bootDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_signals (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, market_price REAL, estimated_prob REAL, edge_pct REAL,
      confidence TEXT, reasoning TEXT, contrarian TEXT, approved INTEGER NOT NULL,
      rejection_reasons TEXT, paper_trade_id INTEGER,
      prompt_version TEXT, model TEXT);
    CREATE TABLE poly_resolutions (slug TEXT PRIMARY KEY, closed INTEGER NOT NULL,
      outcomes_json TEXT NOT NULL, fetched_at INTEGER NOT NULL, resolved_at INTEGER);
  `);
  return db;
}

function insertSignal(
  db: Database.Database,
  o: { slug: string; tokenId: string; prob: number; version: string; rejection?: string },
): void {
  db.prepare(`
    INSERT INTO poly_signals (
      created_at, market_slug, outcome_token_id, outcome_label, market_price,
      estimated_prob, edge_pct, confidence, reasoning, approved,
      rejection_reasons, paper_trade_id, prompt_version, model
    ) VALUES (0, ?, ?, 'Yes', 0.4, ?, 10, 'high', 'r', 0, ?, NULL, ?, 'weather-goat')
  `).run(o.slug, o.tokenId, o.prob, o.rejection ?? null, o.version);
}

function insertResolution(db: Database.Database, slug: string, winningTokenId: string): void {
  db.prepare(`
    INSERT INTO poly_resolutions (slug, closed, outcomes_json, fetched_at, resolved_at)
    VALUES (?, 1, ?, 0, 0)
  `).run(slug, JSON.stringify([
    { label: 'Yes', tokenId: winningTokenId, price: 1 },
    { label: 'No', tokenId: 'no-token', price: 0 },
  ]));
}

describe('poly-strategy-compare script helpers', () => {
  it('compares weather shadow signals that have no paper trade', () => {
    const db = bootDb();
    insertSignal(db, { slug: 'seattle-high', tokenId: 'yes-token', prob: 0.4, version: 'v3' });
    insertSignal(db, {
      slug: 'seattle-high',
      tokenId: 'yes-token',
      prob: 0.7,
      version: 'v3-weather-shadow',
      rejection: 'shadow:weather',
    });
    insertResolution(db, 'seattle-high', 'yes-token');

    const result = runStrategyComparison(db, 'v3', 'v3-weather-shadow');

    expect(result.nPaired).toBe(1);
    expect(result.brierA).toBeCloseTo(0.36, 6);
    expect(result.brierB).toBeCloseTo(0.09, 6);
  });

  it('formats no-overlap output with resolution-based guidance', () => {
    const db = bootDb();
    const output = formatStrategyComparison(runStrategyComparison(db, 'v3', 'v3-weather-shadow'));

    expect(output).toContain('No resolved signal overlap yet.');
    expect(output).toContain('shadow rows');
  });
});
