import type Database from 'better-sqlite3';
import type { Signal, Market } from './types.js';
import {
  POLY_MAX_OPEN_POSITIONS,
  POLY_MAX_DEPLOYED_PCT,
  POLY_MAX_TRADE_USD,
  POLY_MIN_EDGE_PCT,
  POLY_MIN_TTR_HOURS,
  POLY_DAILY_LOSS_PCT,
  POLY_HALT_DD_PCT,
} from '../config.js';

/**
 * Large-edge signals with only medium/low confidence almost always mean the
 * LLM misread the question (most commonly: "next X" parsed as "current X
 * continuing"). A genuinely 25pp+ mispriced liquid market requires high
 * conviction — anything less is filtered out as an implicit contradiction.
 */
const HIGH_CONFIDENCE_REQUIRED_EDGE_PCT = 25;

// Gates are pure. Caller (strategy engine) builds PortfolioSnapshot from DB and passes it in.
export interface PortfolioSnapshot {
  openPositionCount: number;
  /** Set of "slug::tokenId" keys for currently open positions. */
  openPositionKeys: Set<string>;
  deployedUsd: number;
  dailyRealizedPnl: number;
  totalDrawdownPct: number;
  freeCapital: number;
  paperCapital: number;
}

export interface GateConfig {
  maxOpenPositions: number;
  maxDeployedPct: number;
  maxTradeUsd: number;
  minEdgePct: number;
  minTtrHours: number;
  dailyLossPct: number;
  haltDdPct: number;
}

export const defaultGateConfig = (): GateConfig => ({
  maxOpenPositions: POLY_MAX_OPEN_POSITIONS,
  maxDeployedPct: POLY_MAX_DEPLOYED_PCT,
  maxTradeUsd: POLY_MAX_TRADE_USD,
  minEdgePct: POLY_MIN_EDGE_PCT,
  minTtrHours: POLY_MIN_TTR_HOURS,
  dailyLossPct: POLY_DAILY_LOSS_PCT,
  haltDdPct: POLY_HALT_DD_PCT,
});

export interface OrderbookSnapshot {
  bestAsk: number | null;
  askDepthShares: number;
}

export interface GateResult {
  passed: boolean;
  reason?: string;
}

export type GateName = 'position_limits' | 'portfolio_health' | 'signal_quality';

export interface GateRejection {
  gate: GateName;
  reason: string;
}

export interface RunAllGatesResult {
  passed: boolean;
  rejections: GateRejection[];
}

export function positionKey(slug: string, tokenId: string): string {
  return `${slug}::${tokenId}`;
}

/** Gate 1: Position limits (per-trade position sizing vs portfolio caps). */
export function gate1PositionLimits(
  signal: Signal,
  portfolio: PortfolioSnapshot,
  sizeUsd: number,
  config: GateConfig = defaultGateConfig(),
): GateResult {
  if (portfolio.openPositionCount >= config.maxOpenPositions) {
    return { passed: false, reason: `open_position_count ${portfolio.openPositionCount} >= max ${config.maxOpenPositions}` };
  }
  const maxDeployed = config.maxDeployedPct * portfolio.paperCapital;
  if (portfolio.deployedUsd + sizeUsd > maxDeployed) {
    return { passed: false, reason: `deployed+size ${portfolio.deployedUsd + sizeUsd} > max_deployed ${maxDeployed}` };
  }
  const key = positionKey(signal.marketSlug, signal.outcomeTokenId);
  if (portfolio.openPositionKeys.has(key)) {
    return { passed: false, reason: `already open position on ${key}` };
  }
  if (sizeUsd > config.maxTradeUsd) {
    return { passed: false, reason: `size_usd ${sizeUsd} > POLY_MAX_TRADE_USD ${config.maxTradeUsd}` };
  }
  return { passed: true };
}

/** Gate 2: Portfolio health (global circuit breakers). */
export function gate2PortfolioHealth(
  portfolio: PortfolioSnapshot,
  sizeUsd: number,
  config: GateConfig = defaultGateConfig(),
): GateResult {
  const dailyLossFloor = -config.dailyLossPct * portfolio.paperCapital;
  if (portfolio.dailyRealizedPnl <= dailyLossFloor) {
    return { passed: false, reason: `daily_realized_pnl ${portfolio.dailyRealizedPnl} <= floor ${dailyLossFloor}` };
  }
  if (portfolio.totalDrawdownPct >= config.haltDdPct) {
    return { passed: false, reason: `total_drawdown_pct ${portfolio.totalDrawdownPct} >= halt ${config.haltDdPct}` };
  }
  if (portfolio.freeCapital < sizeUsd) {
    return { passed: false, reason: `free_capital ${portfolio.freeCapital} < size ${sizeUsd}` };
  }
  return { passed: true };
}

const HALT_KEY = 'poly.halt';

