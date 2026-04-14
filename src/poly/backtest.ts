import type Database from 'better-sqlite3';
import { computeKellySize } from './strategy-engine.js';
import { classifyResolution } from './pnl-tracker.js';
import type { Market } from './types.js';

/**
 * Sprint 5 — backtesting harness.
 *
 * Replays historical poly_signals against cached poly_resolutions so we
 * can answer "what would P&L have been at different gate settings?"
 * without risking capital. Current highest-value use: min-edge sweep
 * — 635 signals evaluated, 0 trades because POLY_MIN_EDGE_PCT=8 is too
 * strict. The sweep tells us whether a lower threshold would have been
 * profitable in hindsight.
 */

export interface OutcomeRow {
  label: string;
  tokenId: string;
  price: number;
}

export interface HistoricalSignal {
  id: number;
  createdAt: number;
  marketSlug: string;
  outcomeTokenId: string;
  outcomeLabel: string;
  marketPrice: number;
  estimatedProb: number;
  edgePct: number;
}

export interface Resolution {
  slug: string;
  closed: boolean;
  outcomes: OutcomeRow[];
}

export interface BacktestParams {
  minEdgePct: number;
  kellyFraction: number;
  maxTradeUsd: number;
  paperCapital: number;
}

export type SimStatus = 'won' | 'lost' | 'voided' | 'open';

export interface SimulatedOutcome {
  status: SimStatus;
  shares: number;
  realizedPnl: number;
}

/**
 * For Phase C YES-only BUY: payoff is shares*1 on win, 0 on lose.
 * Cost basis = sizeUsd = shares * entryPrice. So:
 *   won:    +shares * (1 - entryPrice)
 *   lost:   -shares * entryPrice = -sizeUsd
 *   voided: 0 (refund)
 *   open:   0 (not yet resolved — excluded from aggregation)
 */
export function simulateOutcome(
  signal: HistoricalSignal,
  resolution: Resolution | null,
  sizeUsd: number,
): SimulatedOutcome {
  const entryPrice = signal.marketPrice;
  const shares = entryPrice > 0 ? sizeUsd / entryPrice : 0;

  // classifyResolution needs a Market-shaped input; synthesize one.
  const market: Market | null = resolution
    ? {
        slug: resolution.slug, conditionId: '', question: '',
        outcomes: resolution.outcomes, volume24h: 0, liquidity: 0,
        endDate: 0, closed: resolution.closed,
      }
    : null;
  const cls = classifyResolution(market, signal.outcomeTokenId);

  if (cls.status === 'won') return { status: 'won', shares, realizedPnl: shares * (1 - entryPrice) };
  if (cls.status === 'lost') return { status: 'lost', shares, realizedPnl: -shares * entryPrice };
  if (cls.status === 'voided') return { status: 'voided', shares, realizedPnl: 0 };
  return { status: 'open', shares, realizedPnl: 0 };
}

export interface BacktestReport {
  minEdgePct: number;
  kellyFraction: number;
  signalCount: number;
  approvedCount: number;
  rejectedForEdge: number;
  skippedForZeroSize: number;
  resolvedCount: number;
  winCount: number;
  lostCount: number;
  voidedCount: number;
  winRate: number;       // resolved trades only
  totalPnl: number;      // resolved trades only (won + lost, voided = 0)
  totalDeployed: number; // sum of sizeUsd across resolved trades
  roiPct: number;        // totalPnl / totalDeployed * 100, or 0 when none deployed
  brierScore: number | null;
}

export interface RunBacktestArgs {
  signals: HistoricalSignal[];
  resolutions: Map<string, Resolution>;
  params: BacktestParams;
}

