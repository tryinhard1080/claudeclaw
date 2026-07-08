import type Database from 'better-sqlite3';

export type ResolutionWatchStatus = 'pass' | 'warn' | 'fail';

export type ResolutionWatchState =
  | 'open_not_due'
  | 'due_soon'
  | 'overdue_within_grace'
  | 'overdue_beyond_grace'
  | 'closed_cache_still_open'
  | 'missing_market_row'
  | 'unknown_end_date'
  | 'schema_missing';

const DAY_SEC = 24 * 60 * 60;

export interface ResolutionWatchOptions {
  nowSec?: number;
  dueSoonDays?: number;
  nearTermDays?: number;
  overdueGraceDays?: number;
  maxItems?: number;
  maxCacheAgeSec?: number;
}

export interface ResolutionWatchItem {
  tradeId: number;
  marketSlug: string;
  question: string | null;
  outcomeLabel: string | null;
  openedAt: number | null;
  endAt: number | null;
  daysToEnd: number | null;
  cacheClosed: boolean | null;
  cacheFetchedAt: number | null;
  cacheResolvedAt: number | null;
  currentPrice: number | null;
  unrealizedPnlUsd: number | null;
  status: ResolutionWatchStatus;
  state: ResolutionWatchState;
  detail: string;
}

export interface ResolutionWatchSummary {
  status: ResolutionWatchStatus;
  generatedAt: number;
  dueSoonDays: number;
  nearTermDays: number;
  overdueGraceDays: number;
  openTrades: number;
  dueSoonTrades: number;
  dueNearTermTrades: number;
  overdueTrades: number;
  overdueBeyondGraceTrades: number;
  closedCacheStillOpenTrades: number;
  missingMarketRows: number;
  unknownEndDateTrades: number;
  maxCacheAgeSec: number;
  dueWindowTrades: number;
  dueWindowCachedTrades: number;
  dueWindowFreshCacheTrades: number;
  dueWindowStaleCacheTrades: number;
  dueWindowMissingCacheTrades: number;
  dueWindowCacheCoveragePct: number | null;
  dueWindowFreshCacheCoveragePct: number | null;
  newestDueWindowCacheFetchedAt: number | null;
  oldestDueWindowCacheFetchedAt: number | null;
  oldestDueWindowCacheAgeSec: number | null;
  items: ResolutionWatchItem[];
  schemaIssues: string[];
}

interface WatchRow {
  trade_id: number;
  market_slug: string;
  question: string | null;
  outcome_label: string | null;
  opened_at: number | null;
  end_at: number | null;
  has_market: number;
  cache_closed: number | null;
  cache_fetched_at: number | null;
  cache_resolved_at: number | null;
  current_price: number | null;
  unrealized_pnl: number | null;
}

function rank(status: ResolutionWatchStatus): number {
  return status === 'fail' ? 2 : status === 'warn' ? 1 : 0;
}

function worstStatus(statuses: readonly ResolutionWatchStatus[]): ResolutionWatchStatus {
  return statuses.reduce<ResolutionWatchStatus>(
    (worst, status) => (rank(status) > rank(worst) ? status : worst),
    'pass',
  );
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name) as { name?: string } | undefined;
  return row?.name === name;
}

function tableColumns(db: Database.Database, name: string): Set<string> {
  if (!tableExists(db, name)) return new Set();
  const rows = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
  return new Set(rows.map(row => row.name));
}

function optionalColumn(
  alias: string,
  columns: Set<string>,
  column: string,
  fallback: string,
  asName = column,
): string {
  return columns.has(column) ? `${alias}.${column} AS ${asName}` : `${fallback} AS ${asName}`;
}

