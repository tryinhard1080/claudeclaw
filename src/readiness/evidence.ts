import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import {
  POLY_MARKET_QUALITY_FILTER_ENABLED,
  POLY_MAX_MARKET_TTL_DAYS,
  POLY_MIN_MARKET_TTL_DAYS,
  POLY_PAPER_CAPITAL,
  POLY_TTL_FILTER_ENABLED,
  REGIME_TRADER_INSTANCES,
  REGIME_TRADER_PATH,
} from '../config.js';
import { evaluateMarketQuality } from '../poly/market-quality.js';
import type { Market } from '../poly/types.js';
import { compareEquityBenchmark, type EquityCurvePoint } from '../trading/equity-benchmark.js';
import type { ReadinessStatus } from './gate-progress.js';

export interface ReadinessEvidenceMetric {
  key: string;
  name: string;
  status: ReadinessStatus;
  state: string;
  detail: string;
  current?: number;
  target?: number;
  progressPct?: number | null;
}

export type PolymarketNearTermVelocityState =
  | 'complete'
  | 'near_term_on_pace'
  | 'near_term_below_pace'
  | 'no_near_term_trade_velocity'
  | 'missing_maturity_data';

export interface PolymarketEvidence {
  settledTrades: number;
  targetSettledTrades: number;
  realizedPnlUsd: number;
  realizedPnlPositive: boolean;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  paperCapitalUsd: number;
  paperEquityUsd: number;
  paperReturnPct: number | null;
  openTrades: number;
  voidedTrades: number;
  openExposureUsd: number;
  openPnlPct: number | null;
  potentialSettledTrades: number;
  remainingSettledTrades: number;
  additionalSettledTradesNeeded: number;
  openPipelineCanReachTarget: boolean;
  openPipelineCoveragePct: number;
  nearTermPotentialSettledTrades: number;
  additionalNearTermSettledTradesNeeded: number;
  nearTermPipelineCanReachTarget: boolean;
  nearTermPipelineCoveragePct: number;
  paperTradesOpened24h: number;
  nearTermPaperTradesOpened24h: number;
  dailyNearTermTradeTarget30d: number;
  nearTermPipelineFillDaysAt24hRate: number | null;
  nearTermPipelineFillEtaAt: number | null;
  nearTermVelocityState: PolymarketNearTermVelocityState;
  overdueOpenTrades: number;
  dueNext7Days: number;
  dueNext30Days: number;
  nearestOpenEndAt: number | null;
  latestPaperTradeAt: number | null;
  signals24h: number;
  approvedSignals24h: number;
  approvalRate24h: number | null;
  latestApprovedSignalAt: number | null;
  progressPct: number;
  hasMarketMaturityData: boolean;
  openBookQuality: PolymarketOpenBookQualityEvidence;
  resolutionQueue: PolymarketResolutionQueueItem[];
}

export type PolymarketResolutionQueueState = 'overdue' | 'due_7d' | 'due_30d' | 'later' | 'unknown';

export type PolymarketOpenBookQualityState =
  | 'no_open_trades'
  | 'all_inside_current_filters'
  | 'legacy_filter_exceptions'
  | 'missing_market_metadata';

export interface PolymarketOpenBookQualityReason {
  code: string;
  count: number;
  sampleSlug: string | null;
  reason: string;
}

export interface PolymarketOpenBookQualityEvidence {
  openTrades: number;
  evaluatedTrades: number;
  passingTrades: number;
  failingTrades: number;
  missingMetadataTrades: number;
  filtersActive: boolean;
  ttlFilterEnabled: boolean;
  marketQualityFilterEnabled: boolean;
  minTtlDays: number;
  maxTtlDays: number;
  passRate: number | null;
  status: ReadinessStatus;
  state: PolymarketOpenBookQualityState;
  reasons: PolymarketOpenBookQualityReason[];
  summary: string;
}

export interface PolymarketResolutionQueueItem {
  tradeId: number;
  marketSlug: string;
  question: string | null;
  outcomeLabel: string | null;
  openedAt: number;
  entryPrice: number | null;
  sizeUsd: number;
  shares: number | null;
  unrealizedPnlUsd: number;
  openPnlPct: number | null;
  endAt: number | null;
  daysToEnd: number | null;
  state: PolymarketResolutionQueueState;
  volume24h: number | null;
  liquidity: number | null;
}

export interface RegimeSharpeInstanceEvidence {
  instance: string;
  nDays: number;
  rollingSharpe60d: number | null;
  createdAt: number;
}

export interface RegimeSharpeEvidence {
  instances: RegimeSharpeInstanceEvidence[];
  minDays: number;
  targetDays: number;
  allInstancesPositive: boolean;
  allInstancesComplete: boolean;
  progressPct: number;
}

export type EquitySyncState =
  | 'fresh_open_full'
  | 'fresh_open_partial'
  | 'fresh_closed'
  | 'fresh_unknown'
  | 'stale'
  | 'missing'
  | 'unreadable';

export interface EquitySyncInstanceEvidence {
  instance: string;
  state: EquitySyncState;
  syncedAt: number | null;
  ageSec: number | null;
  marketOpen: boolean | null;
  hasRegime: boolean;
  hasRisk: boolean;
  equity: number | null;
  error: string | null;
}

export interface EquitySyncEvidence {
  instances: EquitySyncInstanceEvidence[];
  expectedCount: number;
  freshCount: number;
  latestAt: number | null;
  maxAgeSec: number | null;
  allFresh: boolean;
  allOpenFull: boolean;
  status: ReadinessStatus;
  summary: string;
}

export interface EquitySyncOptions {
  instanceNames?: ReadonlyArray<string>;
  regimeTraderPath?: string;
  freshSec?: number;
  readState?: (instance: string, statePath: string) => { raw: string; mtimeMs: number };
}

export interface EquityBenchmarkInstanceEvidence {
  instance: string;
  benchmark: string;
  strategyReturn: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  nDays: number;
}

export interface EquityBenchmarkEvidence {
  instances: EquityBenchmarkInstanceEvidence[];
  benchmark: string | null;
  minExcessReturn: number | null;
  allOutperforming: boolean;
  status: ReadinessStatus;
  summary: string;
}

export interface TtlFilterEvidence {
  latestAt: number | null;
  ageSec: number | null;
  bandMinDays: number | null;
  bandMaxDays: number | null;
  candidatesTotal: number;
  candidatesTtlPass: number;
  passRate: number | null;
  avgTtlPass: number | null;
  avgTtlFiltered: number | null;
}

export type MarketDiscoveryState =
  | 'healthy'
  | 'first_page_capped'
  | 'shallow'
  | 'stale'
  | 'missing';

export interface MarketDiscoveryEvidence {
  latestAt: number | null;
  ageSec: number | null;
  marketCount: number;
  targetMarketCount: number;
  firstPageCapThreshold: number;
  durationMs: number | null;
  status: ReadinessStatus;
  state: MarketDiscoveryState;
  progressPct: number;
  summary: string;
}

export interface OperationalEvidencePayload {
  generatedAt: number;
  status: ReadinessStatus;
  polymarket: PolymarketEvidence;
  equitySync: EquitySyncEvidence | null;
  equityBenchmark: EquityBenchmarkEvidence | null;
  regimeSharpe: RegimeSharpeEvidence;
  ttlFilter: TtlFilterEvidence;
  marketDiscovery: MarketDiscoveryEvidence;
  metrics: ReadinessEvidenceMetric[];
}

export interface OperationalEvidenceOptions {
  collectEquitySync?: boolean;
  collectEquityBenchmark?: boolean;
  equitySync?: EquitySyncEvidence | null;
  equityBenchmark?: EquityBenchmarkEvidence | null;
  equitySyncOptions?: EquitySyncOptions;
}

export interface OperationalEvidenceHistoryPoint {
  snapshotYmd: string;
  capturedAt: number;
  status: ReadinessStatus;
  polySettledTrades: number;
  polyTargetSettledTrades: number;
  polyRealizedPnlUsd: number;
  polyUnrealizedPnlUsd: number;
  polyTotalPnlUsd: number;
  polyPaperEquityUsd: number;
  polyApprovalRate24h: number | null;
  polyOpenTrades: number;
  polyVoidedTrades: number;
  polyPotentialSettledTrades: number;
  polyAdditionalSettledTradesNeeded: number;
  polyNearTermPotentialSettledTrades: number;
  polyAdditionalNearTermSettledTradesNeeded: number;
  polyPaperTradesOpened24h: number;
  polyNearTermPaperTradesOpened24h: number;
  polyDailyNearTermTradeTarget30d: number;
  polyNearTermFillDaysAt24hRate: number | null;
  polyDueNext7Days: number;
  polyDueNext30Days: number;
  polyOverdueOpenTrades: number;
  equitySyncFreshCount: number;
  equitySyncExpectedCount: number;
  equitySyncMaxAgeSec: number | null;
  equityBenchmarkMinExcessReturn: number | null;
  equityBenchmarkAllOutperforming: boolean;
  equityBenchmarkInstanceCount: number;
  regimeMinDays: number;
  regimeTargetDays: number;
  regimeAllInstancesPositive: boolean;
  ttlCandidatesTotal: number;
  ttlCandidatesTtlPass: number;
  ttlPassRate: number | null;
  polyMarketDiscoveryCount: number;
  polyMarketDiscoveryTarget: number;
  polyMarketDiscoveryAgeSec: number | null;
  polyQualityPassingOpenTrades: number;
  polyQualityFailingOpenTrades: number;
  polyQualityMissingMetadataTrades: number;
}

interface SharpeRow {
  instance: string;
  n_days: number;
  rolling_sharpe_60d: number | null;
  created_at: number;
}

interface TtlRow {
  scan_tick_at: number;
  candidates_total: number;
  candidates_ttl_pass: number;
  avg_ttl_pass: number | null;
  avg_ttl_filtered: number | null;
  band_min_days: number | null;
  band_max_days: number | null;
}

