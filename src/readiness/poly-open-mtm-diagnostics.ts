import type Database from 'better-sqlite3';

import {
  POLY_MARKET_QUALITY_FILTER_ENABLED,
  POLY_MAX_MARKET_TTL_DAYS,
  POLY_MIN_MARKET_TTL_DAYS,
  POLY_TTL_FILTER_ENABLED,
} from '../config.js';
import { evaluateMarketQuality } from '../poly/market-quality.js';
import type { Market } from '../poly/types.js';

const DAY_SEC = 24 * 60 * 60;
const LOW_CONFIDENCE_HIGH_EDGE_PCT = 15;

export interface OpenMtmDiagnosticsOptions {
  nowSec?: number;
  maxItems?: number;
  ttlFilterEnabled?: boolean;
  marketQualityFilterEnabled?: boolean;
  minTtlDays?: number;
  maxTtlDays?: number;
}

export interface OpenMtmDiagnosticItem {
  tradeId: number;
  marketSlug: string;
  question: string | null;
  outcomeLabel: string | null;
  sizeUsd: number;
  unrealizedPnlUsd: number;
  openPnlPct: number | null;
  currentPrice: number | null;
  endAt: number | null;
  daysToEnd: number | null;
  filterState: 'pass' | 'exception' | 'missing_metadata';
  filterCode: string | null;
  signalConfidence: string | null;
  signalEdgePct: number | null;
}

export interface OpenMtmBucketSummary {
  code: string;
  label: string;
  count: number;
  exposureUsd: number;
  unrealizedPnlUsd: number;
  openPnlPct: number | null;
  winners: number;
  losers: number;
  flat: number;
}

export interface OpenMtmDiagnosticsSummary {
  generatedAt: number;
  openTrades: number;
  openExposureUsd: number;
  unrealizedPnlUsd: number;
  openPnlPct: number | null;
  winners: number;
  losers: number;
  flat: number;
  currentFilterExceptionTrades: number;
  currentFilterExceptionPnlUsd: number;
  due7dTrades: number;
  due7dPnlUsd: number;
  lowConfidenceHighEdgeTrades: number;
  lowConfidenceHighEdgePnlUsd: number;
  buckets: OpenMtmBucketSummary[];
  worstItems: OpenMtmDiagnosticItem[];
  schemaIssues: string[];
}

interface OpenMtmRow {
  trade_id: number;
  market_slug: string;
  outcome_label: string | null;
  size_usd: number | null;
  current_price: number | null;
  unrealized_pnl: number | null;
  market_match_slug: string | null;
  question: string | null;
  category: string | null;
  condition_id: string | null;
  outcomes_json: string | null;
  volume_24h: number | null;
  liquidity: number | null;
  end_date: number | null;
  closed: number | null;
  confidence: string | null;
  edge_pct: number | null;
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name) as { name?: string } | undefined;
  return row?.name === name;
}

