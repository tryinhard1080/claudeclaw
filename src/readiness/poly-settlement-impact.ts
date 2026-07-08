import type Database from 'better-sqlite3';

const DAY_SEC = 24 * 60 * 60;
const SETTLED_TARGET = 50;

export interface SettlementImpactOptions {
  nowSec?: number;
  horizonDays?: number;
  maxItems?: number;
}

export interface SettlementImpactItem {
  tradeId: number;
  marketSlug: string;
  question: string | null;
  outcomeLabel: string | null;
  endAt: number | null;
  daysToEnd: number | null;
  sizeUsd: number;
  shares: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
  unrealizedPnlUsd: number;
  winPnlUsd: number | null;
  lossPnlUsd: number | null;
}

export interface SettlementImpactSummary {
  generatedAt: number;
  horizonDays: number;
  targetSettledTrades: number;
  settledTrades: number;
  dueTrades: number;
  potentialSettledAfterWindow: number;
  stillNeededAfterWindow: number;
  dueExposureUsd: number;
  dueUnrealizedPnlUsd: number;
  allHeldOutcomesWinPnlUsd: number;
  allHeldOutcomesLosePnlUsd: number;
  unknownImpactTrades: number;
  items: SettlementImpactItem[];
  schemaIssues: string[];
}

interface ImpactRow {
  trade_id: number;
  market_slug: string;
  question: string | null;
  outcome_label: string | null;
  end_at: number | null;
  size_usd: number | null;
  shares: number | null;
  entry_price: number | null;
  current_price: number | null;
  unrealized_pnl: number | null;
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

function scalar(db: Database.Database, sql: string, params: unknown[] = []): number {
  const row = db.prepare(sql).get(...params) as { value: number | null } | undefined;
  return row?.value ?? 0;
}

function normalizeEpochSec(value: number | null): number | null {
  if (!value || !Number.isFinite(value)) return null;
  return value > 20_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function realizedIfHeldOutcomeWins(shares: number | null, entryPrice: number | null): number | null {
  if (shares === null || entryPrice === null) return null;
  if (!Number.isFinite(shares) || !Number.isFinite(entryPrice)) return null;
  return shares * (1 - entryPrice);
}

function realizedIfHeldOutcomeLoses(
  shares: number | null,
  entryPrice: number | null,
  sizeUsd: number,
): number | null {
  if (shares !== null && entryPrice !== null && Number.isFinite(shares) && Number.isFinite(entryPrice)) {
    return -shares * entryPrice;
  }
  return sizeUsd > 0 ? -sizeUsd : null;
}

function toItem(row: ImpactRow, nowSec: number): SettlementImpactItem {
  const endAt = normalizeEpochSec(row.end_at);
  const sizeUsd = row.size_usd ?? 0;
  const winPnlUsd = realizedIfHeldOutcomeWins(row.shares, row.entry_price);
  const lossPnlUsd = realizedIfHeldOutcomeLoses(row.shares, row.entry_price, sizeUsd);

  return {
    tradeId: row.trade_id,
    marketSlug: row.market_slug,
    question: row.question,
    outcomeLabel: row.outcome_label,
    endAt,
    daysToEnd: endAt === null ? null : (endAt - nowSec) / DAY_SEC,
    sizeUsd,
    shares: row.shares,
    entryPrice: row.entry_price,
    currentPrice: row.current_price,
    unrealizedPnlUsd: row.unrealized_pnl ?? 0,
    winPnlUsd,
    lossPnlUsd,
  };
}

export function collectSettlementImpact(
  db: Database.Database,
  options: SettlementImpactOptions = {},
): SettlementImpactSummary {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const horizonDays = options.horizonDays ?? 7;
  const maxItems = options.maxItems ?? 12;
  const horizonSec = Math.max(1, horizonDays) * DAY_SEC;
  const schemaIssues: string[] = [];

  const hasTrades = tableExists(db, 'poly_paper_trades');
  const hasMarkets = tableExists(db, 'poly_markets');
  const hasPositions = tableExists(db, 'poly_positions');

  if (!hasTrades) schemaIssues.push('poly_paper_trades table missing');
  if (!hasMarkets) schemaIssues.push('poly_markets table missing');

  if (!hasTrades) {
    return {
      generatedAt: nowSec,
      horizonDays,
      targetSettledTrades: SETTLED_TARGET,
      settledTrades: 0,
      dueTrades: 0,
      potentialSettledAfterWindow: 0,
      stillNeededAfterWindow: SETTLED_TARGET,
      dueExposureUsd: 0,
      dueUnrealizedPnlUsd: 0,
      allHeldOutcomesWinPnlUsd: 0,
      allHeldOutcomesLosePnlUsd: 0,
      unknownImpactTrades: 0,
      items: [],
      schemaIssues,
    };
  }

  const tradeCols = tableColumns(db, 'poly_paper_trades');
  const marketCols = tableColumns(db, 'poly_markets');
  const positionCols = tableColumns(db, 'poly_positions');
  const marketJoin = hasMarkets ? 'LEFT JOIN poly_markets m ON m.slug = t.market_slug' : '';
  const positionJoin = hasPositions ? 'LEFT JOIN poly_positions p ON p.paper_trade_id = t.rowid' : '';
  const endExpr = hasMarkets && marketCols.has('end_date') ? 'm.end_date' : 'NULL';

  const rows = db.prepare(`
    SELECT
      t.rowid AS trade_id,
      t.market_slug AS market_slug,
      ${optionalColumn('m', marketCols, 'question', 'NULL', 'question')},
      ${optionalColumn('t', tradeCols, 'outcome_label', 'NULL', 'outcome_label')},
      ${endExpr} AS end_at,
      ${optionalColumn('t', tradeCols, 'size_usd', '0', 'size_usd')},
      ${optionalColumn('t', tradeCols, 'shares', 'NULL', 'shares')},
      ${optionalColumn('t', tradeCols, 'entry_price', 'NULL', 'entry_price')},
      ${optionalColumn('p', positionCols, 'current_price', 'NULL', 'current_price')},
      ${optionalColumn('p', positionCols, 'unrealized_pnl', '0', 'unrealized_pnl')}
    FROM poly_paper_trades t
    ${marketJoin}
    ${positionJoin}
    WHERE t.status = 'open'
      AND ${endExpr} > ?
      AND ${endExpr} <= ?
    ORDER BY ${endExpr} ASC, COALESCE(p.unrealized_pnl, 0) ASC, t.rowid ASC
  `).all(nowSec, nowSec + horizonSec) as ImpactRow[];

  const items = rows.map(row => toItem(row, nowSec));
  const settledTrades = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status IN ('won','lost')");
  const allHeldOutcomesWinPnlUsd = items.reduce((sum, item) => sum + (item.winPnlUsd ?? 0), 0);
  const allHeldOutcomesLosePnlUsd = items.reduce((sum, item) => sum + (item.lossPnlUsd ?? 0), 0);
  const unknownImpactTrades = items.filter(item => item.winPnlUsd === null || item.lossPnlUsd === null).length;
  const dueTrades = items.length;
  const potentialSettledAfterWindow = settledTrades + dueTrades;

  return {
    generatedAt: nowSec,
    horizonDays,
    targetSettledTrades: SETTLED_TARGET,
    settledTrades,
    dueTrades,
    potentialSettledAfterWindow,
    stillNeededAfterWindow: Math.max(0, SETTLED_TARGET - potentialSettledAfterWindow),
    dueExposureUsd: items.reduce((sum, item) => sum + item.sizeUsd, 0),
    dueUnrealizedPnlUsd: items.reduce((sum, item) => sum + item.unrealizedPnlUsd, 0),
    allHeldOutcomesWinPnlUsd,
    allHeldOutcomesLosePnlUsd,
    unknownImpactTrades,
    items: items.slice(0, Math.max(1, Math.floor(maxItems))),
    schemaIssues,
  };
}

function fmtUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function fmtUnsignedUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `$${Math.abs(value).toFixed(2)}`;
}

function fmtDate(value: number | null): string {
  return value === null ? '-' : new Date(value * 1000).toISOString().slice(0, 10);
}

function fmtDays(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  if (value < 0) return `${Math.ceil(Math.abs(value))}d overdue`;
  if (value < 1) return '<1d';
  return `${Math.ceil(value)}d`;
}

function shortText(value: string | null, limit: number): string {
  if (!value) return '-';
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

export function formatSettlementImpactReport(summary: SettlementImpactSummary): string {
  const lines: string[] = [
    'Polymarket Settlement Impact',
    '----------------------------',
    `Window                    <=${summary.horizonDays}d`,
    `Settled now               ${summary.settledTrades}/${summary.targetSettledTrades}`,
    `Due in window             ${summary.dueTrades}`,
    `Potential after window    ${summary.potentialSettledAfterWindow}/${summary.targetSettledTrades}`,
    `Still needed after window ${summary.stillNeededAfterWindow}`,
    `Due exposure              ${fmtUnsignedUsd(summary.dueExposureUsd)}`,
    `Current due unrealized    ${fmtUsd(summary.dueUnrealizedPnlUsd)}`,
    `If held outcomes win      ${fmtUsd(summary.allHeldOutcomesWinPnlUsd)}`,
    `If held outcomes lose     ${fmtUsd(summary.allHeldOutcomesLosePnlUsd)}`,
    `Unknown impact trades     ${summary.unknownImpactTrades}`,
  ];

  if (summary.schemaIssues.length > 0) {
    lines.push('', 'Schema warnings');
    for (const issue of summary.schemaIssues) lines.push(`WARN  ${issue}`);
  }

  if (summary.items.length > 0) {
    lines.push('', 'Due-window trades');
    for (const item of summary.items) {
      lines.push(
        `#${item.tradeId.toString().padEnd(3)} end=${fmtDate(item.endAt)} (${fmtDays(item.daysToEnd)}) ` +
        `size=${fmtUnsignedUsd(item.sizeUsd)} u/r=${fmtUsd(item.unrealizedPnlUsd)} ` +
        `win=${fmtUsd(item.winPnlUsd)} loss=${fmtUsd(item.lossPnlUsd)} ` +
        `${shortText(item.marketSlug, 70)}${item.outcomeLabel ? ` ${item.outcomeLabel}` : ''}`,
      );
      if (item.question) lines.push(`      ${shortText(item.question, 96)}`);
    }
  } else if (summary.schemaIssues.length === 0) {
    lines.push('', 'No open paper trades due in this window.');
  }

  return `${lines.join('\n')}\n`;
}
