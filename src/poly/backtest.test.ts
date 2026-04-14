import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  simulateOutcome, runBacktest, loadHistoricalSignals, loadResolutions,
  persistResolution, composeMinEdgeSweep,
  type HistoricalSignal, type Resolution, type BacktestParams, type OutcomeRow,
} from './backtest.js';

const yes = 'tok-yes';
const no = 'tok-no';

function resolvedYes(slug: string): Resolution {
  return {
    slug, closed: true,
    outcomes: [
      { label: 'Yes', tokenId: yes, price: 1 },
      { label: 'No', tokenId: no, price: 0 },
    ],
  };
}

function resolvedNo(slug: string): Resolution {
  return {
    slug, closed: true,
    outcomes: [
      { label: 'Yes', tokenId: yes, price: 0 },
      { label: 'No', tokenId: no, price: 1 },
    ],
  };
}

function signal(overrides: Partial<HistoricalSignal> = {}): HistoricalSignal {
  return {
    id: 1, createdAt: 100, marketSlug: 's1',
    outcomeTokenId: yes, outcomeLabel: 'Yes',
    marketPrice: 0.4, estimatedProb: 0.6, edgePct: 20,
    ...overrides,
  };
}

describe('simulateOutcome', () => {
  const size = 50; // USD

  it('won: P&L = shares * (1 - entry)', () => {
    const out = simulateOutcome(signal(), resolvedYes('s1'), size);
    expect(out.status).toBe('won');
    // shares = size / price = 50 / 0.4 = 125; payoff = 125 * (1 - 0.4) = 75
    expect(out.realizedPnl).toBeCloseTo(75, 6);
    expect(out.shares).toBeCloseTo(125, 6);
  });

  it('lost: P&L = -size (you paid for shares, they expire worthless)', () => {
    const out = simulateOutcome(signal(), resolvedNo('s1'), size);
    expect(out.status).toBe('lost');
    expect(out.realizedPnl).toBeCloseTo(-50, 6);
  });

  it('voided (no resolution yet): status=open, pnl=0', () => {
    const out = simulateOutcome(signal(), { slug: 's1', closed: false, outcomes: [] }, size);
    expect(out.status).toBe('open');
    expect(out.realizedPnl).toBe(0);
  });

  it('voided (unresolved multi-winner): pnl=0', () => {
    const out = simulateOutcome(signal(), {
      slug: 's1', closed: true,
      outcomes: [
        { label: 'Yes', tokenId: yes, price: 0.5 },
        { label: 'No', tokenId: no, price: 0.5 },
      ],
    }, size);
    expect(out.status).toBe('voided');
    expect(out.realizedPnl).toBe(0);
  });

  it('missing resolution → voided/delisted with pnl=0', () => {
    const out = simulateOutcome(signal(), null, size);
    expect(out.status).toBe('voided');
    expect(out.realizedPnl).toBe(0);
  });
});

describe('runBacktest min-edge sweep', () => {
  const params: BacktestParams = {
    minEdgePct: 8, kellyFraction: 0.25, maxTradeUsd: 50, paperCapital: 5000,
  };

  it('approves only signals meeting the min-edge threshold', () => {
    const sigs: HistoricalSignal[] = [
      signal({ id: 1, edgePct: 10 }),  // passes
      signal({ id: 2, edgePct: 5 }),   // rejected
      signal({ id: 3, edgePct: 20 }),  // passes
    ];
    const r = runBacktest({ signals: sigs, resolutions: new Map(), params });
    expect(r.approvedCount).toBe(2);
    expect(r.rejectedForEdge).toBe(1);
  });

  it('only counts resolved trades in winRate + brier', () => {
    // Each signal needs prob > market_price for Kelly > 0, else it's skipped.
    const sigs: HistoricalSignal[] = [
      signal({ id: 1, marketSlug: 'a', estimatedProb: 0.7, marketPrice: 0.4, edgePct: 30 }),
      signal({ id: 2, marketSlug: 'b', estimatedProb: 0.5, marketPrice: 0.3, edgePct: 15 }),
      signal({ id: 3, marketSlug: 'open', estimatedProb: 0.6, marketPrice: 0.4, edgePct: 12 }),
    ];
    const resolutions = new Map<string, Resolution>([
      ['a', resolvedYes('a')],
      ['b', resolvedNo('b')],
      ['open', { slug: 'open', closed: false, outcomes: [] }],
    ]);
    const r = runBacktest({ signals: sigs, resolutions, params });
    expect(r.resolvedCount).toBe(2);
    expect(r.winCount).toBe(1);  // 'a' Yes won
    expect(r.winRate).toBeCloseTo(0.5, 6);
    expect(r.brierScore).toBeCloseTo(((0.7-1)**2 + (0.5-0)**2)/2, 6);
  });

  it('aggregates total realized P&L across resolved trades', () => {
    const sigs: HistoricalSignal[] = [
      signal({ id: 1, marketSlug: 'a', marketPrice: 0.4, estimatedProb: 0.6, edgePct: 20 }),
      signal({ id: 2, marketSlug: 'b', marketPrice: 0.3, estimatedProb: 0.6, edgePct: 30 }),
    ];
    const resolutions = new Map<string, Resolution>([
      ['a', resolvedYes('a')],
      ['b', resolvedNo('b')],
    ]);
    const r = runBacktest({ signals: sigs, resolutions, params });
    // Both at max kelly→ size=50 each. Win 'a' @ 0.4: +50*(1-0.4)/0.4 = +75. Lose 'b' @ 0.3: -50.
    expect(r.totalPnl).toBeCloseTo(75 - 50, 2);
  });

  it('skips signals that would produce zero Kelly size', () => {
    const sigs: HistoricalSignal[] = [
      // edge>threshold but probability < market price → Kelly size = 0
      signal({ id: 1, estimatedProb: 0.3, marketPrice: 0.4, edgePct: 10 }),
    ];
    const r = runBacktest({ signals: sigs, resolutions: new Map(), params });
    expect(r.skippedForZeroSize).toBe(1);
  });
});

