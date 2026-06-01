import type Database from 'better-sqlite3';

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
  openTrades: number;
  voidedTrades: number;
  openExposureUsd: number;
  overdueOpenTrades: number;
  dueNext7Days: number;
  dueNext30Days: number;
  nearestOpenEndAt: number | null;
  latestPaperTradeAt: number | null;
  signals24h: number;
  approvedSignals24h: number;
  latestApprovedSignalAt: number | null;
  progressPct: number;
  hasMarketMaturityData: boolean;
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

export function collectPolymarketEvidence(db: Database.Database, nowSec: number): PolymarketEvidence {
  const hasTrades = tableExists(db, 'poly_paper_trades');
  const hasMarkets = tableExists(db, 'poly_markets');
  const hasSignals = tableExists(db, 'poly_signals');
  const dayAgo = nowSec - DAY_SEC;

  if (!hasTrades) {
    return {
      settledTrades: 0,
      targetSettledTrades: SETTLED_TARGET,
      realizedPnlUsd: 0,
      realizedPnlPositive: false,
      openTrades: 0,
      voidedTrades: 0,
      openExposureUsd: 0,
      overdueOpenTrades: 0,
      dueNext7Days: 0,
      dueNext30Days: 0,
      nearestOpenEndAt: null,
      latestPaperTradeAt: null,
      signals24h: 0,
      approvedSignals24h: 0,
      latestApprovedSignalAt: null,
      progressPct: 0,
      hasMarketMaturityData: hasMarkets,
    };
  }

  const settledTrades = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status IN ('won','lost')");
  const realizedPnlUsd = scalar(db, "SELECT COALESCE(SUM(realized_pnl), 0) AS value FROM poly_paper_trades WHERE status IN ('won','lost')");
  const openTrades = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status='open'");
  const voidedTrades = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status='voided'");
  const openExposureUsd = scalar(db, "SELECT COALESCE(SUM(size_usd), 0) AS value FROM poly_paper_trades WHERE status='open'");
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
  const latestApprovedSignalAt = hasSignals
    ? epoch(db, 'SELECT MAX(created_at) AS value FROM poly_signals WHERE approved=1')
    : null;

  return {
    settledTrades,
    targetSettledTrades: SETTLED_TARGET,
    realizedPnlUsd,
    realizedPnlPositive: realizedPnlUsd > 0,
    openTrades,
    voidedTrades,
    openExposureUsd,
    overdueOpenTrades,
    dueNext7Days,
    dueNext30Days,
    nearestOpenEndAt,
    latestPaperTradeAt,
    signals24h,
    approvedSignals24h,
    latestApprovedSignalAt,
    progressPct: progress(settledTrades, SETTLED_TARGET),
    hasMarketMaturityData: hasMarkets,
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
    createdAt: row.created_at,
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