interface ScanRunRow {
  started_at: number;
  duration_ms: number | null;
  market_count: number | null;
  status: string;
}

interface EquityBenchmarkRow {
  benchmark: string;
  snapshot_date: string;
  equity: number;
  daily_return: number | null;
}

interface RegimeCurveRow {
  instance: string;
  snapshot_date: string;
  equity: number;
  daily_return: number | null;
}

const SETTLED_TARGET = 50;
const REGIME_DAYS_TARGET = 60;
const DAY_SEC = 86_400;
const MARKET_DISCOVERY_TARGET = 500;
const MARKET_DISCOVERY_FIRST_PAGE_CAP = 150;
const MARKET_DISCOVERY_FRESH_SEC = 10 * 60;
const EQUITY_SYNC_FRESH_SEC = 15 * 60;
const DEFAULT_EQUITY_INSTANCES = ['spy-aggressive', 'spy-conservative'] as const;

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name) as { name?: string } | undefined;
  return row?.name === name;
}

function tableColumns(db: Database.Database, name: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>;
  return new Set(rows.map(row => row.name));
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  columns: Set<string>,
  column: string,
  ddl: string,
): void {
  if (columns.has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
  columns.add(column);
}

function scalar(db: Database.Database, sql: string, params: unknown[] = []): number {
  const row = db.prepare(sql).get(...params) as { value: number | null } | undefined;
  return row?.value ?? 0;
}

function epoch(db: Database.Database, sql: string, params: unknown[] = []): number | null {
  const row = db.prepare(sql).get(...params) as { value: number | null } | undefined;
  return row?.value ?? null;
}

function progress(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, current / target));
}

function rank(status: ReadinessStatus): number {
  return status === 'fail' ? 2 : status === 'warn' ? 1 : 0;
}

function worstStatus(metrics: readonly ReadinessEvidenceMetric[]): ReadinessStatus {
  return metrics.reduce<ReadinessStatus>((worst, metric) => (
    rank(metric.status) > rank(worst) ? metric.status : worst
  ), 'pass');
}

function snapshotYmd(capturedAt: number): string {
  return new Date(capturedAt * 1000).toISOString().slice(0, 10);
}

function normalizeEpochSec(value: number): number {
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

function compactPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function optionalColumn(
  alias: string,
  columns: Set<string>,
  column: string,
  fallback: string,
  asName: string,
): string {
  return `${columns.has(column) ? `${alias}.${column}` : fallback} AS ${asName}`;
}

function parseMarketOutcomes(raw: string | null): Market['outcomes'] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is Market['outcomes'][number] => (
      row !== null &&
      typeof row === 'object' &&
      typeof (row as { label?: unknown }).label === 'string' &&
      typeof (row as { tokenId?: unknown }).tokenId === 'string' &&
      typeof (row as { price?: unknown }).price === 'number'
    ));
  } catch {
    return [];
  }
}

function emptyOpenBookQuality(openTrades = 0): PolymarketOpenBookQualityEvidence {
  return {
    openTrades,
    evaluatedTrades: 0,
    passingTrades: 0,
    failingTrades: 0,
    missingMetadataTrades: 0,
    filtersActive: POLY_TTL_FILTER_ENABLED || POLY_MARKET_QUALITY_FILTER_ENABLED,
    ttlFilterEnabled: POLY_TTL_FILTER_ENABLED,
    marketQualityFilterEnabled: POLY_MARKET_QUALITY_FILTER_ENABLED,
    minTtlDays: POLY_MIN_MARKET_TTL_DAYS,
    maxTtlDays: POLY_MAX_MARKET_TTL_DAYS,
    passRate: openTrades > 0 ? 0 : null,
    status: openTrades > 0 ? 'warn' : 'pass',
    state: openTrades > 0 ? 'missing_market_metadata' : 'no_open_trades',
    reasons: openTrades > 0
      ? [{
          code: 'missing_market_metadata',
          count: openTrades,
          sampleSlug: null,
          reason: 'open trades cannot be audited because market metadata is unavailable',
        }]
      : [],
    summary: openTrades > 0
      ? `${openTrades} open trades cannot be audited because market metadata is unavailable`
      : 'no open paper trades to audit',
  };
}

function addQualityReason(
  reasons: Map<string, PolymarketOpenBookQualityReason>,
  code: string,
  sampleSlug: string | null,
  reason: string,
): void {
  const existing = reasons.get(code);
  if (existing) {
    existing.count += 1;
    return;
  }
  reasons.set(code, { code, count: 1, sampleSlug, reason });
}

export interface OpenBookQualityOptions {
  ttlFilterEnabled?: boolean;
  marketQualityFilterEnabled?: boolean;
  minTtlDays?: number;
  maxTtlDays?: number;
}

export function collectOpenBookQualityEvidence(
  db: Database.Database,
  nowSec: number,
  options: OpenBookQualityOptions = {},
): PolymarketOpenBookQualityEvidence {
  if (!tableExists(db, 'poly_paper_trades')) return emptyOpenBookQuality();

  const openTrades = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status='open'");
  if (openTrades === 0) return emptyOpenBookQuality();

  const ttlFilterEnabled = options.ttlFilterEnabled ?? POLY_TTL_FILTER_ENABLED;
  const marketQualityFilterEnabled = options.marketQualityFilterEnabled ?? POLY_MARKET_QUALITY_FILTER_ENABLED;
  const minTtlDays = options.minTtlDays ?? POLY_MIN_MARKET_TTL_DAYS;
  const maxTtlDays = options.maxTtlDays ?? POLY_MAX_MARKET_TTL_DAYS;
  const filtersActive = ttlFilterEnabled || marketQualityFilterEnabled;

  if (!tableExists(db, 'poly_markets')) {
    return {
      ...emptyOpenBookQuality(openTrades),
      filtersActive,
      ttlFilterEnabled,
      marketQualityFilterEnabled,
      minTtlDays,
      maxTtlDays,
    };
  }

  const marketCols = tableColumns(db, 'poly_markets');
  const questionExpr = marketCols.has('question') ? 'm.question' : 't.market_slug';
  const categoryExpr = marketCols.has('category') ? 'm.category' : 'NULL';
  const conditionExpr = marketCols.has('condition_id') ? 'm.condition_id' : 'm.slug';
  const outcomesExpr = marketCols.has('outcomes_json') ? 'm.outcomes_json' : 'NULL';
  const volumeExpr = marketCols.has('volume_24h') ? 'm.volume_24h' : '0';
  const liquidityExpr = marketCols.has('liquidity') ? 'm.liquidity' : '0';
  const endExpr = marketCols.has('end_date') ? 'm.end_date' : 'NULL';
  const closedExpr = marketCols.has('closed') ? 'm.closed' : '0';

  const rows = db.prepare(`
    SELECT
      t.market_slug AS trade_slug,
      m.slug AS market_slug,
      ${questionExpr} AS question,
      ${categoryExpr} AS category,
      ${conditionExpr} AS condition_id,
      ${outcomesExpr} AS outcomes_json,
      ${volumeExpr} AS volume_24h,
      ${liquidityExpr} AS liquidity,
      ${endExpr} AS end_date,
      ${closedExpr} AS closed
    FROM poly_paper_trades t
    LEFT JOIN poly_markets m ON m.slug = t.market_slug
    WHERE t.status='open'
  `).all() as Array<{
    trade_slug: string;
    market_slug: string | null;
    question: string | null;
    category: string | null;
    condition_id: string | null;
    outcomes_json: string | null;
    volume_24h: number | null;
    liquidity: number | null;
    end_date: number | null;
    closed: number | null;
  }>;

  let evaluatedTrades = 0;
  let passingTrades = 0;
  let failingTrades = 0;
  let missingMetadataTrades = 0;
  const reasons = new Map<string, PolymarketOpenBookQualityReason>();

  for (const row of rows) {
    if (!row.market_slug || !row.end_date || row.end_date <= 0) {
      missingMetadataTrades += 1;
      addQualityReason(
        reasons,
        'missing_market_metadata',
        row.trade_slug,
        'open trade has no current market metadata or end date',
      );
      continue;
    }

    evaluatedTrades += 1;
    const market: Market = {
      slug: row.market_slug,
      conditionId: row.condition_id ?? row.market_slug,
      question: row.question ?? row.trade_slug,
      category: row.category ?? undefined,
      outcomes: parseMarketOutcomes(row.outcomes_json),
      volume24h: row.volume_24h ?? 0,
      liquidity: row.liquidity ?? 0,
      endDate: normalizeEpochSec(row.end_date),
      closed: row.closed === 1,
    };
    const decision = evaluateMarketQuality(market, {
      nowSec,
      ttlFilterEnabled,
      minTtlDays,
      maxTtlDays,
      marketQualityFilterEnabled,
    });
    if (decision.passed) {
      passingTrades += 1;
      continue;
    }
    failingTrades += 1;
    addQualityReason(
      reasons,
      decision.code ?? 'current_filter_failed',
      row.trade_slug,
      decision.reason ?? 'open trade fails the current paper-learning filters',
    );
  }

  const exceptionCount = failingTrades + missingMetadataTrades;
  const status: ReadinessStatus = exceptionCount > 0 ? 'warn' : 'pass';
  const state: PolymarketOpenBookQualityState = exceptionCount === 0
    ? 'all_inside_current_filters'
    : evaluatedTrades === 0 && missingMetadataTrades > 0
      ? 'missing_market_metadata'
      : 'legacy_filter_exceptions';
  const filtersText = filtersActive
    ? `active filters ttl=${ttlFilterEnabled ? `${minTtlDays}-${maxTtlDays}d` : 'off'}, quality=${marketQualityFilterEnabled ? 'on' : 'off'}`
    : 'current filters inactive';

  return {
    openTrades,
    evaluatedTrades,
    passingTrades,
    failingTrades,
    missingMetadataTrades,
    filtersActive,
    ttlFilterEnabled,
    marketQualityFilterEnabled,
    minTtlDays,
    maxTtlDays,
    passRate: openTrades > 0 ? passingTrades / openTrades : null,
    status,
    state,
    reasons: Array.from(reasons.values()).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    summary: `${passingTrades}/${openTrades} open trades pass today's paper-learning filters; ${exceptionCount} exception(s); ${filtersText}`,
  };
}