export interface AutoHaltResult {
  /** True only when this call wrote a new value (transition). False on no-op. */
  wrote: boolean;
  /** Value of poly.halt in poly_kv before this call ('0' | '1' | null when row absent). */
  prior: '0' | '1' | null;
  /** Effective halt state after this call ('0' or '1'). */
  current: '0' | '1';
}

/**
 * Edge-triggered auto-halt: when totalDrawdownPct >= haltDdPct AND poly.halt is
 * not already '1', set poly.halt='1' and report the transition. Does NOT
 * auto-clear when DD recovers (operator explicitly resumes via /poly resume).
 *
 * Lives next to gate2PortfolioHealth for discoverability — gate2 stays pure
 * (rejects the signal at the threshold); this side-effecting helper writes
 * the flag so future ticks short-circuit cleanly via StrategyEngine.isHalted.
 *
 * Idempotent: safe to call every tick. Only the transition tick writes.
 */
export function maybeAutoHaltOnDrawdown(
  db: Database.Database,
  portfolio: PortfolioSnapshot,
  config: GateConfig = defaultGateConfig(),
): AutoHaltResult {
  const row = db.prepare(`SELECT value FROM poly_kv WHERE key=?`).get(HALT_KEY) as
    | { value: string } | undefined;
  const prior: '0' | '1' | null = row?.value === '1' ? '1' : row?.value === '0' ? '0' : null;
  const overThreshold = portfolio.totalDrawdownPct >= config.haltDdPct;

  if (overThreshold && prior !== '1') {
    db.prepare(
      `INSERT INTO poly_kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run(HALT_KEY, '1');
    return { wrote: true, prior, current: '1' };
  }

  return { wrote: false, prior, current: prior === '1' ? '1' : '0' };
}

/** Gate 3: Signal quality (edge, time-to-resolution, orderbook sanity). */
export function gate3SignalQuality(
  signal: Signal,
  market: Market,
  orderbook: OrderbookSnapshot,
  sizeUsd: number,
  now: number = Date.now(),
  config: GateConfig = defaultGateConfig(),
): GateResult {
  if (signal.edgePct < config.minEdgePct) {
    return { passed: false, reason: `edge_pct ${signal.edgePct} < min ${config.minEdgePct}` };
  }
  if (signal.edgePct >= HIGH_CONFIDENCE_REQUIRED_EDGE_PCT && signal.confidence !== 'high') {
    return {
      passed: false,
      reason: `edge_pct ${signal.edgePct.toFixed(1)} >= ${HIGH_CONFIDENCE_REQUIRED_EDGE_PCT} but confidence=${signal.confidence} (likely misread question)`,
    };
  }
  const ttrHours = (market.endDate * 1000 - now) / (1000 * 60 * 60);
  if (ttrHours < config.minTtrHours) {
    return { passed: false, reason: `ttr_hours ${ttrHours.toFixed(2)} < min ${config.minTtrHours}` };
  }
  if (orderbook.bestAsk === null) {
    return { passed: false, reason: 'empty_asks' };
  }
  // Depth is measured in SHARES priced at ~bestAsk per share; dollar-equivalent = shares * price.
  const depthUsd = orderbook.askDepthShares * orderbook.bestAsk;
  if (depthUsd < sizeUsd) {
    return { passed: false, reason: `ask_depth_usd ${depthUsd.toFixed(2)} < size_usd ${sizeUsd}` };
  }
  // 3% relative drift (inclusive — boundary at exactly 0.03 passes).
  const drift = Math.abs(orderbook.bestAsk - signal.marketPrice) / signal.marketPrice;
  if (drift > 0.03) {
    return { passed: false, reason: `price_drift ${drift.toFixed(4)} > 0.03` };
  }
  return { passed: true };
}

/**
 * Runs all three gates and collects every rejection (does not short-circuit).
 * Strategy engine receives the full list so rejections can be logged together
 * into `poly_signals.rejection_reasons` as a JSON array.
 */
export function runAllGates(params: {
  signal: Signal;
  market: Market;
  portfolio: PortfolioSnapshot;
  orderbook: OrderbookSnapshot;
  sizeUsd: number;
  now?: number;
  config?: GateConfig;
}): RunAllGatesResult {
  const config = params.config ?? defaultGateConfig();
  const now = params.now ?? Date.now();
  const rejections: GateRejection[] = [];

  const g1 = gate1PositionLimits(params.signal, params.portfolio, params.sizeUsd, config);
  if (!g1.passed) rejections.push({ gate: 'position_limits', reason: g1.reason ?? 'unknown' });

  const g2 = gate2PortfolioHealth(params.portfolio, params.sizeUsd, config);
  if (!g2.passed) rejections.push({ gate: 'portfolio_health', reason: g2.reason ?? 'unknown' });

  const g3 = gate3SignalQuality(params.signal, params.market, params.orderbook, params.sizeUsd, now, config);
  if (!g3.passed) rejections.push({ gate: 'signal_quality', reason: g3.reason ?? 'unknown' });

  return { passed: rejections.length === 0, rejections };
}