export function runBacktest(a: RunBacktestArgs): BacktestReport {
  const { signals, resolutions, params } = a;
  let approved = 0, rejectedEdge = 0, skippedZero = 0;
  let resolved = 0, won = 0, lost = 0, voided = 0;
  let totalPnl = 0, totalDeployed = 0;
  const brierSamples: Array<{ p: number; o: 0 | 1 }> = [];

  for (const s of signals) {
    if (s.edgePct < params.minEdgePct) { rejectedEdge++; continue; }
    const size = computeKellySize({
      probability: s.estimatedProb, ask: s.marketPrice,
      kellyFraction: params.kellyFraction,
      paperCapital: params.paperCapital,
      maxTradeUsd: params.maxTradeUsd,
    });
    if (size <= 0) { skippedZero++; continue; }
    approved++;

    const res = resolutions.get(s.marketSlug) ?? null;
    const out = simulateOutcome(s, res, size);
    if (out.status === 'open') continue;
    resolved++;
    totalDeployed += size;
    totalPnl += out.realizedPnl;
    if (out.status === 'won') { won++; brierSamples.push({ p: s.estimatedProb, o: 1 }); }
    else if (out.status === 'lost') { lost++; brierSamples.push({ p: s.estimatedProb, o: 0 }); }
    else voided++;
  }

  const brier = brierSamples.length > 0
    ? brierSamples.reduce((sum, x) => sum + (x.p - x.o) ** 2, 0) / brierSamples.length
    : null;

  return {
    minEdgePct: params.minEdgePct, kellyFraction: params.kellyFraction,
    signalCount: signals.length,
    approvedCount: approved, rejectedForEdge: rejectedEdge, skippedForZeroSize: skippedZero,
    resolvedCount: resolved, winCount: won, lostCount: lost, voidedCount: voided,
    winRate: (won + lost) > 0 ? won / (won + lost) : 0,
    totalPnl, totalDeployed,
    roiPct: totalDeployed > 0 ? (totalPnl / totalDeployed) * 100 : 0,
    brierScore: brier,
  };
}

export interface SweepArgs {
  signals: HistoricalSignal[];
  resolutions: Map<string, Resolution>;
  base: Omit<BacktestParams, 'minEdgePct'>;
  thresholds: number[];
}

export function composeMinEdgeSweep(a: SweepArgs): BacktestReport[] {
  return [...a.thresholds].sort((x, y) => x - y).map(t =>
    runBacktest({
      signals: a.signals, resolutions: a.resolutions,
      params: { ...a.base, minEdgePct: t },
    }),
  );
}

// ── DAO ──────────────────────────────────────────────────────────────

interface HSigRow {
  id: number; created_at: number; market_slug: string;
  outcome_token_id: string; outcome_label: string;
  market_price: number; estimated_prob: number; edge_pct: number;
}

export function loadHistoricalSignals(
  db: Database.Database,
  window: { fromSec: number; toSec: number },
): HistoricalSignal[] {
  const rows = db.prepare(`
    SELECT id, created_at, market_slug, outcome_token_id, outcome_label,
           market_price, estimated_prob, edge_pct
      FROM poly_signals
     WHERE outcome_label = 'Yes'
       AND created_at >= ? AND created_at <= ?
     ORDER BY created_at ASC
  `).all(window.fromSec, window.toSec) as HSigRow[];
  return rows.map(r => ({
    id: r.id, createdAt: r.created_at, marketSlug: r.market_slug,
    outcomeTokenId: r.outcome_token_id, outcomeLabel: r.outcome_label,
    marketPrice: r.market_price, estimatedProb: r.estimated_prob,
    edgePct: r.edge_pct,
  }));
}

export interface PersistResArgs {
  slug: string;
  closed: boolean;
  outcomes: OutcomeRow[];
  fetchedAtSec: number;
  resolvedAtSec?: number | null;
}

export function persistResolution(db: Database.Database, r: PersistResArgs): void {
  db.prepare(`
    INSERT INTO poly_resolutions (slug, closed, outcomes_json, fetched_at, resolved_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      closed = excluded.closed,
      outcomes_json = excluded.outcomes_json,
      fetched_at = excluded.fetched_at,
      resolved_at = COALESCE(excluded.resolved_at, poly_resolutions.resolved_at)
  `).run(
    r.slug, r.closed ? 1 : 0, JSON.stringify(r.outcomes),
    r.fetchedAtSec, r.resolvedAtSec ?? null,
  );
}

interface ResRow {
  slug: string; closed: number; outcomes_json: string;
}

export function loadResolutions(db: Database.Database): Map<string, Resolution> {
  const rows = db.prepare(`SELECT slug, closed, outcomes_json FROM poly_resolutions`).all() as ResRow[];
  const m = new Map<string, Resolution>();
  for (const r of rows) {
    m.set(r.slug, {
      slug: r.slug, closed: r.closed === 1,
      outcomes: JSON.parse(r.outcomes_json) as OutcomeRow[],
    });
  }
  return m;
}