function queueState(endAt: number | null, nowSec: number): PolymarketResolutionQueueState {
  if (!endAt || endAt <= 0) return 'unknown';
  if (endAt <= nowSec) return 'overdue';
  if (endAt <= nowSec + 7 * DAY_SEC) return 'due_7d';
  if (endAt <= nowSec + 30 * DAY_SEC) return 'due_30d';
  return 'later';
}

function collectResolutionQueue(
  db: Database.Database,
  nowSec: number,
  hasTrades: boolean,
  hasMarkets: boolean,
  hasPositions: boolean,
): PolymarketResolutionQueueItem[] {
  if (!hasTrades) return [];

  const tradeCols = tableColumns(db, 'poly_paper_trades');
  const marketCols = hasMarkets ? tableColumns(db, 'poly_markets') : new Set<string>();
  const positionCols = hasPositions ? tableColumns(db, 'poly_positions') : new Set<string>();
  const marketJoin = hasMarkets
    ? 'LEFT JOIN poly_markets m ON m.slug = t.market_slug'
    : '';
  const positionJoin = hasPositions
    ? 'LEFT JOIN poly_positions p ON p.paper_trade_id = t.rowid'
    : '';
  const endExpr = hasMarkets && marketCols.has('end_date') ? 'm.end_date' : 'NULL';

  const rows = db.prepare(`
    SELECT
      t.rowid AS trade_id,
      t.created_at AS opened_at,
      t.market_slug AS market_slug,
      ${optionalColumn('t', tradeCols, 'outcome_label', 'NULL', 'outcome_label')},
      ${optionalColumn('t', tradeCols, 'entry_price', 'NULL', 'entry_price')},
      COALESCE(t.size_usd, 0) AS size_usd,
      ${optionalColumn('t', tradeCols, 'shares', 'NULL', 'shares')},
      ${optionalColumn('p', positionCols, 'unrealized_pnl', '0', 'unrealized_pnl')},
      ${endExpr} AS end_at,
      ${optionalColumn('m', marketCols, 'question', 'NULL', 'question')},
      ${optionalColumn('m', marketCols, 'volume_24h', 'NULL', 'volume_24h')},
      ${optionalColumn('m', marketCols, 'liquidity', 'NULL', 'liquidity')}
    FROM poly_paper_trades t
    ${marketJoin}
    ${positionJoin}
    WHERE t.status='open'
    ORDER BY
      CASE WHEN ${endExpr} IS NULL OR ${endExpr} <= 0 THEN 1 ELSE 0 END ASC,
      ${endExpr} ASC,
      t.created_at ASC
    LIMIT 10
  `).all() as Array<{
    trade_id: number;
    opened_at: number;
    market_slug: string;
    outcome_label: string | null;
    entry_price: number | null;
    size_usd: number | null;
    shares: number | null;
    unrealized_pnl: number | null;
    end_at: number | null;
    question: string | null;
    volume_24h: number | null;
    liquidity: number | null;
  }>;

  return rows.map(row => {
    const endAt = row.end_at && row.end_at > 0 ? row.end_at : null;
    const sizeUsd = row.size_usd ?? 0;
    const unrealizedPnlUsd = row.unrealized_pnl ?? 0;
    return {
      tradeId: row.trade_id,
      marketSlug: row.market_slug,
      question: row.question,
      outcomeLabel: row.outcome_label,
      openedAt: normalizeEpochSec(row.opened_at),
      entryPrice: row.entry_price,
      sizeUsd,
      shares: row.shares,
      unrealizedPnlUsd,
      openPnlPct: sizeUsd > 0 ? unrealizedPnlUsd / sizeUsd : null,
      endAt,
      daysToEnd: endAt === null ? null : (endAt - nowSec) / DAY_SEC,
      state: queueState(endAt, nowSec),
      volume24h: row.volume_24h,
      liquidity: row.liquidity,
    };
  });
}

export function collectPolymarketEvidence(db: Database.Database, nowSec: number): PolymarketEvidence {
  const hasTrades = tableExists(db, 'poly_paper_trades');
  const hasMarkets = tableExists(db, 'poly_markets');
  const hasSignals = tableExists(db, 'poly_signals');
  const hasPositions = tableExists(db, 'poly_positions');
  const dayAgo = nowSec - DAY_SEC;
  const openBookQuality = collectOpenBookQualityEvidence(db, nowSec);

  if (!hasTrades) {
    return {
      settledTrades: 0,
      targetSettledTrades: SETTLED_TARGET,
      realizedPnlUsd: 0,
      realizedPnlPositive: false,
      unrealizedPnlUsd: 0,
      totalPnlUsd: 0,
      paperCapitalUsd: POLY_PAPER_CAPITAL,
      paperEquityUsd: POLY_PAPER_CAPITAL,
      paperReturnPct: 0,
      openTrades: 0,
      voidedTrades: 0,
      openExposureUsd: 0,
      openPnlPct: null,
      potentialSettledTrades: 0,
      remainingSettledTrades: SETTLED_TARGET,
      additionalSettledTradesNeeded: SETTLED_TARGET,
      openPipelineCanReachTarget: false,
      openPipelineCoveragePct: 0,
      nearTermPotentialSettledTrades: 0,
      additionalNearTermSettledTradesNeeded: SETTLED_TARGET,
      nearTermPipelineCanReachTarget: false,
      nearTermPipelineCoveragePct: 0,
      paperTradesOpened24h: 0,
      nearTermPaperTradesOpened24h: 0,
      dailyNearTermTradeTarget30d: SETTLED_TARGET / 30,
      nearTermPipelineFillDaysAt24hRate: null,
      nearTermPipelineFillEtaAt: null,
      nearTermVelocityState: hasMarkets ? 'no_near_term_trade_velocity' : 'missing_maturity_data',
      overdueOpenTrades: 0,
      dueNext7Days: 0,
      dueNext30Days: 0,
      nearestOpenEndAt: null,
      latestPaperTradeAt: null,
      signals24h: 0,
      approvedSignals24h: 0,
      approvalRate24h: null,
      latestApprovedSignalAt: null,
      progressPct: 0,
      hasMarketMaturityData: hasMarkets,
      openBookQuality,
      resolutionQueue: [],
    };
  }

  const settledTrades = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status IN ('won','lost')");
  const realizedPnlUsd = scalar(db, "SELECT COALESCE(SUM(realized_pnl), 0) AS value FROM poly_paper_trades WHERE status IN ('won','lost')");
  const openTrades = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status='open'");
  const voidedTrades = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status='voided'");
  const openExposureUsd = scalar(db, "SELECT COALESCE(SUM(size_usd), 0) AS value FROM poly_paper_trades WHERE status='open'");
  const unrealizedPnlUsd = hasPositions
    ? scalar(db, `
        SELECT COALESCE(SUM(p.unrealized_pnl), 0) AS value
          FROM poly_positions p
          INNER JOIN poly_paper_trades t ON t.id = p.paper_trade_id
         WHERE t.status='open'
      `)
    : 0;
  const totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd;
  const paperCapitalUsd = POLY_PAPER_CAPITAL;
  const paperEquityUsd = paperCapitalUsd + totalPnlUsd;
  const latestPaperTradeAt = epoch(db, 'SELECT MAX(created_at) AS value FROM poly_paper_trades');
  const remainingSettledTrades = Math.max(0, SETTLED_TARGET - settledTrades);
  const potentialSettledTrades = settledTrades + openTrades;
  const additionalSettledTradesNeeded = Math.max(0, SETTLED_TARGET - potentialSettledTrades);
  const openPipelineCanReachTarget = potentialSettledTrades >= SETTLED_TARGET;
  const openPipelineCoveragePct = progress(potentialSettledTrades, SETTLED_TARGET);

  let overdueOpenTrades = 0;
  let dueNext7Days = 0;
  let dueNext30Days = 0;
  let nearestOpenEndAt: number | null = null;
  if (hasMarkets) {
    const openWithEndDate = `
      FROM poly_paper_trades t
      INNER JOIN poly_markets m ON m.slug = t.market_slug
      WHERE t.status='open' AND m.end_date > 0
    `;
    overdueOpenTrades = scalar(db, `SELECT COUNT(*) AS value ${openWithEndDate} AND m.end_date <= ?`, [nowSec]);
    dueNext7Days = scalar(db, `SELECT COUNT(*) AS value ${openWithEndDate} AND m.end_date > ? AND m.end_date <= ?`, [nowSec, nowSec + 7 * DAY_SEC]);
    dueNext30Days = scalar(db, `SELECT COUNT(*) AS value ${openWithEndDate} AND m.end_date > ? AND m.end_date <= ?`, [nowSec, nowSec + 30 * DAY_SEC]);
    nearestOpenEndAt = epoch(db, `SELECT MIN(m.end_date) AS value ${openWithEndDate} AND m.end_date > ?`, [nowSec]);
  }

  const nearTermPotentialSettledTrades = settledTrades + dueNext30Days;
  const additionalNearTermSettledTradesNeeded = Math.max(0, SETTLED_TARGET - nearTermPotentialSettledTrades);
  const nearTermPipelineCanReachTarget = nearTermPotentialSettledTrades >= SETTLED_TARGET;
  const nearTermPipelineCoveragePct = progress(nearTermPotentialSettledTrades, SETTLED_TARGET);
  const paperTradesOpened24h = scalar(
    db,
    "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE created_at >= ? AND status IN ('open','won','lost')",
    [dayAgo],
  );
  let nearTermPaperTradesOpened24h = 0;
  if (hasMarkets) {
    nearTermPaperTradesOpened24h = scalar(db, `
      SELECT COUNT(*) AS value
        FROM poly_paper_trades t
        INNER JOIN poly_markets m ON m.slug = t.market_slug
       WHERE t.status='open'
         AND t.created_at >= ?
         AND m.end_date > ?
         AND m.end_date <= ?
    `, [dayAgo, nowSec, nowSec + 30 * DAY_SEC]);
  }
  const dailyNearTermTradeTarget30d = additionalNearTermSettledTradesNeeded > 0
    ? additionalNearTermSettledTradesNeeded / 30
    : 0;
  const nearTermPipelineFillDaysAt24hRate = additionalNearTermSettledTradesNeeded === 0
    ? 0
    : nearTermPaperTradesOpened24h > 0
      ? Math.ceil(additionalNearTermSettledTradesNeeded / nearTermPaperTradesOpened24h)
      : null;
  const nearTermPipelineFillEtaAt = nearTermPipelineFillDaysAt24hRate === null
    ? null
    : nowSec + nearTermPipelineFillDaysAt24hRate * DAY_SEC;
  const nearTermVelocityState: PolymarketNearTermVelocityState = !hasMarkets
    ? 'missing_maturity_data'
    : additionalNearTermSettledTradesNeeded === 0
      ? 'complete'
      : nearTermPaperTradesOpened24h === 0
        ? 'no_near_term_trade_velocity'
        : nearTermPaperTradesOpened24h >= dailyNearTermTradeTarget30d
          ? 'near_term_on_pace'
          : 'near_term_below_pace';

  const signals24h = hasSignals
    ? scalar(db, 'SELECT COUNT(*) AS value FROM poly_signals WHERE created_at >= ?', [dayAgo])
    : 0;
  const approvedSignals24h = hasSignals
    ? scalar(db, 'SELECT COUNT(*) AS value FROM poly_signals WHERE approved=1 AND created_at >= ?', [dayAgo])
    : 0;
  const approvalRate24h = signals24h > 0 ? approvedSignals24h / signals24h : null;
  const latestApprovedSignalAt = hasSignals
    ? epoch(db, 'SELECT MAX(created_at) AS value FROM poly_signals WHERE approved=1')
    : null;
  const resolutionQueue = collectResolutionQueue(db, nowSec, hasTrades, hasMarkets, hasPositions);

  return {
    settledTrades,
    targetSettledTrades: SETTLED_TARGET,
    realizedPnlUsd,
    realizedPnlPositive: realizedPnlUsd > 0,
    unrealizedPnlUsd,
    totalPnlUsd,
    paperCapitalUsd,
    paperEquityUsd,
    paperReturnPct: paperCapitalUsd > 0 ? totalPnlUsd / paperCapitalUsd : null,
    openTrades,
    voidedTrades,
    openExposureUsd,
    openPnlPct: openExposureUsd > 0 ? unrealizedPnlUsd / openExposureUsd : null,
    potentialSettledTrades,
    remainingSettledTrades,
    additionalSettledTradesNeeded,
    openPipelineCanReachTarget,
    openPipelineCoveragePct,
    nearTermPotentialSettledTrades,
    additionalNearTermSettledTradesNeeded,
    nearTermPipelineCanReachTarget,
    nearTermPipelineCoveragePct,
    paperTradesOpened24h,
    nearTermPaperTradesOpened24h,
    dailyNearTermTradeTarget30d,
    nearTermPipelineFillDaysAt24hRate,
    nearTermPipelineFillEtaAt,
    nearTermVelocityState,
    overdueOpenTrades,
    dueNext7Days,
    dueNext30Days,
    nearestOpenEndAt,
    latestPaperTradeAt,
    signals24h,
    approvedSignals24h,
    approvalRate24h,
    latestApprovedSignalAt,
    progressPct: progress(settledTrades, SETTLED_TARGET),
    hasMarketMaturityData: hasMarkets,
    openBookQuality,
    resolutionQueue,
  };
}

