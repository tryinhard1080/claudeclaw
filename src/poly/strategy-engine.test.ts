import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import type { ClobBook, Market, ProbabilityEstimate } from './types.js';
import { StrategyEngine, computeKellySize } from './strategy-engine.js';

function bootDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_markets (slug TEXT PRIMARY KEY, condition_id TEXT, question TEXT,
      category TEXT, outcomes_json TEXT, volume_24h REAL, liquidity REAL,
      end_date INTEGER, closed INTEGER, resolution TEXT, last_scan_at INTEGER);
    CREATE TABLE poly_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      market_slug TEXT, outcome_token_id TEXT, outcome_label TEXT,
      market_price REAL, estimated_prob REAL, edge_pct REAL, confidence TEXT,
      reasoning TEXT, contrarian TEXT, approved INTEGER NOT NULL,
      rejection_reasons TEXT, paper_trade_id INTEGER,
      prompt_version TEXT, model TEXT, regime_label TEXT);
    CREATE TABLE poly_regime_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      vix REAL, btc_dominance REAL, yield_10y REAL, regime_label TEXT NOT NULL);
    CREATE TABLE poly_paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      market_slug TEXT, outcome_token_id TEXT, outcome_label TEXT, side TEXT,
      entry_price REAL, size_usd REAL, shares REAL, kelly_fraction REAL,
      strategy TEXT, status TEXT, resolved_at INTEGER, realized_pnl REAL,
      voided_reason TEXT);
    CREATE TABLE poly_positions (
      paper_trade_id INTEGER PRIMARY KEY, market_slug TEXT,
      current_price REAL, unrealized_pnl REAL, updated_at INTEGER);
  `);
  return db;
}

function mkMarket(overrides: Partial<Market> = {}): Market {
  const now = Date.now();
  return {
    slug: 'will-x-happen',
    conditionId: '0xabc',
    question: 'Will X happen?',
    category: 'politics',
    outcomes: [
      { label: 'Yes', tokenId: 'tok-yes', price: 0.4 },
      { label: 'No', tokenId: 'tok-no', price: 0.6 },
    ],
    volume24h: 50_000,
    liquidity: 20_000,
    endDate: Math.floor(now / 1000) + 7 * 24 * 3600,
    closed: false,
    ...overrides,
  };
}

function mkBook(bestAsk: number, depthShares: number): ClobBook {
  return {
    bids: [{ price: bestAsk - 0.02, size: depthShares }],
    asks: [{ price: bestAsk, size: depthShares }],
  };
}

function mkEst(probability: number, confidence: ProbabilityEstimate['confidence'] = 'high'): ProbabilityEstimate {
  return { probability, confidence, reasoning: 'test', contrarian: 'counter' };
}

describe('computeKellySize', () => {
  it('returns 0 when edge is non-positive', () => {
    expect(computeKellySize({ probability: 0.3, ask: 0.4, kellyFraction: 0.25, paperCapital: 5000, maxTradeUsd: 50 })).toBe(0);
    expect(computeKellySize({ probability: 0.4, ask: 0.4, kellyFraction: 0.25, paperCapital: 5000, maxTradeUsd: 50 })).toBe(0);
  });

  it('scales by kelly fraction and paper capital', () => {
    // full Kelly f* = (0.6 - 0.4)/(1-0.4) = 1/3 ≈ 0.333; 0.25 * 0.333 * 5000 ≈ 416.67, capped to 50
    expect(computeKellySize({ probability: 0.6, ask: 0.4, kellyFraction: 0.25, paperCapital: 5000, maxTradeUsd: 50 })).toBe(50);
  });

  it('returns the uncapped amount when below maxTrade', () => {
    // f* = 0.02/0.6 = 0.0333; 0.25 * 0.0333 * 1000 ≈ 8.33
    const size = computeKellySize({ probability: 0.42, ask: 0.4, kellyFraction: 0.25, paperCapital: 1000, maxTradeUsd: 50 });
    expect(size).toBeCloseTo(8.33, 2);
  });

  it('clamps to 0 when ask >= 1 (degenerate)', () => {
    expect(computeKellySize({ probability: 0.99, ask: 1, kellyFraction: 0.25, paperCapital: 5000, maxTradeUsd: 50 })).toBe(0);
  });
});

describe('StrategyEngine.onScanComplete', () => {
  let db: Database.Database;
  let scanner: EventEmitter;

  beforeEach(() => {
    db = bootDb();
    scanner = new EventEmitter();
  });

  it('skips entire cycle when poly.halt=1', async () => {
    const engine = new StrategyEngine({
      db,
      scanner,
      paperCapital: 5000,
      minVolumeUsd: 0,
      minTtrHours: 0,
      topN: 10,
      maxTradeUsd: 50,
      kellyFraction: 0.25,
      evaluate: async () => mkEst(0.7),
      fetchBook: async () => mkBook(0.4, 1000),
    });
    db.prepare(`CREATE TABLE IF NOT EXISTS poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
    db.prepare(`INSERT INTO poly_kv VALUES ('poly.halt','1')`).run();

    await engine.onScanComplete({ markets: [mkMarket()] });
    const signals = db.prepare(`SELECT COUNT(*) AS n FROM poly_signals`).get() as { n: number };
    expect(signals.n).toBe(0);
  });

  it('happy path: creates approved signal and executes paper trade', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 10_000, minTtrHours: 24,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.6),
      fetchBook: async () => mkBook(0.4, 1000),
    });
    await engine.onScanComplete({ markets: [mkMarket()] });

    const row = db.prepare(`SELECT * FROM poly_signals`).get() as {
      approved: number; edge_pct: number; paper_trade_id: number | null;
      prompt_version: string | null; model: string | null;
    };
    expect(row.approved).toBe(1);
    expect(row.edge_pct).toBeCloseTo(20, 1);
    expect(row.paper_trade_id).not.toBeNull();
    // Sprint 2 versioning: every new signal carries its prompt version + model.
    expect(row.prompt_version).toBe('v3');
    expect(row.model).toBeTruthy();

    const trade = db.prepare(`SELECT status, size_usd FROM poly_paper_trades WHERE id = ?`).get(row.paper_trade_id) as { status: string; size_usd: number };
    expect(trade.status).toBe('open');
    expect(trade.size_usd).toBe(50);
  });

  it('persists rejected signal when edge is below threshold', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.41),  // edge = 1pp, below default 8
      fetchBook: async () => mkBook(0.4, 1000),
    });
    await engine.onScanComplete({ markets: [mkMarket()] });

    const row = db.prepare(`SELECT approved, rejection_reasons, paper_trade_id FROM poly_signals`).get() as {
      approved: number; rejection_reasons: string; paper_trade_id: number | null;
    };
    expect(row.approved).toBe(0);
    expect(row.paper_trade_id).toBeNull();
    const rej = JSON.parse(row.rejection_reasons) as Array<{ gate: string }>;
    expect(rej.some(r => r.gate === 'signal_quality')).toBe(true);
  });

  it('no signal row when evaluate returns null', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => null,
      fetchBook: async () => mkBook(0.4, 1000),
    });
    await engine.onScanComplete({ markets: [mkMarket()] });
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM poly_signals`).get() as { n: number }).n;
    expect(n).toBe(0);
  });

  it('filters out markets below volume or TTR floor before evaluating', async () => {
    let evalCalls = 0;
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 100_000, minTtrHours: 24,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => { evalCalls++; return mkEst(0.7); },
      fetchBook: async () => mkBook(0.4, 1000),
    });
    // volume too low
    await engine.onScanComplete({ markets: [mkMarket({ volume24h: 1000 })] });
    // TTR too short
    await engine.onScanComplete({ markets: [mkMarket({ endDate: Math.floor(Date.now() / 1000) + 3600 })] });
    expect(evalCalls).toBe(0);
  });

  it('rejects duplicate position on same slug::tokenId', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.7),
      fetchBook: async () => mkBook(0.4, 1000),
    });
    await engine.onScanComplete({ markets: [mkMarket()] });
    // second pass — existing open position should trigger gate 1.
    await engine.onScanComplete({ markets: [mkMarket()] });

    const rows = db.prepare(`SELECT approved, rejection_reasons FROM poly_signals ORDER BY id`).all() as Array<{ approved: number; rejection_reasons: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.approved).toBe(1);
    expect(rows[1]!.approved).toBe(0);
    const r = JSON.parse(rows[1]!.rejection_reasons!) as Array<{ gate: string; reason: string }>;
    expect(r.some(x => x.gate === 'position_limits' && x.reason.includes('already open'))).toBe(true);
  });

  it('only evaluates the Yes outcome (Phase C)', async () => {
    const seenTokens: string[] = [];
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async ({ outcome }) => { seenTokens.push(outcome.tokenId); return null; },
      fetchBook: async () => mkBook(0.4, 1000),
    });
    await engine.onScanComplete({ markets: [mkMarket()] });
    expect(seenTokens).toEqual(['tok-yes']);
  });

  it('tags signal with latest regime_label when a snapshot exists', async () => {
    db.prepare(`INSERT INTO poly_regime_snapshots (created_at, vix, btc_dominance, yield_10y, regime_label) VALUES (?,?,?,?,?)`)
      .run(100, 18, 50, 4.2, 'vnorm_bmix_ymid');
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.6),
      fetchBook: async () => mkBook(0.4, 1000),
    });
    await engine.onScanComplete({ markets: [mkMarket()] });
    const row = db.prepare(`SELECT regime_label FROM poly_signals`).get() as { regime_label: string | null };
    expect(row.regime_label).toBe('vnorm_bmix_ymid');
  });

  it('regime_label is null when no snapshot yet (cold start)', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.6),
      fetchBook: async () => mkBook(0.4, 1000),
    });
    await engine.onScanComplete({ markets: [mkMarket()] });
    const row = db.prepare(`SELECT regime_label FROM poly_signals`).get() as { regime_label: string | null };
    expect(row.regime_label).toBeNull();
  });

  it('limits evaluation to topN markets sorted by volume', async () => {
    let evalCalls = 0;
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 2, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => { evalCalls++; return null; },
      fetchBook: async () => mkBook(0.4, 1000),
    });
    const markets = [
      mkMarket({ slug: 'm1', volume24h: 100, outcomes: [{ label: 'Yes', tokenId: 't1y', price: 0.4 }, { label: 'No', tokenId: 't1n', price: 0.6 }] }),
      mkMarket({ slug: 'm2', volume24h: 5000, outcomes: [{ label: 'Yes', tokenId: 't2y', price: 0.4 }, { label: 'No', tokenId: 't2n', price: 0.6 }] }),
      mkMarket({ slug: 'm3', volume24h: 20_000, outcomes: [{ label: 'Yes', tokenId: 't3y', price: 0.4 }, { label: 'No', tokenId: 't3n', price: 0.6 }] }),
    ];
    await engine.onScanComplete({ markets });
    expect(evalCalls).toBe(2);
  });
});
