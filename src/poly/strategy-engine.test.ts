import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import type { ClobBook, Market, ProbabilityEstimate } from './types.js';
import { StrategyEngine, computeKellySize, confidenceMultiplier, computeAvailableCapital } from './strategy-engine.js';

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
      prompt_version TEXT, model TEXT, regime_label TEXT, provider TEXT);
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

  it('Sprint 7: confidenceMult=1 matches legacy behavior', () => {
    const a = computeKellySize({ probability: 0.42, ask: 0.4, kellyFraction: 0.25, paperCapital: 1000, maxTradeUsd: 50 });
    const b = computeKellySize({ probability: 0.42, ask: 0.4, kellyFraction: 0.25, paperCapital: 1000, maxTradeUsd: 50, confidenceMult: 1 });
    expect(a).toBe(b);
  });

  it('Sprint 7: confidenceMult=0.3 scales size to 30% of the baseline', () => {
    const base = computeKellySize({ probability: 0.42, ask: 0.4, kellyFraction: 0.25, paperCapital: 1000, maxTradeUsd: 50 });
    const low  = computeKellySize({ probability: 0.42, ask: 0.4, kellyFraction: 0.25, paperCapital: 1000, maxTradeUsd: 50, confidenceMult: 0.3 });
    expect(low).toBeCloseTo(base * 0.3, 6);
  });

  it('Sprint 7: confidenceMult=0 returns 0', () => {
    expect(computeKellySize({ probability: 0.6, ask: 0.4, kellyFraction: 0.25, paperCapital: 1000, maxTradeUsd: 50, confidenceMult: 0 })).toBe(0);
  });
});

describe('confidenceMultiplier', () => {
  const mults = { low: 0.3, medium: 0.7, high: 1.0 };

  it('maps enum to the configured bucket', () => {
    expect(confidenceMultiplier('low', mults)).toBe(0.3);
    expect(confidenceMultiplier('medium', mults)).toBe(0.7);
    expect(confidenceMultiplier('high', mults)).toBe(1.0);
  });

  it('clamps values above 1 to 1', () => {
    expect(confidenceMultiplier('high', { low: 0.3, medium: 0.7, high: 1.5 })).toBe(1);
  });

  it('returns 0 for non-finite / negative multipliers', () => {
    expect(confidenceMultiplier('low', { low: NaN,       medium: 0.7, high: 1 })).toBe(0);
    expect(confidenceMultiplier('low', { low: -0.1,      medium: 0.7, high: 1 })).toBe(0);
    expect(confidenceMultiplier('low', { low: 0,         medium: 0.7, high: 1 })).toBe(0);
  });
});