function tableColumns(db: Database.Database, name: string): Set<string> {
  if (!tableExists(db, name)) return new Set();
  const rows = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>;
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

function toMarket(row: OpenMtmRow, fallbackSlug: string): Market | null {
  if (!row.market_match_slug || !row.end_date || row.end_date <= 0) return null;
  return {
    slug: row.market_match_slug,
    conditionId: row.condition_id ?? row.market_match_slug,
    question: row.question ?? fallbackSlug,
    category: row.category ?? undefined,
    outcomes: parseMarketOutcomes(row.outcomes_json),
    volume24h: row.volume_24h ?? 0,
    liquidity: row.liquidity ?? 0,
    endDate: normalizeEpochSec(row.end_date) ?? 0,
    closed: row.closed === 1,
  };
}

function isLowConfidenceHighEdge(item: OpenMtmDiagnosticItem): boolean {
  return (item.signalConfidence ?? '').toLowerCase() === 'low' &&
    (item.signalEdgePct ?? 0) >= LOW_CONFIDENCE_HIGH_EDGE_PCT;
}

function itemFromRow(
  row: OpenMtmRow,
  nowSec: number,
  options: Required<Pick<
    OpenMtmDiagnosticsOptions,
    'ttlFilterEnabled' | 'marketQualityFilterEnabled' | 'minTtlDays' | 'maxTtlDays'
  >>,
): OpenMtmDiagnosticItem {
  const sizeUsd = row.size_usd ?? 0;
  const unrealizedPnlUsd = row.unrealized_pnl ?? 0;
  const endAt = normalizeEpochSec(row.end_date);
  const market = toMarket(row, row.market_slug);
  let filterState: OpenMtmDiagnosticItem['filterState'] = 'missing_metadata';
  let filterCode: string | null = 'missing_market_metadata';

  if (market) {
    const decision = evaluateMarketQuality(market, {
      nowSec,
      ttlFilterEnabled: options.ttlFilterEnabled,
      marketQualityFilterEnabled: options.marketQualityFilterEnabled,
      minTtlDays: options.minTtlDays,
      maxTtlDays: options.maxTtlDays,
    });
    filterState = decision.passed ? 'pass' : 'exception';
    filterCode = decision.passed ? null : decision.code ?? 'current_filter_failed';
  }

  return {
    tradeId: row.trade_id,
    marketSlug: row.market_slug,
    question: row.question,
    outcomeLabel: row.outcome_label,
    sizeUsd,
    unrealizedPnlUsd,
    openPnlPct: sizeUsd > 0 ? unrealizedPnlUsd / sizeUsd : null,
    currentPrice: row.current_price,
    endAt,
    daysToEnd: endAt === null ? null : (endAt - nowSec) / DAY_SEC,
    filterState,
    filterCode,
    signalConfidence: row.confidence,
    signalEdgePct: row.edge_pct,
  };
}

function summarizeBucket(
  code: string,
  label: string,
  items: readonly OpenMtmDiagnosticItem[],
): OpenMtmBucketSummary {
  const exposureUsd = items.reduce((sum, item) => sum + item.sizeUsd, 0);
  const unrealizedPnlUsd = items.reduce((sum, item) => sum + item.unrealizedPnlUsd, 0);
  return {
    code,
    label,
    count: items.length,
    exposureUsd,
    unrealizedPnlUsd,
    openPnlPct: exposureUsd > 0 ? unrealizedPnlUsd / exposureUsd : null,
    winners: items.filter(item => item.unrealizedPnlUsd > 0).length,
    losers: items.filter(item => item.unrealizedPnlUsd < 0).length,
    flat: items.filter(item => item.unrealizedPnlUsd === 0).length,
  };
}

export function collectOpenMtmDiagnostics(
  db: Database.Database,
  options: OpenMtmDiagnosticsOptions = {},
): OpenMtmDiagnosticsSummary {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const maxItems = options.maxItems ?? 8;
  const filterOptions = {
    ttlFilterEnabled: options.ttlFilterEnabled ?? POLY_TTL_FILTER_ENABLED,
    marketQualityFilterEnabled: options.marketQualityFilterEnabled ?? POLY_MARKET_QUALITY_FILTER_ENABLED,
    minTtlDays: options.minTtlDays ?? POLY_MIN_MARKET_TTL_DAYS,
    maxTtlDays: options.maxTtlDays ?? POLY_MAX_MARKET_TTL_DAYS,
  };
  const schemaIssues: string[] = [];

  const hasTrades = tableExists(db, 'poly_paper_trades');
  const hasPositions = tableExists(db, 'poly_positions');
  const hasMarkets = tableExists(db, 'poly_markets');
  const hasSignals = tableExists(db, 'poly_signals');
  if (!hasTrades) schemaIssues.push('poly_paper_trades table missing');
  if (!hasPositions) schemaIssues.push('poly_positions table missing');
  if (!hasMarkets) schemaIssues.push('poly_markets table missing');

  if (!hasTrades) {
    return {
      generatedAt: nowSec,
      openTrades: 0,
      openExposureUsd: 0,
      unrealizedPnlUsd: 0,
      openPnlPct: null,
      winners: 0,
      losers: 0,
      flat: 0,
      currentFilterExceptionTrades: 0,
      currentFilterExceptionPnlUsd: 0,
      due7dTrades: 0,
      due7dPnlUsd: 0,
      lowConfidenceHighEdgeTrades: 0,
      lowConfidenceHighEdgePnlUsd: 0,
      buckets: [],
      worstItems: [],
      schemaIssues,
    };
  }

  const tradeCols = tableColumns(db, 'poly_paper_trades');
  const positionCols = tableColumns(db, 'poly_positions');
  const marketCols = tableColumns(db, 'poly_markets');
  const signalCols = tableColumns(db, 'poly_signals');
  const tradeIdExpr = tradeCols.has('id') ? 't.id' : 't.rowid';
  const positionJoin = hasPositions
    ? `LEFT JOIN poly_positions p ON p.paper_trade_id = ${tradeIdExpr}`
    : '';
  const marketJoin = hasMarkets
    ? 'LEFT JOIN poly_markets m ON m.slug = t.market_slug'
    : '';
  const signalJoin = hasSignals && signalCols.has('paper_trade_id')
    ? `LEFT JOIN poly_signals s ON s.id = (
         SELECT MAX(s2.id)
           FROM poly_signals s2
          WHERE s2.paper_trade_id = ${tradeIdExpr}
            AND s2.approved = 1
       )`
    : '';

  const rows = db.prepare(`
    SELECT
      ${tradeIdExpr} AS trade_id,
      t.market_slug AS market_slug,
      ${optionalColumn('t', tradeCols, 'outcome_label', 'NULL', 'outcome_label')},
      ${optionalColumn('t', tradeCols, 'size_usd', '0', 'size_usd')},
      ${optionalColumn('p', positionCols, 'current_price', 'NULL', 'current_price')},
      ${optionalColumn('p', positionCols, 'unrealized_pnl', '0', 'unrealized_pnl')},
      ${optionalColumn('m', marketCols, 'slug', 'NULL', 'market_match_slug')},
      ${optionalColumn('m', marketCols, 'question', 'NULL', 'question')},
      ${optionalColumn('m', marketCols, 'category', 'NULL', 'category')},
      ${optionalColumn('m', marketCols, 'condition_id', 'NULL', 'condition_id')},
      ${optionalColumn('m', marketCols, 'outcomes_json', 'NULL', 'outcomes_json')},
      ${optionalColumn('m', marketCols, 'volume_24h', '0', 'volume_24h')},
      ${optionalColumn('m', marketCols, 'liquidity', '0', 'liquidity')},
      ${optionalColumn('m', marketCols, 'end_date', 'NULL', 'end_date')},
      ${optionalColumn('m', marketCols, 'closed', '0', 'closed')},
      ${optionalColumn('s', signalCols, 'confidence', 'NULL', 'confidence')},
      ${optionalColumn('s', signalCols, 'edge_pct', 'NULL', 'edge_pct')}
    FROM poly_paper_trades t
    ${positionJoin}
    ${marketJoin}
    ${signalJoin}
    WHERE t.status = 'open'
    ORDER BY COALESCE(p.unrealized_pnl, 0) ASC, ${tradeIdExpr} ASC
  `).all() as OpenMtmRow[];

  const items = rows.map(row => itemFromRow(row, nowSec, filterOptions));
  const openExposureUsd = items.reduce((sum, item) => sum + item.sizeUsd, 0);
  const unrealizedPnlUsd = items.reduce((sum, item) => sum + item.unrealizedPnlUsd, 0);
  const filterExceptions = items.filter(item => item.filterState !== 'pass');
  const due7d = items.filter(item => item.daysToEnd !== null && item.daysToEnd > 0 && item.daysToEnd <= 7);
  const due8to30d = items.filter(item => item.daysToEnd !== null && item.daysToEnd > 7 && item.daysToEnd <= 30);
  const laterOrUnknown = items.filter(item => item.daysToEnd === null || item.daysToEnd > 30);
  const lowConfidenceHighEdge = items.filter(isLowConfidenceHighEdge);

  return {
    generatedAt: nowSec,
    openTrades: items.length,
    openExposureUsd,
    unrealizedPnlUsd,
    openPnlPct: openExposureUsd > 0 ? unrealizedPnlUsd / openExposureUsd : null,
    winners: items.filter(item => item.unrealizedPnlUsd > 0).length,
    losers: items.filter(item => item.unrealizedPnlUsd < 0).length,
    flat: items.filter(item => item.unrealizedPnlUsd === 0).length,
    currentFilterExceptionTrades: filterExceptions.length,
    currentFilterExceptionPnlUsd: filterExceptions.reduce((sum, item) => sum + item.unrealizedPnlUsd, 0),
    due7dTrades: due7d.length,
    due7dPnlUsd: due7d.reduce((sum, item) => sum + item.unrealizedPnlUsd, 0),
    lowConfidenceHighEdgeTrades: lowConfidenceHighEdge.length,
    lowConfidenceHighEdgePnlUsd: lowConfidenceHighEdge.reduce((sum, item) => sum + item.unrealizedPnlUsd, 0),
    buckets: [
      summarizeBucket('all_open', 'All open', items),
      summarizeBucket('due_7d', 'Due <=7d', due7d),
      summarizeBucket('due_8_30d', 'Due 8-30d', due8to30d),
      summarizeBucket('later_or_unknown', 'Later or unknown', laterOrUnknown),
      summarizeBucket('current_filter_pass', 'Pass current filters', items.filter(item => item.filterState === 'pass')),
      summarizeBucket('current_filter_exception', 'Current filter exceptions', filterExceptions),
      summarizeBucket('low_confidence_high_edge', 'Low confidence high edge', lowConfidenceHighEdge),
    ],
    worstItems: items.slice(0, Math.max(1, Math.floor(maxItems))),
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

function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
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

export function formatOpenMtmDiagnosticsReport(summary: OpenMtmDiagnosticsSummary): string {
  const lines: string[] = [
    'Polymarket Open MTM Diagnostics',
    '--------------------------------',
    `Open trades                 ${summary.openTrades}`,
    `Open exposure               ${fmtUnsignedUsd(summary.openExposureUsd)}`,
    `Unrealized P&L             ${fmtUsd(summary.unrealizedPnlUsd)} (${fmtPct(summary.openPnlPct)})`,
    `Open win/loss/flat          ${summary.winners}/${summary.losers}/${summary.flat}`,
    `Current-filter exceptions   ${summary.currentFilterExceptionTrades} (${fmtUsd(summary.currentFilterExceptionPnlUsd)})`,
    `Due <=7d drag               ${summary.due7dTrades} (${fmtUsd(summary.due7dPnlUsd)})`,
    `Low-conf high-edge drag     ${summary.lowConfidenceHighEdgeTrades} (${fmtUsd(summary.lowConfidenceHighEdgePnlUsd)})`,
  ];

  if (summary.schemaIssues.length > 0) {
    lines.push('', 'Schema warnings');
    for (const issue of summary.schemaIssues) lines.push(`WARN  ${issue}`);
  }

  if (summary.buckets.length > 0) {
    lines.push('', 'MTM buckets');
    for (const bucket of summary.buckets) {
      lines.push(
        `${bucket.label.padEnd(26)} ` +
        `${String(bucket.count).padStart(3)} ` +
        `exp=${fmtUnsignedUsd(bucket.exposureUsd).padStart(9)} ` +
        `u/r=${fmtUsd(bucket.unrealizedPnlUsd).padStart(9)} ` +
        `pnl=${fmtPct(bucket.openPnlPct).padStart(7)} ` +
        `w/l/f=${bucket.winners}/${bucket.losers}/${bucket.flat}`,
      );
    }
  }

  if (summary.worstItems.length > 0) {
    lines.push('', 'Worst open marks');
    for (const item of summary.worstItems) {
      const signal = item.signalConfidence || item.signalEdgePct !== null
        ? ` signal=${item.signalConfidence ?? '-'} edge=${item.signalEdgePct === null ? '-' : `${item.signalEdgePct.toFixed(1)}pp`}`
        : '';
      const filter = item.filterState === 'pass' ? 'pass' : item.filterCode ?? item.filterState;
      lines.push(
        `#${item.tradeId.toString().padEnd(3)} end=${fmtDate(item.endAt)} (${fmtDays(item.daysToEnd)}) ` +
        `size=${fmtUnsignedUsd(item.sizeUsd)} u/r=${fmtUsd(item.unrealizedPnlUsd)} ` +
        `pnl=${fmtPct(item.openPnlPct)} filter=${filter}${signal} ` +
        `${shortText(item.marketSlug, 62)}${item.outcomeLabel ? ` ${item.outcomeLabel}` : ''}`,
      );
      if (item.question) lines.push(`      ${shortText(item.question, 96)}`);
    }
  } else if (summary.schemaIssues.length === 0) {
    lines.push('', 'No open paper positions.');
  }

  return `${lines.join('\n')}\n`;
}
