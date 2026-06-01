import type Database from 'better-sqlite3';

import { POLY_PAPER_CAPITAL } from '../config.js';
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
  resolutionQueue: PolymarketResolutionQueueItem[];
}

export type PolymarketResolutionQueueState = 'overdue' | 'due_7d' | 'due_30d' | 'later' | 'unknown';

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

export interface OperationalEvidencePayload {
  generatedAt: number;
  status: ReadinessStatus;
  polymarket: PolymarketEvidence;
  regimeSharpe: RegimeSharpeEvidence;
  ttlFilter: TtlFilterEvidence;
  metrics: ReadinessEvidenceMetric[];
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
  polyDueNext7Days: number;
  polyDueNext30Days: number;
  polyOverdueOpenTrades: number;
  regimeMinDays: number;
  regimeTargetDays: number;
  regimeAllInstancesPositive: boolean;
  ttlCandidatesTotal: number;
  ttlCandidatesTtlPass: number;
  ttlPassRate: number | null;
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

const SETTLED_TARGET = 50;
const REGIME_DAYS_TARGET = 60;
const DAY_SEC = 86_400;

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

function optionalColumn(
  alias: string,
  columns: Set<string>,
  column: string,
  fallback: string,
  asName: string,
): string {
  return `${columns.has(column) ? `${alias}.${column}` : fallback} AS ${asName}`;
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

function buildMetrics(
  polymarket: PolymarketEvidence,
  regimeSharpe: RegimeSharpeEvidence,
  ttlFilter: TtlFilterEvidence,
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

  return [
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
      key: 'polymarket_signal_flow',
      name: 'Polymarket signal flow',
      status: polymarket.approvedSignals24h > 0 ? 'pass' : (polymarket.signals24h > 0 ? 'warn' : 'fail'),
      state: polymarket.approvedSignals24h > 0 ? 'approving' : (polymarket.signals24h > 0 ? 'scanning_no_approvals' : 'no_signals'),
      detail: `${polymarket.signals24h} signals and ${polymarket.approvedSignals24h} approvals in the last 24h`,
      current: polymarket.approvedSignals24h,
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
  ];
}

export function collectOperationalEvidence(
  db: Database.Database,
  nowSec = Math.floor(Date.now() / 1000),
): OperationalEvidencePayload {
  const polymarket = collectPolymarketEvidence(db, nowSec);
  const regimeSharpe = collectRegimeSharpeEvidence(db);
  const ttlFilter = collectTtlFilterEvidence(db, nowSec);
  const metrics = buildMetrics(polymarket, regimeSharpe, ttlFilter);

  return {
    generatedAt: nowSec,
    status: worstStatus(metrics),
    polymarket,
    regimeSharpe,
    ttlFilter,
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
      poly_due_next_7d              INTEGER NOT NULL,
      poly_due_next_30d             INTEGER NOT NULL,
      poly_overdue_open_trades      INTEGER NOT NULL,
      regime_min_days               INTEGER NOT NULL,
      regime_target_days            INTEGER NOT NULL,
      regime_all_instances_positive INTEGER NOT NULL,
      ttl_candidates_total          INTEGER NOT NULL,
      ttl_candidates_ttl_pass       INTEGER NOT NULL,
      ttl_pass_rate                 REAL,
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
      regime_min_days, regime_target_days, regime_all_instances_positive,
      ttl_candidates_total, ttl_candidates_ttl_pass, ttl_pass_rate,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      regime_min_days = excluded.regime_min_days,
      regime_target_days = excluded.regime_target_days,
      regime_all_instances_positive = excluded.regime_all_instances_positive,
      ttl_candidates_total = excluded.ttl_candidates_total,
      ttl_candidates_ttl_pass = excluded.ttl_candidates_ttl_pass,
      ttl_pass_rate = excluded.ttl_pass_rate,
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
    payload.regimeSharpe.minDays,
    payload.regimeSharpe.targetDays,
    payload.regimeSharpe.allInstancesPositive ? 1 : 0,
    payload.ttlFilter.candidatesTotal,
    payload.ttlFilter.candidatesTtlPass,
    payload.ttlFilter.passRate,
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
           regime_min_days, regime_target_days, regime_all_instances_positive,
           ttl_candidates_total, ttl_candidates_ttl_pass, ttl_pass_rate
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
    poly_due_next_7d: number;
    poly_due_next_30d: number;
    poly_overdue_open_trades: number;
    regime_min_days: number;
    regime_target_days: number;
    regime_all_instances_positive: number;
    ttl_candidates_total: number;
    ttl_candidates_ttl_pass: number;
    ttl_pass_rate: number | null;
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
    polyDueNext7Days: row.poly_due_next_7d,
    polyDueNext30Days: row.poly_due_next_30d,
    polyOverdueOpenTrades: row.poly_overdue_open_trades,
    regimeMinDays: row.regime_min_days,
    regimeTargetDays: row.regime_target_days,
    regimeAllInstancesPositive: row.regime_all_instances_positive === 1,
    ttlCandidatesTotal: row.ttl_candidates_total,
    ttlCandidatesTtlPass: row.ttl_candidates_ttl_pass,
    ttlPassRate: row.ttl_pass_rate,
  }));
}
