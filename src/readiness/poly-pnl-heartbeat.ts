import type Database from 'better-sqlite3';

import type { ReadinessStatus } from './gate-progress.js';

const DEFAULT_MAX_AGE_SEC = 2 * 60 * 60;

export interface PnlHeartbeatOptions {
  nowSec?: number;
  maxAgeSec?: number;
}

export interface PnlHeartbeatSummary {
  generatedAt: number;
  status: ReadinessStatus;
  state: 'fresh' | 'no_open_positions' | 'stale_positions' | 'missing_positions' | 'missing_heartbeat' | 'schema_issue';
  maxAgeSec: number;
  openTrades: number;
  positionRows: number;
  freshPositionRows: number;
  stalePositionRows: number;
  missingPositionRows: number;
  newestPositionUpdatedAt: number | null;
  oldestPositionUpdatedAt: number | null;
  newestPositionAgeSec: number | null;
  oldestPositionAgeSec: number | null;
  schemaIssues: string[];
}

interface PositionHeartbeatRow {
  trade_id: number;
  updated_at: number | null;
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

function normalizeEpochSec(value: number | null): number | null {
  if (!value || !Number.isFinite(value)) return null;
  return value > 20_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function emptySummary(
  nowSec: number,
  maxAgeSec: number,
  state: PnlHeartbeatSummary['state'],
  status: ReadinessStatus,
  schemaIssues: string[] = [],
): PnlHeartbeatSummary {
  return {
    generatedAt: nowSec,
    status,
    state,
    maxAgeSec,
    openTrades: 0,
    positionRows: 0,
    freshPositionRows: 0,
    stalePositionRows: 0,
    missingPositionRows: 0,
    newestPositionUpdatedAt: null,
    oldestPositionUpdatedAt: null,
    newestPositionAgeSec: null,
    oldestPositionAgeSec: null,
    schemaIssues,
  };
}

export function collectPnlHeartbeat(
  db: Database.Database,
  options: PnlHeartbeatOptions = {},
): PnlHeartbeatSummary {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const maxAgeSec = Math.max(60, Math.floor(options.maxAgeSec ?? DEFAULT_MAX_AGE_SEC));
  const schemaIssues: string[] = [];
  const hasTrades = tableExists(db, 'poly_paper_trades');
  const hasPositions = tableExists(db, 'poly_positions');

  if (!hasTrades) schemaIssues.push('poly_paper_trades table missing');
  if (!hasPositions) schemaIssues.push('poly_positions table missing');
  if (schemaIssues.length > 0) {
    return emptySummary(nowSec, maxAgeSec, 'schema_issue', 'fail', schemaIssues);
  }

  const tradeCols = tableColumns(db, 'poly_paper_trades');
  const positionCols = tableColumns(db, 'poly_positions');
  const tradeIdExpr = tradeCols.has('id') ? 't.id' : 't.rowid';
  const positionUpdatedExpr = positionCols.has('updated_at') ? 'p.updated_at' : 'NULL';
  if (!positionCols.has('updated_at')) schemaIssues.push('poly_positions.updated_at missing');

  const rows = db.prepare(`
    SELECT
      ${tradeIdExpr} AS trade_id,
      ${positionUpdatedExpr} AS updated_at
    FROM poly_paper_trades t
      LEFT JOIN poly_positions p ON p.paper_trade_id = ${tradeIdExpr}
    WHERE t.status = 'open'
    ORDER BY ${tradeIdExpr} ASC
  `).all() as PositionHeartbeatRow[];

  if (schemaIssues.length > 0) {
    return {
      ...emptySummary(nowSec, maxAgeSec, 'schema_issue', 'fail', schemaIssues),
      openTrades: rows.length,
    };
  }

  if (rows.length === 0) {
    return emptySummary(nowSec, maxAgeSec, 'no_open_positions', 'pass');
  }

  const ages = rows.map(row => ({
    tradeId: row.trade_id,
    updatedAt: normalizeEpochSec(row.updated_at),
  }));
  const marked = ages.filter(row => row.updatedAt !== null);
  const missingPositionRows = rows.length - marked.length;
  const stalePositionRows = marked.filter(row => nowSec - row.updatedAt! > maxAgeSec).length;
  const freshPositionRows = marked.length - stalePositionRows;
  const updatedAtValues = marked.map(row => row.updatedAt!);
  const newestPositionUpdatedAt = updatedAtValues.length > 0 ? Math.max(...updatedAtValues) : null;
  const oldestPositionUpdatedAt = updatedAtValues.length > 0 ? Math.min(...updatedAtValues) : null;

  let state: PnlHeartbeatSummary['state'] = 'fresh';
  let status: ReadinessStatus = 'pass';
  if (marked.length === 0) {
    state = 'missing_heartbeat';
    status = 'fail';
  } else if (missingPositionRows > 0) {
    state = 'missing_positions';
    status = 'warn';
  } else if (stalePositionRows > 0) {
    state = 'stale_positions';
    status = 'warn';
  }

  return {
    generatedAt: nowSec,
    status,
    state,
    maxAgeSec,
    openTrades: rows.length,
    positionRows: marked.length,
    freshPositionRows,
    stalePositionRows,
    missingPositionRows,
    newestPositionUpdatedAt,
    oldestPositionUpdatedAt,
    newestPositionAgeSec: newestPositionUpdatedAt === null ? null : Math.max(0, nowSec - newestPositionUpdatedAt),
    oldestPositionAgeSec: oldestPositionUpdatedAt === null ? null : Math.max(0, nowSec - oldestPositionUpdatedAt),
    schemaIssues,
  };
}

function fmtDateTime(value: number | null): string {
  return value === null ? '-' : new Date(value * 1000).toISOString();
}

function fmtAge(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  if (value < 60) return '<1m';
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

export function formatPnlHeartbeatReport(summary: PnlHeartbeatSummary): string {
  const maxAgeMin = Math.round(summary.maxAgeSec / 60);
  const lines = [
    'Polymarket P&L Heartbeat',
    '------------------------',
    `Status                    ${summary.status.toUpperCase()} ${summary.state}`,
    `Open trades               ${summary.openTrades}`,
    `Position rows             ${summary.positionRows}/${summary.openTrades}`,
    `Fresh positions <=${maxAgeMin}m  ${summary.freshPositionRows}/${summary.openTrades}`,
    `Stale / missing positions ${summary.stalePositionRows}/${summary.missingPositionRows}`,
    `Latest mark               ${fmtDateTime(summary.newestPositionUpdatedAt)} (${fmtAge(summary.newestPositionAgeSec)} ago)`,
    `Oldest mark               ${fmtDateTime(summary.oldestPositionUpdatedAt)} (${fmtAge(summary.oldestPositionAgeSec)} ago)`,
  ];

  if (summary.schemaIssues.length > 0) {
    lines.push('', 'Schema warnings');
    for (const issue of summary.schemaIssues) lines.push(`FAIL  ${issue}`);
  }

  return `${lines.join('\n')}\n`;
}
