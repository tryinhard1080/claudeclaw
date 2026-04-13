import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  pairedBrierDeltas, pairedTTest, compareStrategies,
  type PairedSample,
} from './strategy-compare.js';

describe('pairedBrierDeltas', () => {
  it('returns [] for empty input', () => {
    expect(pairedBrierDeltas([])).toEqual([]);
  });

  it('computes per-sample (brierA - brierB), positive = A worse', () => {
    // Two resolved markets, both won.
    // Market 1: A said 0.4 (squared err 0.36), B said 0.8 (squared err 0.04). delta = 0.32.
    // Market 2: A said 0.9 (err 0.01), B said 0.5 (err 0.25). delta = -0.24.
    const samples: PairedSample[] = [
      { probA: 0.4, probB: 0.8, outcome: 1 },
      { probA: 0.9, probB: 0.5, outcome: 1 },
    ];
    const deltas = pairedBrierDeltas(samples);
    expect(deltas[0]!).toBeCloseTo(0.32, 6);
    expect(deltas[1]!).toBeCloseTo(-0.24, 6);
  });

  it('zero delta when both strategies predict identically', () => {
    const samples: PairedSample[] = [
      { probA: 0.6, probB: 0.6, outcome: 1 },
      { probA: 0.3, probB: 0.3, outcome: 0 },
    ];
    expect(pairedBrierDeltas(samples)).toEqual([0, 0]);
  });
});

describe('pairedTTest', () => {
  it('returns zero t and pValue=1 for empty input (no data)', () => {
    const r = pairedTTest([]);
    expect(r.n).toBe(0);
    expect(r.t).toBe(0);
    expect(r.pValue).toBe(1);
    expect(r.meanDelta).toBe(0);
  });

  it('returns zero t and pValue=1 when all deltas are zero', () => {
    const r = pairedTTest([0, 0, 0, 0]);
    expect(r.t).toBe(0);
    expect(r.pValue).toBe(1);
    expect(r.meanDelta).toBe(0);
  });

  it('detects a clear signal with low p-value', () => {
    // Strongly positive deltas; mean ~0.2, small spread.
    const r = pairedTTest([0.18, 0.20, 0.22, 0.19, 0.21, 0.20]);
    expect(r.meanDelta).toBeCloseTo(0.2, 2);
    expect(r.t).toBeGreaterThan(10);  // very strong signal
    expect(r.pValue).toBeLessThan(0.01);
  });

  it('returns high p-value (~not-significant) on noisy small samples', () => {
    const r = pairedTTest([0.1, -0.1, 0.05, -0.05]);
    expect(Math.abs(r.meanDelta)).toBeLessThan(0.05);
    expect(r.pValue).toBeGreaterThan(0.5);
  });

  it('n=1 has infinite variance of mean — returns pValue=1', () => {
    const r = pairedTTest([0.5]);
    expect(r.n).toBe(1);
    expect(r.pValue).toBe(1);
  });

  it('meanDelta sign matches data sign', () => {
    expect(pairedTTest([-0.3, -0.2, -0.25, -0.4]).meanDelta).toBeLessThan(0);
    expect(pairedTTest([0.3, 0.2, 0.25, 0.4]).meanDelta).toBeGreaterThan(0);
  });
});

function bootDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_signals (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, market_price REAL, estimated_prob REAL, edge_pct REAL,
      confidence TEXT, reasoning TEXT, contrarian TEXT, approved INTEGER NOT NULL,
      rejection_reasons TEXT, paper_trade_id INTEGER,
      prompt_version TEXT, model TEXT);
    CREATE TABLE poly_paper_trades (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, side TEXT, entry_price REAL, size_usd REAL, shares REAL,
      kelly_fraction REAL, strategy TEXT, status TEXT,
      resolved_at INTEGER, realized_pnl REAL, voided_reason TEXT);
  `);
  return db;
}

function insertResolved(db: Database.Database, o: {
  slug: string; tokenId: string; prob: number; version: string;
  status: 'won'|'lost'|'voided'; resolvedAt: number;
}): void {
  const sig = db.prepare(`INSERT INTO poly_signals (created_at,market_slug,outcome_token_id,outcome_label,market_price,estimated_prob,edge_pct,confidence,reasoning,approved,prompt_version,model) VALUES (0,?,?,'Yes',0.4,?,10,'high','r',1,?,'claude-opus-4-6')`)
    .run(o.slug, o.tokenId, o.prob, o.version);
  const tradeId = sig.lastInsertRowid;
  db.prepare(`INSERT INTO poly_paper_trades (id,created_at,market_slug,outcome_token_id,outcome_label,side,entry_price,size_usd,shares,kelly_fraction,strategy,status,resolved_at,realized_pnl) VALUES (?,0,?,?,'Yes','BUY',0.4,50,125,0.25,'ai',?,?,0)`)
    .run(tradeId, o.slug, o.tokenId, o.status, o.resolvedAt);
  db.prepare(`UPDATE poly_signals SET paper_trade_id=? WHERE id=?`).run(tradeId, tradeId);
}

describe('compareStrategies', () => {
  it('empty overlap when versions have no markets in common', () => {
    const db = bootDb();
    insertResolved(db, { slug: 'a', tokenId: 't1', prob: 0.7, version: 'v3', status: 'won',  resolvedAt: 100 });
    insertResolved(db, { slug: 'b', tokenId: 't2', prob: 0.5, version: 'v4', status: 'lost', resolvedAt: 100 });
    const r = compareStrategies(db, 'v3', 'v4');
    expect(r.nPaired).toBe(0);
    expect(r.brierA).toBeNull();
    expect(r.brierB).toBeNull();
    expect(r.winner).toBe('tie');
  });

  it('pairs on (slug, outcome_token_id) when both versions evaluated the same market', () => {
    const db = bootDb();
    insertResolved(db, { slug: 'a', tokenId: 't1', prob: 0.4, version: 'v3', status: 'won', resolvedAt: 100 });
    insertResolved(db, { slug: 'a', tokenId: 't1', prob: 0.8, version: 'v4', status: 'won', resolvedAt: 100 });
    const r = compareStrategies(db, 'v3', 'v4');
    expect(r.nPaired).toBe(1);
    // A: (0.4-1)^2 = 0.36, B: (0.8-1)^2 = 0.04. B better.
    expect(r.brierA).toBeCloseTo(0.36, 6);
    expect(r.brierB).toBeCloseTo(0.04, 6);
  });

  it('declares winner=B when B has lower Brier AND difference is significant', () => {
    const db = bootDb();
    // 8 markets with realistic spread: A consistently calls 0.4-0.5 on winners,
    // B consistently calls 0.8-0.9. All outcomes are wins. Deltas are positive
    // and varied enough for the t-test to have non-zero variance.
    const data = [
      { probA: 0.40, probB: 0.85 },
      { probA: 0.45, probB: 0.80 },
      { probA: 0.38, probB: 0.88 },
      { probA: 0.42, probB: 0.82 },
      { probA: 0.48, probB: 0.90 },
      { probA: 0.41, probB: 0.83 },
      { probA: 0.46, probB: 0.87 },
      { probA: 0.43, probB: 0.81 },
    ];
    data.forEach((d, i) => {
      const slug = `m${i}`;
      insertResolved(db, { slug, tokenId: `t${i}`, prob: d.probA, version: 'v3', status: 'won', resolvedAt: 100 });
      insertResolved(db, { slug, tokenId: `t${i}`, prob: d.probB, version: 'v4', status: 'won', resolvedAt: 100 });
    });
    const r = compareStrategies(db, 'v3', 'v4');
    expect(r.nPaired).toBe(8);
    expect(r.winner).toBe('B');
    expect(r.tTest.pValue).toBeLessThan(0.05);
  });

  it('declares winner=tie when delta is not statistically significant', () => {
    const db = bootDb();
    // Small noise, no clear winner.
    insertResolved(db, { slug: 'a', tokenId: 't1', prob: 0.6, version: 'v3', status: 'won', resolvedAt: 100 });
    insertResolved(db, { slug: 'a', tokenId: 't1', prob: 0.62, version: 'v4', status: 'won', resolvedAt: 100 });
    insertResolved(db, { slug: 'b', tokenId: 't2', prob: 0.4, version: 'v3', status: 'lost', resolvedAt: 100 });
    insertResolved(db, { slug: 'b', tokenId: 't2', prob: 0.38, version: 'v4', status: 'lost', resolvedAt: 100 });
    const r = compareStrategies(db, 'v3', 'v4');
    expect(r.nPaired).toBe(2);
    expect(r.winner).toBe('tie');
  });

  it('excludes voided trades from the pairing', () => {
    const db = bootDb();
    insertResolved(db, { slug: 'a', tokenId: 't1', prob: 0.7, version: 'v3', status: 'voided', resolvedAt: 100 });
    insertResolved(db, { slug: 'a', tokenId: 't1', prob: 0.8, version: 'v4', status: 'voided', resolvedAt: 100 });
    const r = compareStrategies(db, 'v3', 'v4');
    expect(r.nPaired).toBe(0);
  });

  it('handles same version on both sides (nPaired = total resolved markets)', () => {
    const db = bootDb();
    insertResolved(db, { slug: 'a', tokenId: 't1', prob: 0.7, version: 'v3', status: 'won',  resolvedAt: 100 });
    insertResolved(db, { slug: 'b', tokenId: 't2', prob: 0.4, version: 'v3', status: 'lost', resolvedAt: 100 });
    const r = compareStrategies(db, 'v3', 'v3');
    expect(r.nPaired).toBe(2);
    expect(r.winner).toBe('tie');
    expect(r.tTest.meanDelta).toBe(0);
  });
});