describe('composeMinEdgeSweep', () => {
  it('returns one report per threshold, sorted ascending', () => {
    const sigs: HistoricalSignal[] = [
      signal({ id: 1, marketSlug: 'a', edgePct: 5 }),
      signal({ id: 2, marketSlug: 'b', edgePct: 15 }),
      signal({ id: 3, marketSlug: 'c', edgePct: 25 }),
    ];
    const rs = composeMinEdgeSweep({
      signals: sigs, resolutions: new Map(),
      base: { kellyFraction: 0.25, maxTradeUsd: 50, paperCapital: 5000 },
      thresholds: [5, 15, 25],
    });
    expect(rs).toHaveLength(3);
    expect(rs[0]!.minEdgePct).toBe(5);
    expect(rs[0]!.approvedCount).toBe(3);
    expect(rs[1]!.approvedCount).toBe(2);
    expect(rs[2]!.approvedCount).toBe(1);
  });
});

function bootDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      market_slug TEXT, outcome_token_id TEXT, outcome_label TEXT,
      market_price REAL, estimated_prob REAL, edge_pct REAL,
      confidence TEXT, reasoning TEXT, contrarian TEXT, approved INTEGER NOT NULL,
      rejection_reasons TEXT, paper_trade_id INTEGER,
      prompt_version TEXT, model TEXT, regime_label TEXT);
    CREATE TABLE poly_resolutions (
      slug TEXT PRIMARY KEY, closed INTEGER NOT NULL,
      outcomes_json TEXT NOT NULL, fetched_at INTEGER NOT NULL,
      resolved_at INTEGER);
  `);
  return db;
}

describe('loadHistoricalSignals', () => {
  it('returns signals in a time window', () => {
    const db = bootDb();
    db.prepare(`INSERT INTO poly_signals (created_at,market_slug,outcome_token_id,outcome_label,market_price,estimated_prob,edge_pct,approved) VALUES (100,'a','toka','Yes',0.4,0.6,20,1)`).run();
    db.prepare(`INSERT INTO poly_signals (created_at,market_slug,outcome_token_id,outcome_label,market_price,estimated_prob,edge_pct,approved) VALUES (200,'b','tokb','Yes',0.4,0.7,25,0)`).run();
    const sigs = loadHistoricalSignals(db, { fromSec: 150, toSec: 1000 });
    expect(sigs).toHaveLength(1);
    expect(sigs[0]!.marketSlug).toBe('b');
  });

  it('only returns Yes-side signals (matches current strategy)', () => {
    const db = bootDb();
    db.prepare(`INSERT INTO poly_signals (created_at,market_slug,outcome_token_id,outcome_label,market_price,estimated_prob,edge_pct,approved) VALUES (100,'a','toka','No',0.4,0.6,20,1)`).run();
    expect(loadHistoricalSignals(db, { fromSec: 0, toSec: 1000 })).toHaveLength(0);
  });
});

describe('persistResolution + loadResolutions', () => {
  it('UPSERTs by slug', () => {
    const db = bootDb();
    const outcomes: OutcomeRow[] = [
      { label: 'Yes', tokenId: yes, price: 1 },
      { label: 'No', tokenId: no, price: 0 },
    ];
    persistResolution(db, { slug: 's1', closed: true, outcomes, fetchedAtSec: 100 });
    persistResolution(db, { slug: 's1', closed: true, outcomes, fetchedAtSec: 200 });
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM poly_resolutions`).get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it('loadResolutions returns a slug→Resolution map', () => {
    const db = bootDb();
    const outcomes: OutcomeRow[] = [
      { label: 'Yes', tokenId: yes, price: 1 },
      { label: 'No', tokenId: no, price: 0 },
    ];
    persistResolution(db, { slug: 's1', closed: true, outcomes, fetchedAtSec: 100 });
    const map = loadResolutions(db);
    expect(map.get('s1')?.closed).toBe(true);
    expect(map.get('s1')?.outcomes).toHaveLength(2);
  });
});