function normalizeEpochSec(value: number | null): number | null {
  if (!value || !Number.isFinite(value)) return null;
  return value > 20_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function progress(current: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.max(0, Math.min(1, current / target));
}

function classifyRow(row: WatchRow, nowSec: number, dueSoonSec: number, graceSec: number): ResolutionWatchItem {
  const endAt = normalizeEpochSec(row.end_at);
  const openedAt = normalizeEpochSec(row.opened_at);
  const cacheClosed = row.cache_closed === null ? null : row.cache_closed === 1;
  const cacheFetchedAt = normalizeEpochSec(row.cache_fetched_at);
  const cacheResolvedAt = normalizeEpochSec(row.cache_resolved_at);
  const daysToEnd = endAt === null ? null : (endAt - nowSec) / DAY_SEC;

  let status: ResolutionWatchStatus = 'pass';
  let state: ResolutionWatchState = 'open_not_due';
  let detail = 'open trade is not inside the due window';

  if (row.has_market !== 1) {
    status = 'warn';
    state = 'missing_market_row';
    detail = 'open trade has no poly_markets row, so maturity cannot be checked';
  } else if (endAt === null) {
    status = 'warn';
    state = 'unknown_end_date';
    detail = 'market end_date is missing or invalid';
  } else if (cacheClosed === true) {
    status = 'fail';
    state = 'closed_cache_still_open';
    detail = 'resolution cache says market is closed but paper trade is still open';
  } else if (endAt <= nowSec - graceSec) {
    status = 'fail';
    state = 'overdue_beyond_grace';
    detail = `market ended ${Math.ceil((nowSec - endAt) / DAY_SEC)}d ago, beyond ${Math.ceil(graceSec / DAY_SEC)}d grace`;
  } else if (endAt <= nowSec) {
    status = 'warn';
    state = 'overdue_within_grace';
    detail = `market ended ${Math.max(0, Math.ceil((nowSec - endAt) / DAY_SEC))}d ago, inside grace`;
  } else if (endAt <= nowSec + dueSoonSec) {
    state = 'due_soon';
    detail = `market ends in ${Math.max(1, Math.ceil((endAt - nowSec) / DAY_SEC))}d`;
  }

  return {
    tradeId: row.trade_id,
    marketSlug: row.market_slug,
    question: row.question,
    outcomeLabel: row.outcome_label,
    openedAt,
    endAt,
    daysToEnd,
    cacheClosed,
    cacheFetchedAt,
    cacheResolvedAt,
    currentPrice: row.current_price,
    unrealizedPnlUsd: row.unrealized_pnl,
    status,
    state,
    detail,
  };
}

export function collectResolutionWatch(
  db: Database.Database,
  options: ResolutionWatchOptions = {},
): ResolutionWatchSummary {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const dueSoonDays = options.dueSoonDays ?? 7;
  const nearTermDays = options.nearTermDays ?? 30;
  const overdueGraceDays = options.overdueGraceDays ?? 2;
  const maxItems = options.maxItems ?? 20;
  const maxCacheAgeSec = Math.max(60, Math.floor(options.maxCacheAgeSec ?? 4 * 60 * 60));
  const schemaIssues: string[] = [];

  if (!tableExists(db, 'poly_paper_trades')) {
    return {
      status: 'fail',
      generatedAt: nowSec,
      dueSoonDays,
      nearTermDays,
      overdueGraceDays,
      openTrades: 0,
      dueSoonTrades: 0,
      dueNearTermTrades: 0,
      overdueTrades: 0,
      overdueBeyondGraceTrades: 0,
      closedCacheStillOpenTrades: 0,
      missingMarketRows: 0,
      unknownEndDateTrades: 0,
      maxCacheAgeSec,
      dueWindowTrades: 0,
      dueWindowCachedTrades: 0,
      dueWindowFreshCacheTrades: 0,
      dueWindowStaleCacheTrades: 0,
      dueWindowMissingCacheTrades: 0,
      dueWindowCacheCoveragePct: null,
      dueWindowFreshCacheCoveragePct: null,
      newestDueWindowCacheFetchedAt: null,
      oldestDueWindowCacheFetchedAt: null,
      oldestDueWindowCacheAgeSec: null,
      items: [],
      schemaIssues: ['poly_paper_trades table missing'],
    };
  }

  const hasMarkets = tableExists(db, 'poly_markets');
  const hasResolutions = tableExists(db, 'poly_resolutions');
  const hasPositions = tableExists(db, 'poly_positions');

  if (!hasMarkets) schemaIssues.push('poly_markets table missing');
  if (!hasResolutions) schemaIssues.push('poly_resolutions table missing');

  const tradeCols = tableColumns(db, 'poly_paper_trades');
  const marketCols = tableColumns(db, 'poly_markets');
  const resolutionCols = tableColumns(db, 'poly_resolutions');
  const positionCols = tableColumns(db, 'poly_positions');

  const marketJoin = hasMarkets ? 'LEFT JOIN poly_markets m ON m.slug = t.market_slug' : '';
  const resolutionJoin = hasResolutions ? 'LEFT JOIN poly_resolutions r ON r.slug = t.market_slug' : '';
  const positionJoin = hasPositions ? 'LEFT JOIN poly_positions p ON p.paper_trade_id = t.rowid' : '';

  const hasMarketExpr = hasMarkets ? 'CASE WHEN m.slug IS NULL THEN 0 ELSE 1 END' : '0';
  const endExpr = hasMarkets && marketCols.has('end_date') ? 'm.end_date' : 'NULL';

  const rows = db.prepare(`
    SELECT
      t.rowid AS trade_id,
      t.market_slug AS market_slug,
      ${optionalColumn('t', tradeCols, 'created_at', 'NULL', 'opened_at')},
      ${optionalColumn('t', tradeCols, 'outcome_label', 'NULL', 'outcome_label')},
      ${hasMarketExpr} AS has_market,
      ${optionalColumn('m', marketCols, 'question', 'NULL', 'question')},
      ${endExpr} AS end_at,
      ${optionalColumn('r', resolutionCols, 'closed', 'NULL', 'cache_closed')},
      ${optionalColumn('r', resolutionCols, 'fetched_at', 'NULL', 'cache_fetched_at')},
      ${optionalColumn('r', resolutionCols, 'resolved_at', 'NULL', 'cache_resolved_at')},
      ${optionalColumn('p', positionCols, 'current_price', 'NULL', 'current_price')},
      ${optionalColumn('p', positionCols, 'unrealized_pnl', 'NULL', 'unrealized_pnl')}
    FROM poly_paper_trades t
    ${marketJoin}
    ${resolutionJoin}
    ${positionJoin}
    WHERE t.status='open'
    ORDER BY
      CASE WHEN ${endExpr} IS NULL OR ${endExpr} <= 0 THEN 1 ELSE 0 END ASC,
      ${endExpr} ASC,
      t.created_at ASC
  `).all() as WatchRow[];

  const allItems = rows.map(row => classifyRow(
    row,
    nowSec,
    dueSoonDays * DAY_SEC,
    overdueGraceDays * DAY_SEC,
  ));
  const items = allItems.slice(0, maxItems);

  const openTrades = db.prepare("SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status='open'")
    .get() as { value: number };

  const dueNearTermTrades = allItems.filter(item =>
    item.endAt !== null && item.endAt > nowSec && item.endAt <= nowSec + nearTermDays * DAY_SEC
  ).length;
  const dueWindowItems = allItems.filter(item =>
    item.endAt !== null && item.endAt <= nowSec + dueSoonDays * DAY_SEC
  );
  const dueWindowCacheFetched = dueWindowItems
    .map(item => item.cacheFetchedAt)
    .filter((value): value is number => value !== null);
  const dueWindowCachedTrades = dueWindowCacheFetched.length;
  const dueWindowFreshCacheTrades = dueWindowCacheFetched.filter(at => nowSec - at <= maxCacheAgeSec).length;
  const dueWindowStaleCacheTrades = dueWindowCachedTrades - dueWindowFreshCacheTrades;
  const dueWindowMissingCacheTrades = dueWindowItems.length - dueWindowCachedTrades;
  const newestDueWindowCacheFetchedAt = dueWindowCacheFetched.length > 0
    ? Math.max(...dueWindowCacheFetched)
    : null;
  const oldestDueWindowCacheFetchedAt = dueWindowCacheFetched.length > 0
    ? Math.min(...dueWindowCacheFetched)
    : null;
  const oldestDueWindowCacheAgeSec = oldestDueWindowCacheFetchedAt === null
    ? null
    : Math.max(0, nowSec - oldestDueWindowCacheFetchedAt);
  const cacheStatus: ResolutionWatchStatus[] = dueWindowItems.length > 0 &&
    (dueWindowMissingCacheTrades > 0 || dueWindowStaleCacheTrades > 0)
    ? ['warn']
    : [];

  const statuses: ResolutionWatchStatus[] = [
    ...allItems.map(item => item.status),
    ...cacheStatus,
    ...(schemaIssues.length > 0 ? ['fail' as ResolutionWatchStatus] : []),
  ];

  return {
    status: worstStatus(statuses),
    generatedAt: nowSec,
    dueSoonDays,
    nearTermDays,
    overdueGraceDays,
    openTrades: openTrades.value,
    dueSoonTrades: allItems.filter(item => item.state === 'due_soon').length,
    dueNearTermTrades,
    overdueTrades: allItems.filter(item =>
      item.state === 'overdue_within_grace' || item.state === 'overdue_beyond_grace'
    ).length,
    overdueBeyondGraceTrades: allItems.filter(item => item.state === 'overdue_beyond_grace').length,
    closedCacheStillOpenTrades: allItems.filter(item => item.state === 'closed_cache_still_open').length,
    missingMarketRows: allItems.filter(item => item.state === 'missing_market_row').length,
    unknownEndDateTrades: allItems.filter(item => item.state === 'unknown_end_date').length,
    maxCacheAgeSec,
    dueWindowTrades: dueWindowItems.length,
    dueWindowCachedTrades,
    dueWindowFreshCacheTrades,
    dueWindowStaleCacheTrades,
    dueWindowMissingCacheTrades,
    dueWindowCacheCoveragePct: progress(dueWindowCachedTrades, dueWindowItems.length),
    dueWindowFreshCacheCoveragePct: progress(dueWindowFreshCacheTrades, dueWindowItems.length),
    newestDueWindowCacheFetchedAt,
    oldestDueWindowCacheFetchedAt,
    oldestDueWindowCacheAgeSec,
    items,
    schemaIssues,
  };
}

function fmtStatus(status: ResolutionWatchStatus): string {
  return status.toUpperCase().padEnd(4);
}

function fmtDate(at: number | null): string {
  return at === null ? '-' : new Date(at * 1000).toISOString().slice(0, 10);
}

function fmtDateTime(at: number | null): string {
  return at === null ? '-' : new Date(at * 1000).toISOString();
}

function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtAgeSec(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  if (value < 60) return `${Math.floor(value)}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

function fmtDays(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return '-';
  if (days < 0) return `${Math.ceil(Math.abs(days))}d overdue`;
  if (days < 1) return '<1d';
  return `${Math.ceil(days)}d`;
}

function shortText(value: string | null, limit: number): string {
  if (!value) return '-';
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

export function formatResolutionWatchReport(summary: ResolutionWatchSummary): string {
  const lines: string[] = [
    'Polymarket Resolution Watch',
    '---------------------------',
    `${fmtStatus(summary.status)}  Overall status`,
    '',
    `Open trades                ${summary.openTrades}`,
    `Due <=${summary.dueSoonDays}d                  ${summary.dueSoonTrades}`,
    `Due <=${summary.nearTermDays}d                 ${summary.dueNearTermTrades}`,
    `Overdue open              ${summary.overdueTrades}`,
    `Overdue beyond grace      ${summary.overdueBeyondGraceTrades}`,
    `Closed cache still open   ${summary.closedCacheStillOpenTrades}`,
    `Missing market rows       ${summary.missingMarketRows}`,
    `Unknown end dates         ${summary.unknownEndDateTrades}`,
    `Due-window cache rows     ${summary.dueWindowCachedTrades}/${summary.dueWindowTrades} (${fmtPct(summary.dueWindowCacheCoveragePct)})`,
    `Due-window fresh cache    ${summary.dueWindowFreshCacheTrades}/${summary.dueWindowTrades} <=${Math.round(summary.maxCacheAgeSec / 60)}m (${fmtPct(summary.dueWindowFreshCacheCoveragePct)})`,
    `Due-window stale/missing  ${summary.dueWindowStaleCacheTrades}/${summary.dueWindowMissingCacheTrades}`,
    `Oldest due cache fetch    ${fmtDateTime(summary.oldestDueWindowCacheFetchedAt)} (${fmtAgeSec(summary.oldestDueWindowCacheAgeSec)} ago)`,
  ];

  if (summary.schemaIssues.length > 0) {
    lines.push('', 'Schema warnings');
    for (const issue of summary.schemaIssues) lines.push(`WARN  ${issue}`);
  }

  const notable = summary.items.filter(item => item.status !== 'pass' || item.state === 'due_soon');
  if (notable.length > 0) {
    lines.push('', 'Notable open trades');
    for (const item of notable) {
      lines.push(
        `${fmtStatus(item.status)}  #${item.tradeId} ${item.state.padEnd(23)} ` +
        `end=${fmtDate(item.endAt)} (${fmtDays(item.daysToEnd)}) ` +
        `${shortText(item.marketSlug, 72)}`,
      );
      lines.push(`      ${item.detail}`);
      if (item.question) lines.push(`      ${shortText(item.question, 96)}`);
    }
  }

  if (summary.items.length === 0 && summary.schemaIssues.length === 0) {
    lines.push('', 'No open paper trades.');
  }

  return `${lines.join('\n')}\n`;
}