export function collectRegimeSharpeEvidence(db: Database.Database): RegimeSharpeEvidence {
  if (!tableExists(db, 'regime_sharpe_snapshots')) {
    return {
      instances: [],
      minDays: 0,
      targetDays: REGIME_DAYS_TARGET,
      allInstancesPositive: false,
      allInstancesComplete: false,
      progressPct: 0,
    };
  }

  const rows = db.prepare(`
    SELECT instance, n_days, rolling_sharpe_60d, created_at
      FROM regime_sharpe_snapshots
     WHERE (instance, created_at) IN (
       SELECT instance, MAX(created_at) FROM regime_sharpe_snapshots GROUP BY instance
     )
     ORDER BY instance ASC
  `).all() as SharpeRow[];

  const instances = rows.map(row => ({
    instance: row.instance,
    nDays: row.n_days,
    rollingSharpe60d: row.rolling_sharpe_60d,
    createdAt: normalizeEpochSec(row.created_at),
  }));
  const minDays = instances.length === 0 ? 0 : Math.min(...instances.map(row => row.nDays));
  const allInstancesPositive = instances.length > 0
    && instances.every(row => (row.rollingSharpe60d ?? -Infinity) > 0);
  const allInstancesComplete = allInstancesPositive
    && instances.every(row => row.nDays >= REGIME_DAYS_TARGET);

  return {
    instances,
    minDays,
    targetDays: REGIME_DAYS_TARGET,
    allInstancesPositive,
    allInstancesComplete,
    progressPct: progress(minDays, REGIME_DAYS_TARGET),
  };
}

function defaultEquityInstanceNames(): ReadonlyArray<string> {
  return REGIME_TRADER_INSTANCES.length > 0 ? REGIME_TRADER_INSTANCES : DEFAULT_EQUITY_INSTANCES;
}

function defaultReadEquityState(_instance: string, statePath: string): { raw: string; mtimeMs: number } {
  const stat = fs.statSync(statePath);
  return {
    raw: fs.readFileSync(statePath, 'utf-8'),
    mtimeMs: stat.mtimeMs,
  };
}

function equitySyncState(args: {
  ageSec: number | null;
  freshSec: number;
  marketOpen: boolean | null;
  hasRegime: boolean;
  hasRisk: boolean;
}): EquitySyncState {
  if (args.ageSec === null || args.ageSec > args.freshSec) return 'stale';
  if (args.marketOpen === true) {
    return args.hasRegime && args.hasRisk ? 'fresh_open_full' : 'fresh_open_partial';
  }
  if (args.marketOpen === false) return 'fresh_closed';
  return 'fresh_unknown';
}

function summarizeEquitySync(instances: ReadonlyArray<EquitySyncInstanceEvidence>): string {
  if (instances.length === 0) return 'no expected equity instances';
  return instances
    .map(row => {
      const age = row.ageSec === null
        ? '-'
        : row.ageSec < 60
          ? `${row.ageSec}s`
          : `${Math.floor(row.ageSec / 60)}m`;
      return `${row.instance} ${row.state} ${age}`;
    })
    .join('; ');
}

