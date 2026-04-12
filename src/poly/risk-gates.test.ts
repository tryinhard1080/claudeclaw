import { describe, it, expect } from 'vitest';
import {
  gate1PositionLimits,
  gate2PortfolioHealth,
  gate3SignalQuality,
  runAllGates,
  defaultGateConfig,
  positionKey,
  type PortfolioSnapshot,
  type OrderbookSnapshot,
  type GateConfig,
} from './risk-gates.js';
import type { Signal, Market } from './types.js';

const baseConfig = (): GateConfig => ({
  maxOpenPositions: 10,
  maxDeployedPct: 0.5,
  maxTradeUsd: 50,
  minEdgePct: 8,
  minTtrHours: 24,
  dailyLossPct: 0.05,
  haltDdPct: 0.2,
});

const mkSignal = (over: Partial<Signal> = {}): Signal => ({
  marketSlug: 'slug-a',
  outcomeTokenId: 'tok-yes',
  outcomeLabel: 'Yes',
  marketPrice: 0.4,
  estimatedProb: 0.55,
  edgePct: 15,
  confidence: 'medium',
  reasoning: 'x',
  ...over,
});

const mkPortfolio = (over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot => ({
  openPositionCount: 2,
  openPositionKeys: new Set<string>(),
  deployedUsd: 100,
  dailyRealizedPnl: 0,
  totalDrawdownPct: 0,
  freeCapital: 4900,
  paperCapital: 5000,
  ...over,
});

const mkMarket = (over: Partial<Market> = {}): Market => ({
  slug: 'slug-a',
  conditionId: '0x1',
  question: 'Q?',
  category: 'Test',
  outcomes: [{ label: 'Yes', tokenId: 'tok-yes', price: 0.4 }],
  volume24h: 50000,
  liquidity: 20000,
  endDate: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  closed: false,
  ...over,
});

const mkBook = (over: Partial<OrderbookSnapshot> = {}): OrderbookSnapshot => ({
  bestAsk: 0.4,
  askDepthShares: 1000,
  ...over,
});

describe('gate1PositionLimits', () => {
  it('passes when all limits satisfied', () => {
    const r = gate1PositionLimits(mkSignal(), mkPortfolio(), 40, baseConfig());
    expect(r.passed).toBe(true);
  });

  it('rejects when open_position_count >= max', () => {
    const r = gate1PositionLimits(mkSignal(), mkPortfolio({ openPositionCount: 10 }), 40, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/open_position_count/);
  });

  it('rejects when deployed + size > max_deployed_pct * capital', () => {
    // 0.5 * 5000 = 2500 cap. deployed=2490, size=20 -> 2510 > 2500.
    const r = gate1PositionLimits(mkSignal(), mkPortfolio({ deployedUsd: 2490 }), 20, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/deployed/);
  });

  it('rejects when an open position already exists on same (slug, tokenId)', () => {
    const keys = new Set([positionKey('slug-a', 'tok-yes')]);
    const r = gate1PositionLimits(mkSignal(), mkPortfolio({ openPositionKeys: keys }), 40, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/already open/);
  });

  it('rejects when size_usd > POLY_MAX_TRADE_USD', () => {
    const r = gate1PositionLimits(mkSignal(), mkPortfolio(), 60, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/MAX_TRADE_USD/);
  });
});

describe('gate2PortfolioHealth', () => {
  it('rejects (pause) when daily_realized_pnl <= -daily_loss_pct * capital', () => {
    // floor = -0.05 * 5000 = -250. pnl = -250 => <= floor.
    const r = gate2PortfolioHealth(mkPortfolio({ dailyRealizedPnl: -250 }), 40, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/daily_realized_pnl/);
  });

  it('rejects (halt) when total_drawdown_pct >= halt_dd_pct', () => {
    const r = gate2PortfolioHealth(mkPortfolio({ totalDrawdownPct: 0.2 }), 40, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/drawdown/);
  });

  it('rejects when free_capital < size_usd', () => {
    const r = gate2PortfolioHealth(mkPortfolio({ freeCapital: 10 }), 40, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/free_capital/);
  });

  it('passes within healthy bounds', () => {
    const r = gate2PortfolioHealth(mkPortfolio(), 40, baseConfig());
    expect(r.passed).toBe(true);
  });
});

describe('gate3SignalQuality', () => {
  const now = Date.now();

  it('rejects when edge_pct < POLY_MIN_EDGE_PCT', () => {
    const r = gate3SignalQuality(mkSignal({ edgePct: 7 }), mkMarket(), mkBook(), 40, now, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/edge_pct/);
  });

  it('rejects when end_date - now < MIN_TTR_HOURS', () => {
    const endSoon = Math.floor(now / 1000) + 3600; // 1h
    const r = gate3SignalQuality(mkSignal(), mkMarket({ endDate: endSoon }), mkBook(), 40, now, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/ttr_hours/);
  });

  it('rejects when ask depth (shares x price) < size_usd', () => {
    // depth_usd = 50 * 0.4 = 20 < 40
    const r = gate3SignalQuality(mkSignal(), mkMarket(), mkBook({ askDepthShares: 50 }), 40, now, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/ask_depth/);
  });

  it('rejects when best-ask side empty', () => {
    const r = gate3SignalQuality(mkSignal(), mkMarket(), mkBook({ bestAsk: null, askDepthShares: 0 }), 40, now, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('empty_asks');
  });

  it('rejects when |current_ask - signal_ask| / signal_ask > 0.03', () => {
    // signal=0.4, current=0.413 -> 0.0325 > 0.03
    const r = gate3SignalQuality(mkSignal(), mkMarket(), mkBook({ bestAsk: 0.413 }), 40, now, baseConfig());
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/price_drift/);
  });

  it('accepts when 3% drift boundary exactly', () => {
    // signal=0.4, current=0.412 -> |0.012|/0.4 = 0.03 exactly (inclusive: passes)
    const r = gate3SignalQuality(mkSignal(), mkMarket(), mkBook({ bestAsk: 0.412 }), 40, now, baseConfig());
    expect(r.passed).toBe(true);
  });
});

describe('runAllGates', () => {
  it('collects all rejection reasons when multiple gates fail', () => {
    const res = runAllGates({
      signal: mkSignal({ edgePct: 2 }), // gate 3 fail
      market: mkMarket(),
      portfolio: mkPortfolio({ openPositionCount: 10, totalDrawdownPct: 0.5 }), // gate 1 + gate 2 fail
      orderbook: mkBook(),
      sizeUsd: 40,
      config: baseConfig(),
    });
    expect(res.passed).toBe(false);
    const gates = res.rejections.map(r => r.gate).sort();
    expect(gates).toEqual(['portfolio_health', 'position_limits', 'signal_quality'].sort());
  });

  it('returns passed=true only when all three gates pass', () => {
    const res = runAllGates({
      signal: mkSignal(),
      market: mkMarket(),
      portfolio: mkPortfolio(),
      orderbook: mkBook(),
      sizeUsd: 40,
      config: baseConfig(),
    });
    expect(res.passed).toBe(true);
    expect(res.rejections).toEqual([]);
  });
});

describe('defaultGateConfig', () => {
  it('pulls values from src/config.ts env-driven exports', () => {
    const c = defaultGateConfig();
    expect(c.maxOpenPositions).toBeGreaterThan(0);
    expect(c.maxDeployedPct).toBeGreaterThan(0);
  });
});