describe('computeAvailableCapital', () => {
  function insertTrade(db: Database.Database, sizeUsd: number, status: string): void {
    db.prepare(`INSERT INTO poly_paper_trades
      (created_at, market_slug, outcome_token_id, outcome_label, side, entry_price,
       size_usd, shares, kelly_fraction, strategy, status)
      VALUES (?, 'm', 't', 'Yes', 'BUY', 0.5, ?, 100, 0.25, 'ai-probability', ?)`)
      .run(Math.floor(Date.now() / 1000), sizeUsd, status);
  }

  // Tests use explicit maxDeployedPct to pin semantics regardless of env.
  it('returns deployment ceiling when no open trades', () => {
    const db = bootDb();
    expect(computeAvailableCapital(db, 5000, 0.5)).toBe(2500);
  });

  it('subtracts only open-trade size_usd from ceiling', () => {
    const db = bootDb();
    insertTrade(db, 100, 'open');
    insertTrade(db, 250, 'open');
    // ceiling = 0.5 * 5000 = 2500; minus 350 exposure = 2150
    expect(computeAvailableCapital(db, 5000, 0.5)).toBe(2150);
  });

  it('excludes voided and resolved trades from exposure', () => {
    const db = bootDb();
    insertTrade(db, 100, 'open');
    insertTrade(db, 999, 'voided');
    insertTrade(db, 999, 'resolved');
    expect(computeAvailableCapital(db, 5000, 0.5)).toBe(2400);
  });

  it('floors at 0 when exposure exceeds ceiling', () => {
    const db = bootDb();
    insertTrade(db, 1500, 'open');
    insertTrade(db, 1500, 'open');
    // ceiling = 2500; exposure = 3000 > ceiling
    expect(computeAvailableCapital(db, 5000, 0.5)).toBe(0);
  });

  it('maxDeployedPct=1.0 makes ceiling = full paperCapital (back-compat with pre-alignment math)', () => {
    const db = bootDb();
    insertTrade(db, 4000, 'open');
    expect(computeAvailableCapital(db, 5000, 1.0)).toBe(1000);
  });

  it('defaults maxDeployedPct to POLY_MAX_DEPLOYED_PCT when omitted', () => {
    const db = bootDb();
    // Just verify the signature works without a 3rd arg; exact value
    // depends on env but must be >= 0 and <= paperCapital.
    const result = computeAvailableCapital(db, 5000);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(5000);
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

  it('Sprint 9: flag-off ignores open exposure (parity with pre-Sprint-9)', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 500, minVolumeUsd: 10_000, minTtrHours: 24,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.6),
      fetchBook: async () => mkBook(0.4, 1000),
      gateConfig: { ...(await import('./risk-gates.js')).defaultGateConfig(), maxTradeUsd: 50, maxDeployedPct: 0.95, maxOpenPositions: 10 },
      exposureAwareSizing: false,
    });
    db.prepare(`INSERT INTO poly_paper_trades
      (created_at, market_slug, outcome_token_id, outcome_label, side, entry_price,
       size_usd, shares, kelly_fraction, strategy, status)
      VALUES (?, 'other', 't', 'Yes', 'BUY', 0.5, 100, 200, 0.25, 'ai-probability', 'open')`)
      .run(Math.floor(Date.now() / 1000));

    await engine.onScanComplete({ markets: [mkMarket()] });
    const trade = db.prepare(`SELECT size_usd FROM poly_paper_trades WHERE market_slug = 'will-x-happen'`).get() as { size_usd: number };
    // Full paperCapital used: 0.25 * (0.2/0.6) * 500 = 41.67
    expect(trade.size_usd).toBeCloseTo(41.67, 1);
  });

  it('Sprint 9: flag-on scales sizing against available capital', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 500, minVolumeUsd: 10_000, minTtrHours: 24,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.6),
      fetchBook: async () => mkBook(0.4, 1000),
      gateConfig: { ...(await import('./risk-gates.js')).defaultGateConfig(), maxTradeUsd: 50, maxDeployedPct: 0.95, maxOpenPositions: 10 },
      exposureAwareSizing: true,
    });
    db.prepare(`INSERT INTO poly_paper_trades
      (created_at, market_slug, outcome_token_id, outcome_label, side, entry_price,
       size_usd, shares, kelly_fraction, strategy, status)
      VALUES (?, 'other', 't', 'Yes', 'BUY', 0.5, 250, 500, 0.25, 'ai-probability', 'open')`)
      .run(Math.floor(Date.now() / 1000));

    await engine.onScanComplete({ markets: [mkMarket()] });
    const trade = db.prepare(`SELECT size_usd FROM poly_paper_trades WHERE market_slug = 'will-x-happen'`).get() as { size_usd: number };
    // Ceiling = 0.95 * 500 = 475; available = 475 - 250 = 225: 0.25 * (0.2/0.6) * 225 = 18.75
    expect(trade.size_usd).toBeCloseTo(18.75, 1);
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

  it('regime_label falls back to UNKNOWN_REGIME_TAG (not NULL) when no snapshot yet (cold start)', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.6),
      fetchBook: async () => mkBook(0.4, 1000),
    });
    await engine.onScanComplete({ markets: [mkMarket()] });
    const row = db.prepare(`SELECT regime_label FROM poly_signals`).get() as { regime_label: string | null };
    expect(row.regime_label).toBe('vunk_bunk_yunk');
    const nullRows = db.prepare(`SELECT COUNT(*) c FROM poly_signals WHERE regime_label IS NULL`).get() as { c: number };
    expect(nullRows.c).toBe(0);
  });

  it('filters out markets outside the YES-price band (Sprint 5.5)', async () => {
    let evalCalls = 0;
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      minYesPrice: 0.15, maxYesPrice: 0.85,
      evaluate: async () => { evalCalls++; return mkEst(0.6); },
      fetchBook: async () => mkBook(0.4, 1000),
    });
    const longShot = mkMarket({
      slug: 'tail', outcomes: [
        { label: 'Yes', tokenId: 'ty', price: 0.02 },
        { label: 'No',  tokenId: 'tn', price: 0.98 },
      ],
    });
    const nearCert = mkMarket({
      slug: 'cert', outcomes: [
        { label: 'Yes', tokenId: 'cy', price: 0.95 },
        { label: 'No',  tokenId: 'cn', price: 0.05 },
      ],
    });
    const inBand = mkMarket({ slug: 'mid' });  // 0.4/0.6
    await engine.onScanComplete({ markets: [longShot, nearCert, inBand] });
    expect(evalCalls).toBe(1);
    const rows = db.prepare(`SELECT market_slug FROM poly_signals`).all() as Array<{ market_slug: string }>;
    expect(rows.map(r => r.market_slug)).toEqual(['mid']);
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

  it('Sprint 2.5: writes shadow reflection row when reflectionEnabled=true', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.6),
      fetchBook: async () => mkBook(0.4, 1000),
      reflectionEnabled: true,
      critic: async () => ({
        verdict: 'revise', revisedProbability: 0.52,
        revisedConfidence: 'medium', rationale: 'tighter',
      }),
    });
    await engine.onScanComplete({ markets: [mkMarket()] });

    const rows = db.prepare(`SELECT prompt_version, estimated_prob, approved, rejection_reasons, paper_trade_id FROM poly_signals ORDER BY id`).all() as Array<{
      prompt_version: string; estimated_prob: number; approved: number;
      rejection_reasons: string | null; paper_trade_id: number | null;
    }>;
    expect(rows).toHaveLength(2);
    // Primary row
    expect(rows[0]!.prompt_version).toBe('v3');
    expect(rows[0]!.estimated_prob).toBe(0.6);
    expect(rows[0]!.approved).toBe(1);
    expect(rows[0]!.paper_trade_id).not.toBeNull();
    // Shadow row
    expect(rows[1]!.prompt_version).toBe('v3-reflect');
    expect(rows[1]!.estimated_prob).toBe(0.52);
    expect(rows[1]!.approved).toBe(0);
    expect(rows[1]!.rejection_reasons).toBe('shadow:reflect');
    expect(rows[1]!.paper_trade_id).toBeNull();
  });

  it('Sprint 2.5: shadow row equals primary when critic returns null', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.6),
      fetchBook: async () => mkBook(0.4, 1000),
      reflectionEnabled: true,
      critic: async () => null,
    });
    await engine.onScanComplete({ markets: [mkMarket()] });

    const rows = db.prepare(`SELECT prompt_version, estimated_prob FROM poly_signals ORDER BY id`).all() as Array<{
      prompt_version: string; estimated_prob: number;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[1]!.prompt_version).toBe('v3-reflect');
    expect(rows[1]!.estimated_prob).toBe(0.6);
  });

  it('Sprint 2.5: no shadow row when reflectionEnabled=false (default)', async () => {
    let criticCalls = 0;
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.6),
      fetchBook: async () => mkBook(0.4, 1000),
      reflectionEnabled: false,
      critic: async () => { criticCalls++; return null; },
    });
    await engine.onScanComplete({ markets: [mkMarket()] });

    const n = (db.prepare(`SELECT COUNT(*) AS n FROM poly_signals`).get() as { n: number }).n;
    expect(n).toBe(1);
    expect(criticCalls).toBe(0);
  });

  it('Sprint 7: low-confidence signal gets a smaller paper trade size than high-confidence at same edge', async () => {
    // Raise both engine AND gate maxTradeUsd so size_usd isn't clamped — the
    // gate enforces its own POLY_MAX_TRADE_USD regardless of engine config.
    const run = async (confidence: 'low' | 'medium' | 'high'): Promise<number> => {
      const freshDb = bootDb();
      const freshScanner = new EventEmitter();
      const { defaultGateConfig } = await import('./risk-gates.js');
      const gateConfig = { ...defaultGateConfig(), maxTradeUsd: 5000 };
      const engine = new StrategyEngine({
        db: freshDb, scanner: freshScanner, paperCapital: 5000,
        minVolumeUsd: 0, minTtrHours: 0, topN: 10,
        maxTradeUsd: 5000, kellyFraction: 0.25,
        evaluate: async () => mkEst(0.6, confidence),
        fetchBook: async () => mkBook(0.4, 100_000),
        confidenceMults: { low: 0.3, medium: 0.7, high: 1.0 },
        gateConfig,
      });
      await engine.onScanComplete({ markets: [mkMarket()] });
      const row = freshDb.prepare(`SELECT size_usd FROM poly_paper_trades`).get() as { size_usd: number };
      return row.size_usd;
    };
    const [lowSize, medSize, highSize] = await Promise.all([run('low'), run('medium'), run('high')]);
    expect(lowSize).toBeLessThan(medSize);
    expect(medSize).toBeLessThan(highSize);
    expect(lowSize).toBeCloseTo(highSize * 0.3, 2);
    expect(medSize).toBeCloseTo(highSize * 0.7, 2);
  });

  it('Sprint 2.5: writes shadow row even when primary rejected by gates', async () => {
    const engine = new StrategyEngine({
      db, scanner, paperCapital: 5000, minVolumeUsd: 0, minTtrHours: 0,
      topN: 10, maxTradeUsd: 50, kellyFraction: 0.25,
      evaluate: async () => mkEst(0.41), // edge = 1pp → primary rejected
      fetchBook: async () => mkBook(0.4, 1000),
      reflectionEnabled: true,
      critic: async () => ({
        verdict: 'confirm', revisedProbability: 0.41,
        revisedConfidence: 'low', rationale: 'ok',
      }),
    });
    await engine.onScanComplete({ markets: [mkMarket()] });

    const rows = db.prepare(`SELECT prompt_version, approved FROM poly_signals ORDER BY id`).all() as Array<{
      prompt_version: string; approved: number;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.approved).toBe(0);
    expect(rows[1]!.prompt_version).toBe('v3-reflect');
  });
});