export function collectEquitySyncEvidence(
  nowSec = Math.floor(Date.now() / 1000),
  options: EquitySyncOptions = {},
): EquitySyncEvidence {
  const instanceNames = options.instanceNames ?? defaultEquityInstanceNames();
  const root = options.regimeTraderPath ?? (REGIME_TRADER_PATH || 'C:\\Code\\regime-trader');
  const freshSec = options.freshSec ?? EQUITY_SYNC_FRESH_SEC;
  const readState = options.readState ?? defaultReadEquityState;

  const instances = instanceNames.map<EquitySyncInstanceEvidence>(instance => {
    const statePath = path.join(root, 'instances', instance, 'data', 'state.json');
    try {
      const { raw, mtimeMs } = readState(instance, statePath);
      const syncedAt = Math.floor(mtimeMs / 1000);
      const ageSec = Math.max(0, nowSec - syncedAt);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const marketOpen = typeof parsed.market_open === 'boolean' ? parsed.market_open : null;
      const hasRegime = parsed.regime !== null && parsed.regime !== undefined;
      const hasRisk = parsed.risk !== null && parsed.risk !== undefined;
      const equity = typeof parsed.equity === 'number' && Number.isFinite(parsed.equity)
        ? parsed.equity
        : null;
      return {
        instance,
        state: equitySyncState({ ageSec, freshSec, marketOpen, hasRegime, hasRisk }),
        syncedAt,
        ageSec,
        marketOpen,
        hasRegime,
        hasRisk,
        equity,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = /ENOENT|no such file/i.test(message);
      return {
        instance,
        state: missing ? 'missing' : 'unreadable',
        syncedAt: null,
        ageSec: null,
        marketOpen: null,
        hasRegime: false,
        hasRisk: false,
        equity: null,
        error: message.slice(0, 180),
      };
    }
  });

  const latestAtValues = instances
    .map(row => row.syncedAt)
    .filter((value): value is number => value !== null);
  const ages = instances
    .map(row => row.ageSec)
    .filter((value): value is number => value !== null);
  const freshCount = instances.filter(row => row.ageSec !== null && row.ageSec <= freshSec).length;
  const allFresh = instances.length > 0 && freshCount === instances.length;
  const allOpenFull = instances.length > 0 && instances.every(row => row.state === 'fresh_open_full');
  const hasUnreadable = instances.some(row => row.state === 'missing' || row.state === 'unreadable');
  const hasPartial = instances.some(row => row.state === 'fresh_open_partial' || row.state === 'fresh_unknown');
  const status: ReadinessStatus = instances.length === 0 || freshCount === 0
    ? 'fail'
    : (!allFresh || hasUnreadable || hasPartial ? 'warn' : 'pass');

  return {
    instances,
    expectedCount: instances.length,
    freshCount,
    latestAt: latestAtValues.length > 0 ? Math.max(...latestAtValues) : null,
    maxAgeSec: ages.length > 0 ? Math.max(...ages) : null,
    allFresh,
    allOpenFull,
    status,
    summary: summarizeEquitySync(instances),
  };
}

function asEquityCurvePoints(
  rows: ReadonlyArray<{ snapshot_date: string; equity: number; daily_return: number | null }>,
): EquityCurvePoint[] {
  return rows.map(row => ({
    date: row.snapshot_date,
    equity: row.equity,
    dailyReturn: row.daily_return,
  }));
}

export function collectEquityBenchmarkEvidence(db: Database.Database): EquityBenchmarkEvidence {
  if (!tableExists(db, 'equity_benchmark_snapshots')) {
    return {
      instances: [],
      benchmark: null,
      minExcessReturn: null,
      allOutperforming: false,
      status: 'warn',
      summary: 'equity_benchmark_snapshots missing',
    };
  }
  if (!tableExists(db, 'regime_sharpe_snapshots')) {
    return {
      instances: [],
      benchmark: null,
      minExcessReturn: null,
      allOutperforming: false,
      status: 'warn',
      summary: 'regime_sharpe_snapshots missing',
    };
  }

  const benchmarkRows = db.prepare(`
    SELECT benchmark, snapshot_date, equity, daily_return
      FROM equity_benchmark_snapshots
     ORDER BY benchmark ASC, snapshot_date ASC
  `).all() as EquityBenchmarkRow[];
  if (benchmarkRows.length === 0) {
    return {
      instances: [],
      benchmark: null,
      minExcessReturn: null,
      allOutperforming: false,
      status: 'warn',
      summary: 'benchmark table empty',
    };
  }

  const benchmarkName = benchmarkRows[0]!.benchmark;
  const selectedBenchmarkRows = benchmarkRows.filter(row => row.benchmark === benchmarkName);
  const regimeRows = db.prepare(`
    SELECT instance, snapshot_date, equity, daily_return
      FROM regime_sharpe_snapshots
     ORDER BY instance ASC, snapshot_date ASC
  `).all() as RegimeCurveRow[];
  const instanceNames = [...new Set(regimeRows.map(row => row.instance))].sort();
  if (instanceNames.length === 0) {
    return {
      instances: [],
      benchmark: benchmarkName,
      minExcessReturn: null,
      allOutperforming: false,
      status: 'warn',
      summary: `no regime snapshots to compare with ${benchmarkName}`,
    };
  }

  const instances = instanceNames.map<EquityBenchmarkInstanceEvidence>(instance => {
    const strategyRows = regimeRows.filter(row => row.instance === instance);
    const comparison = compareEquityBenchmark({
      instance,
      benchmark: benchmarkName,
      strategyPoints: asEquityCurvePoints(strategyRows),
      benchmarkPoints: asEquityCurvePoints(selectedBenchmarkRows),
    });

    return {
      instance,
      benchmark: benchmarkName,
      strategyReturn: comparison.strategy.cumulativeReturn,
      benchmarkReturn: comparison.benchmarkStats.cumulativeReturn,
      excessReturn: comparison.excessCumulativeReturn,
      nDays: comparison.strategy.nDays,
    };
  });

  const excessValues = instances
    .map(row => row.excessReturn)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const minExcessReturn = excessValues.length > 0 ? Math.min(...excessValues) : null;
  const allOutperforming = instances.length > 0
    && instances.every(row => row.excessReturn !== null && row.excessReturn > 0);
  const summary = instances
    .map(row => `${row.instance} excess=${compactPct(row.excessReturn)}`)
    .join('; ');

  return {
    instances,
    benchmark: benchmarkName,
    minExcessReturn,
    allOutperforming,
    status: allOutperforming ? 'pass' : 'warn',
    summary: summary || `no comparable equity benchmark evidence for ${benchmarkName}`,
  };
}

export function collectTtlFilterEvidence(db: Database.Database, nowSec: number): TtlFilterEvidence {
  if (!tableExists(db, 'poly_ttl_shadow_ticks')) {
    return {
      latestAt: null,
      ageSec: null,
      bandMinDays: null,
      bandMaxDays: null,
      candidatesTotal: 0,
      candidatesTtlPass: 0,
      passRate: null,
      avgTtlPass: null,
      avgTtlFiltered: null,
    };
  }

  const row = db.prepare(`
    SELECT scan_tick_at, candidates_total, candidates_ttl_pass,
           avg_ttl_pass, avg_ttl_filtered, band_min_days, band_max_days
      FROM poly_ttl_shadow_ticks
     ORDER BY scan_tick_at DESC
     LIMIT 1
  `).get() as TtlRow | undefined;

  if (!row) {
    return {
      latestAt: null,
      ageSec: null,
      bandMinDays: null,
      bandMaxDays: null,
      candidatesTotal: 0,
      candidatesTtlPass: 0,
      passRate: null,
      avgTtlPass: null,
      avgTtlFiltered: null,
    };
  }

  return {
    latestAt: row.scan_tick_at,
    ageSec: Math.max(0, nowSec - row.scan_tick_at),
    bandMinDays: row.band_min_days,
    bandMaxDays: row.band_max_days,
    candidatesTotal: row.candidates_total,
    candidatesTtlPass: row.candidates_ttl_pass,
    passRate: row.candidates_total > 0 ? row.candidates_ttl_pass / row.candidates_total : null,
    avgTtlPass: row.avg_ttl_pass,
    avgTtlFiltered: row.avg_ttl_filtered,
  };
}

export function collectMarketDiscoveryEvidence(
  db: Database.Database,
  nowSec: number,
): MarketDiscoveryEvidence {
  if (!tableExists(db, 'poly_scan_runs')) {
    return {
      latestAt: null,
      ageSec: null,
      marketCount: 0,
      targetMarketCount: MARKET_DISCOVERY_TARGET,
      firstPageCapThreshold: MARKET_DISCOVERY_FIRST_PAGE_CAP,
      durationMs: null,
      status: 'fail',
      state: 'missing',
      progressPct: 0,
      summary: 'poly_scan_runs table missing',
    };
  }

  const row = db.prepare(`
    SELECT started_at, duration_ms, market_count, status
      FROM poly_scan_runs
     WHERE status='ok'
     ORDER BY started_at DESC
     LIMIT 1
  `).get() as ScanRunRow | undefined;

  if (!row) {
    return {
      latestAt: null,
      ageSec: null,
      marketCount: 0,
      targetMarketCount: MARKET_DISCOVERY_TARGET,
      firstPageCapThreshold: MARKET_DISCOVERY_FIRST_PAGE_CAP,
      durationMs: null,
      status: 'fail',
      state: 'missing',
      progressPct: 0,
      summary: 'no successful poly_scan_runs row found',
    };
  }

  const marketCount = row.market_count ?? 0;
  const ageSec = Math.max(0, nowSec - row.started_at);
  let status: ReadinessStatus = 'pass';
  let state: MarketDiscoveryState = 'healthy';

  if (ageSec > MARKET_DISCOVERY_FRESH_SEC) {
    status = 'warn';
    state = 'stale';
  } else if (marketCount <= MARKET_DISCOVERY_FIRST_PAGE_CAP) {
    status = 'warn';
    state = 'first_page_capped';
  } else if (marketCount < MARKET_DISCOVERY_TARGET) {
    status = 'warn';
    state = 'shallow';
  }

  return {
    latestAt: row.started_at,
    ageSec,
    marketCount,
    targetMarketCount: MARKET_DISCOVERY_TARGET,
    firstPageCapThreshold: MARKET_DISCOVERY_FIRST_PAGE_CAP,
    durationMs: row.duration_ms,
    status,
    state,
    progressPct: progress(marketCount, MARKET_DISCOVERY_TARGET),
    summary: `${marketCount} markets discovered; target >=${MARKET_DISCOVERY_TARGET}; age ${ageSec}s; duration ${row.duration_ms ?? '-'}ms`,
  };
}

function buildMetrics(
  polymarket: PolymarketEvidence,
  equitySync: EquitySyncEvidence | null,
  equityBenchmark: EquityBenchmarkEvidence | null,
  regimeSharpe: RegimeSharpeEvidence,
  ttlFilter: TtlFilterEvidence,
  marketDiscovery: MarketDiscoveryEvidence,
): ReadinessEvidenceMetric[] {
  const hasPaperTrades = polymarket.settledTrades + polymarket.openTrades + polymarket.voidedTrades > 0;
  const resolutionState = !hasPaperTrades
    ? 'no_paper_trades'
    : polymarket.dueNext7Days > 0
      ? 'near_term_resolutions'
      : polymarket.dueNext30Days > 0
        ? 'resolutions_scheduled'
        : polymarket.openTrades > 0
          ? 'long_dated_open'
          : 'awaiting_new_trades';

  const metrics: ReadinessEvidenceMetric[] = [
    {
      key: 'polymarket_settled_trades',
      name: 'Polymarket Box 2',
      status: polymarket.settledTrades >= SETTLED_TARGET && polymarket.realizedPnlPositive ? 'pass' : 'warn',
      state: polymarket.settledTrades >= SETTLED_TARGET && polymarket.realizedPnlPositive ? 'complete' : 'incomplete',
      detail: `${polymarket.settledTrades}/${SETTLED_TARGET} settled; realized P&L ${polymarket.realizedPnlUsd.toFixed(2)}; open ${polymarket.openTrades}; voided ${polymarket.voidedTrades}`,
      current: polymarket.settledTrades,
      target: SETTLED_TARGET,
      progressPct: polymarket.progressPct,
    },
    {
      key: 'polymarket_box2_pipeline_capacity',
      name: 'Box 2 pipeline capacity',
      status: polymarket.settledTrades >= SETTLED_TARGET && polymarket.realizedPnlPositive ? 'pass' : 'warn',
      state: polymarket.openPipelineCanReachTarget
        ? 'open_book_can_reach_target'
        : (polymarket.potentialSettledTrades > 0 ? 'open_book_underfilled' : 'no_settlement_pipeline'),
      detail: `${polymarket.settledTrades} settled + ${polymarket.openTrades} open = ${polymarket.potentialSettledTrades}/${SETTLED_TARGET} potential; needs ${polymarket.additionalSettledTradesNeeded} more resolved trades after current book`,
      current: polymarket.potentialSettledTrades,
      target: SETTLED_TARGET,
      progressPct: polymarket.openPipelineCoveragePct,
    },
    {
      key: 'polymarket_near_term_box2_capacity',
      name: 'Near-term Box 2 capacity',
      status: polymarket.settledTrades >= SETTLED_TARGET && polymarket.realizedPnlPositive ? 'pass' : 'warn',
      state: polymarket.nearTermPipelineCanReachTarget
        ? 'near_term_book_can_reach_target'
        : (polymarket.nearTermPotentialSettledTrades > polymarket.settledTrades ? 'near_term_underfilled' : 'no_near_term_pipeline'),
      detail: `${polymarket.settledTrades} settled + ${polymarket.dueNext30Days} due <=30d = ${polymarket.nearTermPotentialSettledTrades}/${SETTLED_TARGET} near-term; needs ${polymarket.additionalNearTermSettledTradesNeeded} more near-term resolved trades`,
      current: polymarket.nearTermPotentialSettledTrades,
      target: SETTLED_TARGET,
      progressPct: polymarket.nearTermPipelineCoveragePct,
    },
    {
      key: 'polymarket_box2_learning_velocity',
      name: 'Box 2 learning velocity',
      status: polymarket.nearTermVelocityState === 'complete' || polymarket.nearTermVelocityState === 'near_term_on_pace'
        ? 'pass'
        : 'warn',
      state: polymarket.nearTermVelocityState,
      detail: `near-term opened ${polymarket.nearTermPaperTradesOpened24h}/24h; needs ${polymarket.dailyNearTermTradeTarget30d.toFixed(1)}/day for 30d path; ${polymarket.nearTermPipelineFillDaysAt24hRate === null ? 'ETA unavailable at current rate' : `ETA ${polymarket.nearTermPipelineFillDaysAt24hRate}d at current rate`}; all learning trades ${polymarket.paperTradesOpened24h}/24h`,
      current: polymarket.nearTermPaperTradesOpened24h,
      target: Math.max(1, Math.ceil(polymarket.dailyNearTermTradeTarget30d)),
      progressPct: polymarket.dailyNearTermTradeTarget30d > 0
        ? progress(polymarket.nearTermPaperTradesOpened24h, polymarket.dailyNearTermTradeTarget30d)
        : 1,
    },
    {
      key: 'polymarket_resolution_pipeline',
      name: 'Resolution pipeline',
      status: hasPaperTrades ? 'pass' : 'warn',
      state: resolutionState,
      detail: `due <=7d ${polymarket.dueNext7Days}; due <=30d ${polymarket.dueNext30Days}; overdue ${polymarket.overdueOpenTrades}`,
      current: polymarket.dueNext30Days,
      target: Math.max(1, polymarket.openTrades),
      progressPct: polymarket.openTrades > 0 ? progress(polymarket.dueNext30Days, polymarket.openTrades) : null,
    },
    {
      key: 'polymarket_mark_to_market',
      name: 'Strategy mark-to-market',
      status: polymarket.totalPnlUsd >= 0 ? 'pass' : 'warn',
      state: polymarket.openTrades > 0
        ? (polymarket.totalPnlUsd >= 0 ? 'positive_paper_equity' : 'negative_paper_equity')
        : 'no_open_positions',
      detail: `total P&L ${polymarket.totalPnlUsd.toFixed(2)}; unrealized ${polymarket.unrealizedPnlUsd.toFixed(2)}; equity ${polymarket.paperEquityUsd.toFixed(2)}; approval ${polymarket.approvalRate24h === null ? 'n/a' : `${(polymarket.approvalRate24h * 100).toFixed(2)}%`}`,
      current: polymarket.totalPnlUsd,
      progressPct: polymarket.paperReturnPct,
    },
    {
      key: 'polymarket_open_book_quality',
      name: 'Open-book quality',
      status: polymarket.openBookQuality.status,
      state: polymarket.openBookQuality.state,
      detail: polymarket.openBookQuality.summary,
      current: polymarket.openBookQuality.passingTrades,
      target: polymarket.openBookQuality.openTrades,
      progressPct: polymarket.openBookQuality.passRate,
    },
    {
      key: 'polymarket_signal_flow',
      name: 'Polymarket signal flow',
      status: polymarket.approvedSignals24h > 0 ? 'pass' : (polymarket.signals24h > 0 ? 'warn' : 'fail'),
      state: polymarket.approvedSignals24h > 0 ? 'approving' : (polymarket.signals24h > 0 ? 'scanning_no_approvals' : 'no_signals'),
      detail: `${polymarket.signals24h} signals and ${polymarket.approvedSignals24h} approvals in the last 24h`,
      current: polymarket.approvedSignals24h,
    },
    {
      key: 'polymarket_market_discovery',
      name: 'Market discovery',
      status: marketDiscovery.status,
      state: marketDiscovery.state,
      detail: marketDiscovery.summary,
      current: marketDiscovery.marketCount,
      target: marketDiscovery.targetMarketCount,
      progressPct: marketDiscovery.progressPct,
    },
    {
      key: 'ttl_filter_tracking',
      name: 'TTL filter tracking',
      status: ttlFilter.latestAt === null ? 'warn' : ((ttlFilter.ageSec ?? Infinity) <= 600 ? 'pass' : 'warn'),
      state: ttlFilter.latestAt === null ? 'missing' : ((ttlFilter.ageSec ?? Infinity) <= 600 ? 'fresh' : 'stale'),
      detail: ttlFilter.latestAt === null
        ? 'no TTL shadow tick yet'
        : `${ttlFilter.candidatesTtlPass}/${ttlFilter.candidatesTotal} latest candidates pass TTL`,
      current: ttlFilter.candidatesTtlPass,
      target: ttlFilter.candidatesTotal,
      progressPct: ttlFilter.passRate,
    },
  ];

  if (equitySync) {
    metrics.push({
      key: 'equity_state_sync',
      name: 'Equity state sync',
      status: equitySync.status,
      state: equitySync.status === 'pass'
        ? (equitySync.allOpenFull ? 'open_full' : 'fresh')
        : (equitySync.freshCount > 0 ? 'partial_or_stale' : 'missing_or_stale'),
      detail: equitySync.summary,
      current: equitySync.freshCount,
      target: equitySync.expectedCount,
      progressPct: equitySync.expectedCount > 0 ? progress(equitySync.freshCount, equitySync.expectedCount) : null,
    });
  }

  if (equityBenchmark) {
    metrics.push({
      key: 'equity_benchmark_edge',
      name: 'Equity benchmark',
      status: equityBenchmark.status,
      state: equityBenchmark.allOutperforming
        ? 'outperforming'
        : (equityBenchmark.instances.length > 0 ? 'incomplete_or_lagging' : 'missing'),
      detail: equityBenchmark.summary,
      current: equityBenchmark.minExcessReturn ?? undefined,
      progressPct: equityBenchmark.minExcessReturn,
    });
  }

  metrics.push(
    {
      key: 'regime_sharpe_track',
      name: 'Regime Box 3',
      status: regimeSharpe.allInstancesComplete ? 'pass' : (regimeSharpe.instances.length > 0 ? 'warn' : 'fail'),
      state: regimeSharpe.allInstancesComplete ? 'complete' : (regimeSharpe.instances.length > 0 ? 'incomplete' : 'no_snapshots'),
      detail: regimeSharpe.instances.length === 0
        ? 'no regime Sharpe snapshots'
        : regimeSharpe.instances
          .map(row => `${row.instance} ${row.nDays}/${REGIME_DAYS_TARGET}d sharpe=${row.rollingSharpe60d?.toFixed(2) ?? 'n/a'}`)
          .join('; '),
      current: regimeSharpe.minDays,
      target: REGIME_DAYS_TARGET,
      progressPct: regimeSharpe.progressPct,
    },
  );

  return metrics;
}

export function collectOperationalEvidence(
  db: Database.Database,
  nowSec = Math.floor(Date.now() / 1000),
  options: OperationalEvidenceOptions = {},
): OperationalEvidencePayload {
  const polymarket = collectPolymarketEvidence(db, nowSec);
  const equitySync = options.equitySync !== undefined
    ? options.equitySync
    : options.collectEquitySync
      ? collectEquitySyncEvidence(nowSec, options.equitySyncOptions)
      : null;
  const equityBenchmark = options.equityBenchmark !== undefined
    ? options.equityBenchmark
    : options.collectEquityBenchmark
      ? collectEquityBenchmarkEvidence(db)
      : null;
  const regimeSharpe = collectRegimeSharpeEvidence(db);
  const ttlFilter = collectTtlFilterEvidence(db, nowSec);
  const marketDiscovery = collectMarketDiscoveryEvidence(db, nowSec);
  const metrics = buildMetrics(
    polymarket,
    equitySync,
    equityBenchmark,
    regimeSharpe,
    ttlFilter,
    marketDiscovery,
  );

  return {
    generatedAt: nowSec,
    status: worstStatus(metrics),
    polymarket,
    equitySync,
    equityBenchmark,
    regimeSharpe,
    ttlFilter,
    marketDiscovery,
    metrics,
  };
}

export function ensureOperationalEvidenceSnapshotsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS readiness_evidence_snapshots (
      snapshot_ymd                  TEXT PRIMARY KEY,
      captured_at                   INTEGER NOT NULL,
      status                        TEXT NOT NULL,
      poly_settled_trades           INTEGER NOT NULL,
      poly_target_settled_trades    INTEGER NOT NULL,
      poly_realized_pnl_usd         REAL NOT NULL,
      poly_unrealized_pnl_usd       REAL NOT NULL DEFAULT 0,
      poly_total_pnl_usd            REAL NOT NULL DEFAULT 0,
      poly_paper_equity_usd         REAL NOT NULL DEFAULT 0,
      poly_approval_rate_24h        REAL,
      poly_open_trades              INTEGER NOT NULL,
      poly_voided_trades            INTEGER NOT NULL,
      poly_potential_settled_trades INTEGER NOT NULL DEFAULT 0,
      poly_additional_settled_trades_needed INTEGER NOT NULL DEFAULT 0,
      poly_near_term_potential_settled_trades INTEGER NOT NULL DEFAULT 0,
      poly_additional_near_term_settled_trades_needed INTEGER NOT NULL DEFAULT 0,
      poly_paper_trades_opened_24h INTEGER NOT NULL DEFAULT 0,
      poly_near_term_paper_trades_opened_24h INTEGER NOT NULL DEFAULT 0,
      poly_daily_near_term_trade_target_30d REAL NOT NULL DEFAULT 0,
      poly_near_term_fill_days_at_24h_rate INTEGER,
      poly_due_next_7d              INTEGER NOT NULL,
      poly_due_next_30d             INTEGER NOT NULL,
      poly_overdue_open_trades      INTEGER NOT NULL,
      equity_sync_fresh_count       INTEGER NOT NULL DEFAULT 0,
      equity_sync_expected_count    INTEGER NOT NULL DEFAULT 0,
      equity_sync_max_age_sec       INTEGER,
      equity_benchmark_min_excess_return REAL,
      equity_benchmark_all_outperforming INTEGER NOT NULL DEFAULT 0,
      equity_benchmark_instance_count INTEGER NOT NULL DEFAULT 0,
      regime_min_days               INTEGER NOT NULL,
      regime_target_days            INTEGER NOT NULL,
      regime_all_instances_positive INTEGER NOT NULL,
      ttl_candidates_total          INTEGER NOT NULL,
      ttl_candidates_ttl_pass       INTEGER NOT NULL,
      ttl_pass_rate                 REAL,
      poly_market_discovery_count   INTEGER NOT NULL DEFAULT 0,
      poly_market_discovery_target  INTEGER NOT NULL DEFAULT 500,
      poly_market_discovery_age_sec INTEGER,
      poly_quality_passing_open_trades INTEGER NOT NULL DEFAULT 0,
      poly_quality_failing_open_trades INTEGER NOT NULL DEFAULT 0,
      poly_quality_missing_metadata_trades INTEGER NOT NULL DEFAULT 0,
      payload_json                  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_readiness_evidence_captured_at
      ON readiness_evidence_snapshots(captured_at DESC);
  `);
  const cols = tableColumns(db, 'readiness_evidence_snapshots');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_unrealized_pnl_usd', 'poly_unrealized_pnl_usd REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_total_pnl_usd', 'poly_total_pnl_usd REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_paper_equity_usd', 'poly_paper_equity_usd REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_approval_rate_24h', 'poly_approval_rate_24h REAL');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_potential_settled_trades', 'poly_potential_settled_trades INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_additional_settled_trades_needed', 'poly_additional_settled_trades_needed INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_near_term_potential_settled_trades', 'poly_near_term_potential_settled_trades INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_additional_near_term_settled_trades_needed', 'poly_additional_near_term_settled_trades_needed INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_paper_trades_opened_24h', 'poly_paper_trades_opened_24h INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_near_term_paper_trades_opened_24h', 'poly_near_term_paper_trades_opened_24h INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_daily_near_term_trade_target_30d', 'poly_daily_near_term_trade_target_30d REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_near_term_fill_days_at_24h_rate', 'poly_near_term_fill_days_at_24h_rate INTEGER');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'equity_sync_fresh_count', 'equity_sync_fresh_count INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'equity_sync_expected_count', 'equity_sync_expected_count INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'equity_sync_max_age_sec', 'equity_sync_max_age_sec INTEGER');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'equity_benchmark_min_excess_return', 'equity_benchmark_min_excess_return REAL');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'equity_benchmark_all_outperforming', 'equity_benchmark_all_outperforming INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'equity_benchmark_instance_count', 'equity_benchmark_instance_count INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_market_discovery_count', 'poly_market_discovery_count INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_market_discovery_target', 'poly_market_discovery_target INTEGER NOT NULL DEFAULT 500');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_market_discovery_age_sec', 'poly_market_discovery_age_sec INTEGER');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_quality_passing_open_trades', 'poly_quality_passing_open_trades INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_quality_failing_open_trades', 'poly_quality_failing_open_trades INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'readiness_evidence_snapshots', cols, 'poly_quality_missing_metadata_trades', 'poly_quality_missing_metadata_trades INTEGER NOT NULL DEFAULT 0');
}

export function recordOperationalEvidenceSnapshot(
  db: Database.Database,
  payload: OperationalEvidencePayload,
): string {
  ensureOperationalEvidenceSnapshotsTable(db);
  const ymd = snapshotYmd(payload.generatedAt);
  db.prepare(`
    INSERT INTO readiness_evidence_snapshots (
      snapshot_ymd, captured_at, status,
      poly_settled_trades, poly_target_settled_trades, poly_realized_pnl_usd,
      poly_unrealized_pnl_usd, poly_total_pnl_usd, poly_paper_equity_usd,
      poly_approval_rate_24h,
      poly_open_trades, poly_voided_trades, poly_due_next_7d,
      poly_due_next_30d, poly_overdue_open_trades,
      poly_potential_settled_trades, poly_additional_settled_trades_needed,
      poly_near_term_potential_settled_trades, poly_additional_near_term_settled_trades_needed,
      poly_paper_trades_opened_24h, poly_near_term_paper_trades_opened_24h,
      poly_daily_near_term_trade_target_30d, poly_near_term_fill_days_at_24h_rate,
      equity_sync_fresh_count, equity_sync_expected_count, equity_sync_max_age_sec,
      equity_benchmark_min_excess_return, equity_benchmark_all_outperforming,
      equity_benchmark_instance_count,
      regime_min_days, regime_target_days, regime_all_instances_positive,
      ttl_candidates_total, ttl_candidates_ttl_pass, ttl_pass_rate,
      poly_market_discovery_count, poly_market_discovery_target,
      poly_market_discovery_age_sec,
      poly_quality_passing_open_trades, poly_quality_failing_open_trades,
      poly_quality_missing_metadata_trades,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_ymd) DO UPDATE SET
      captured_at = excluded.captured_at,
      status = excluded.status,
      poly_settled_trades = excluded.poly_settled_trades,
      poly_target_settled_trades = excluded.poly_target_settled_trades,
      poly_realized_pnl_usd = excluded.poly_realized_pnl_usd,
      poly_unrealized_pnl_usd = excluded.poly_unrealized_pnl_usd,
      poly_total_pnl_usd = excluded.poly_total_pnl_usd,
      poly_paper_equity_usd = excluded.poly_paper_equity_usd,
      poly_approval_rate_24h = excluded.poly_approval_rate_24h,
      poly_open_trades = excluded.poly_open_trades,
      poly_voided_trades = excluded.poly_voided_trades,
      poly_due_next_7d = excluded.poly_due_next_7d,
      poly_due_next_30d = excluded.poly_due_next_30d,
      poly_overdue_open_trades = excluded.poly_overdue_open_trades,
      poly_potential_settled_trades = excluded.poly_potential_settled_trades,
      poly_additional_settled_trades_needed = excluded.poly_additional_settled_trades_needed,
      poly_near_term_potential_settled_trades = excluded.poly_near_term_potential_settled_trades,
      poly_additional_near_term_settled_trades_needed = excluded.poly_additional_near_term_settled_trades_needed,
      poly_paper_trades_opened_24h = excluded.poly_paper_trades_opened_24h,
      poly_near_term_paper_trades_opened_24h = excluded.poly_near_term_paper_trades_opened_24h,
      poly_daily_near_term_trade_target_30d = excluded.poly_daily_near_term_trade_target_30d,
      poly_near_term_fill_days_at_24h_rate = excluded.poly_near_term_fill_days_at_24h_rate,
      equity_sync_fresh_count = excluded.equity_sync_fresh_count,
      equity_sync_expected_count = excluded.equity_sync_expected_count,
      equity_sync_max_age_sec = excluded.equity_sync_max_age_sec,
      equity_benchmark_min_excess_return = excluded.equity_benchmark_min_excess_return,
      equity_benchmark_all_outperforming = excluded.equity_benchmark_all_outperforming,
      equity_benchmark_instance_count = excluded.equity_benchmark_instance_count,
      regime_min_days = excluded.regime_min_days,
      regime_target_days = excluded.regime_target_days,
      regime_all_instances_positive = excluded.regime_all_instances_positive,
      ttl_candidates_total = excluded.ttl_candidates_total,
      ttl_candidates_ttl_pass = excluded.ttl_candidates_ttl_pass,
      ttl_pass_rate = excluded.ttl_pass_rate,
      poly_market_discovery_count = excluded.poly_market_discovery_count,
      poly_market_discovery_target = excluded.poly_market_discovery_target,
      poly_market_discovery_age_sec = excluded.poly_market_discovery_age_sec,
      poly_quality_passing_open_trades = excluded.poly_quality_passing_open_trades,
      poly_quality_failing_open_trades = excluded.poly_quality_failing_open_trades,
      poly_quality_missing_metadata_trades = excluded.poly_quality_missing_metadata_trades,
      payload_json = excluded.payload_json
  `).run(
    ymd,
    payload.generatedAt,
    payload.status,
    payload.polymarket.settledTrades,
    payload.polymarket.targetSettledTrades,
    payload.polymarket.realizedPnlUsd,
    payload.polymarket.unrealizedPnlUsd,
    payload.polymarket.totalPnlUsd,
    payload.polymarket.paperEquityUsd,
    payload.polymarket.approvalRate24h,
    payload.polymarket.openTrades,
    payload.polymarket.voidedTrades,
    payload.polymarket.dueNext7Days,
    payload.polymarket.dueNext30Days,
    payload.polymarket.overdueOpenTrades,
    payload.polymarket.potentialSettledTrades,
    payload.polymarket.additionalSettledTradesNeeded,
    payload.polymarket.nearTermPotentialSettledTrades,
    payload.polymarket.additionalNearTermSettledTradesNeeded,
    payload.polymarket.paperTradesOpened24h,
    payload.polymarket.nearTermPaperTradesOpened24h,
    payload.polymarket.dailyNearTermTradeTarget30d,
    payload.polymarket.nearTermPipelineFillDaysAt24hRate,
    payload.equitySync?.freshCount ?? 0,
    payload.equitySync?.expectedCount ?? 0,
    payload.equitySync?.maxAgeSec ?? null,
    payload.equityBenchmark?.minExcessReturn ?? null,
    payload.equityBenchmark?.allOutperforming ? 1 : 0,
    payload.equityBenchmark?.instances.length ?? 0,
    payload.regimeSharpe.minDays,
    payload.regimeSharpe.targetDays,
    payload.regimeSharpe.allInstancesPositive ? 1 : 0,
    payload.ttlFilter.candidatesTotal,
    payload.ttlFilter.candidatesTtlPass,
    payload.ttlFilter.passRate,
    payload.marketDiscovery.marketCount,
    payload.marketDiscovery.targetMarketCount,
    payload.marketDiscovery.ageSec,
    payload.polymarket.openBookQuality.passingTrades,
    payload.polymarket.openBookQuality.failingTrades,
    payload.polymarket.openBookQuality.missingMetadataTrades,
    JSON.stringify(payload),
  );
  return ymd;
}

export function readOperationalEvidenceHistory(
  db: Database.Database,
  limit = 30,
): OperationalEvidenceHistoryPoint[] {
  if (!tableExists(db, 'readiness_evidence_snapshots')) return [];
  const safeLimit = Math.max(1, Math.min(365, Math.floor(limit)));
  const cols = tableColumns(db, 'readiness_evidence_snapshots');
  const optional = (column: string, fallback: string) =>
    cols.has(column) ? column : fallback;
  const rows = db.prepare(`
    SELECT snapshot_ymd, captured_at, status,
           poly_settled_trades, poly_target_settled_trades,
           poly_realized_pnl_usd,
           ${optional('poly_unrealized_pnl_usd', '0')} AS poly_unrealized_pnl_usd,
           ${optional('poly_total_pnl_usd', 'poly_realized_pnl_usd')} AS poly_total_pnl_usd,
           ${optional('poly_paper_equity_usd', '0')} AS poly_paper_equity_usd,
           ${optional('poly_approval_rate_24h', 'NULL')} AS poly_approval_rate_24h,
           poly_open_trades, poly_voided_trades,
           poly_due_next_7d, poly_due_next_30d, poly_overdue_open_trades,
           ${optional('poly_potential_settled_trades', 'poly_settled_trades + poly_open_trades')} AS poly_potential_settled_trades,
           ${optional('poly_additional_settled_trades_needed', 'MAX(poly_target_settled_trades - (poly_settled_trades + poly_open_trades), 0)')} AS poly_additional_settled_trades_needed,
           ${optional('poly_near_term_potential_settled_trades', 'poly_settled_trades + poly_due_next_30d')} AS poly_near_term_potential_settled_trades,
           ${optional('poly_additional_near_term_settled_trades_needed', 'MAX(poly_target_settled_trades - (poly_settled_trades + poly_due_next_30d), 0)')} AS poly_additional_near_term_settled_trades_needed,
           ${optional('poly_paper_trades_opened_24h', '0')} AS poly_paper_trades_opened_24h,
           ${optional('poly_near_term_paper_trades_opened_24h', '0')} AS poly_near_term_paper_trades_opened_24h,
           ${optional('poly_daily_near_term_trade_target_30d', '0')} AS poly_daily_near_term_trade_target_30d,
           ${optional('poly_near_term_fill_days_at_24h_rate', 'NULL')} AS poly_near_term_fill_days_at_24h_rate,
           ${optional('equity_sync_fresh_count', '0')} AS equity_sync_fresh_count,
           ${optional('equity_sync_expected_count', '0')} AS equity_sync_expected_count,
           ${optional('equity_sync_max_age_sec', 'NULL')} AS equity_sync_max_age_sec,
           ${optional('equity_benchmark_min_excess_return', 'NULL')} AS equity_benchmark_min_excess_return,
           ${optional('equity_benchmark_all_outperforming', '0')} AS equity_benchmark_all_outperforming,
           ${optional('equity_benchmark_instance_count', '0')} AS equity_benchmark_instance_count,
           regime_min_days, regime_target_days, regime_all_instances_positive,
           ttl_candidates_total, ttl_candidates_ttl_pass, ttl_pass_rate,
           ${optional('poly_market_discovery_count', '0')} AS poly_market_discovery_count,
           ${optional('poly_market_discovery_target', '500')} AS poly_market_discovery_target,
           ${optional('poly_market_discovery_age_sec', 'NULL')} AS poly_market_discovery_age_sec,
           ${optional('poly_quality_passing_open_trades', '0')} AS poly_quality_passing_open_trades,
           ${optional('poly_quality_failing_open_trades', '0')} AS poly_quality_failing_open_trades,
           ${optional('poly_quality_missing_metadata_trades', '0')} AS poly_quality_missing_metadata_trades
      FROM readiness_evidence_snapshots
     ORDER BY captured_at DESC
     LIMIT ?
  `).all(safeLimit) as Array<{
    snapshot_ymd: string;
    captured_at: number;
    status: ReadinessStatus;
    poly_settled_trades: number;
    poly_target_settled_trades: number;
    poly_realized_pnl_usd: number;
    poly_unrealized_pnl_usd: number;
    poly_total_pnl_usd: number;
    poly_paper_equity_usd: number;
    poly_approval_rate_24h: number | null;
    poly_open_trades: number;
    poly_voided_trades: number;
    poly_potential_settled_trades: number;
    poly_additional_settled_trades_needed: number;
    poly_near_term_potential_settled_trades: number;
    poly_additional_near_term_settled_trades_needed: number;
    poly_paper_trades_opened_24h: number;
    poly_near_term_paper_trades_opened_24h: number;
    poly_daily_near_term_trade_target_30d: number;
    poly_near_term_fill_days_at_24h_rate: number | null;
    poly_due_next_7d: number;
    poly_due_next_30d: number;
    poly_overdue_open_trades: number;
    equity_sync_fresh_count: number;
    equity_sync_expected_count: number;
    equity_sync_max_age_sec: number | null;
    equity_benchmark_min_excess_return: number | null;
    equity_benchmark_all_outperforming: number;
    equity_benchmark_instance_count: number;
    regime_min_days: number;
    regime_target_days: number;
    regime_all_instances_positive: number;
    ttl_candidates_total: number;
    ttl_candidates_ttl_pass: number;
    ttl_pass_rate: number | null;
    poly_market_discovery_count: number;
    poly_market_discovery_target: number;
    poly_market_discovery_age_sec: number | null;
    poly_quality_passing_open_trades: number;
    poly_quality_failing_open_trades: number;
    poly_quality_missing_metadata_trades: number;
  }>;

  return rows.reverse().map(row => ({
    snapshotYmd: row.snapshot_ymd,
    capturedAt: row.captured_at,
    status: row.status,
    polySettledTrades: row.poly_settled_trades,
    polyTargetSettledTrades: row.poly_target_settled_trades,
    polyRealizedPnlUsd: row.poly_realized_pnl_usd,
    polyUnrealizedPnlUsd: row.poly_unrealized_pnl_usd,
    polyTotalPnlUsd: row.poly_total_pnl_usd,
    polyPaperEquityUsd: row.poly_paper_equity_usd,
    polyApprovalRate24h: row.poly_approval_rate_24h,
    polyOpenTrades: row.poly_open_trades,
    polyVoidedTrades: row.poly_voided_trades,
    polyPotentialSettledTrades: row.poly_potential_settled_trades,
    polyAdditionalSettledTradesNeeded: row.poly_additional_settled_trades_needed,
    polyNearTermPotentialSettledTrades: row.poly_near_term_potential_settled_trades,
    polyAdditionalNearTermSettledTradesNeeded: row.poly_additional_near_term_settled_trades_needed,
    polyPaperTradesOpened24h: row.poly_paper_trades_opened_24h,
    polyNearTermPaperTradesOpened24h: row.poly_near_term_paper_trades_opened_24h,
    polyDailyNearTermTradeTarget30d: row.poly_daily_near_term_trade_target_30d,
    polyNearTermFillDaysAt24hRate: row.poly_near_term_fill_days_at_24h_rate,
    polyDueNext7Days: row.poly_due_next_7d,
    polyDueNext30Days: row.poly_due_next_30d,
    polyOverdueOpenTrades: row.poly_overdue_open_trades,
    equitySyncFreshCount: row.equity_sync_fresh_count,
    equitySyncExpectedCount: row.equity_sync_expected_count,
    equitySyncMaxAgeSec: row.equity_sync_max_age_sec,
    equityBenchmarkMinExcessReturn: row.equity_benchmark_min_excess_return,
    equityBenchmarkAllOutperforming: row.equity_benchmark_all_outperforming === 1,
    equityBenchmarkInstanceCount: row.equity_benchmark_instance_count,
    regimeMinDays: row.regime_min_days,
    regimeTargetDays: row.regime_target_days,
    regimeAllInstancesPositive: row.regime_all_instances_positive === 1,
    ttlCandidatesTotal: row.ttl_candidates_total,
    ttlCandidatesTtlPass: row.ttl_candidates_ttl_pass,
    ttlPassRate: row.ttl_pass_rate,
    polyMarketDiscoveryCount: row.poly_market_discovery_count,
    polyMarketDiscoveryTarget: row.poly_market_discovery_target,
    polyMarketDiscoveryAgeSec: row.poly_market_discovery_age_sec,
    polyQualityPassingOpenTrades: row.poly_quality_passing_open_trades,
    polyQualityFailingOpenTrades: row.poly_quality_failing_open_trades,
    polyQualityMissingMetadataTrades: row.poly_quality_missing_metadata_trades,
  }));
}
