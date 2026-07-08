import type Database from 'better-sqlite3';

import {
  brierByRegime,
  brierScore,
  calibrationCurve,
  logLoss,
  type CurveBucket,
  type RegimeBrier,
  type ResolvedSample,
} from '../poly/calibration.js';
import type { ReadinessStatus } from './gate-progress.js';

const DAY_SEC = 24 * 60 * 60;
const SETTLED_TARGET = 50;

export type SettledCalibrationState =
  | 'schema_issue'
  | 'waiting_for_settlements'
  | 'sample_incomplete'
  | 'calibration_link_incomplete'
  | 'realized_pnl_not_positive'
  | 'box2_ready_for_review';

export interface SettledCalibrationOptions {
  nowSec?: number;
  lookbackDays?: number | null;
  targetSettledTrades?: number;
  maxBuckets?: number;
}

export interface SettledCalibrationBucket extends CurveBucket {
  label: string;
}

export interface SettledCalibrationSummary {
  generatedAt: number;
  windowStart: number | null;
  windowEnd: number;
  windowLabel: string;
  targetSettledTrades: number;
  settledTrades: number;
  wonTrades: number;
  lostTrades: number;
  voidedTrades: number;
  exitedTrades: number;
  openTrades: number;
  realizedPnlUsd: number;
  realizedPnlPositive: boolean;
  settledStakeUsd: number;
  settledRoiPct: number | null;
  avgRealizedPnlUsd: number | null;
  calibrationSamples: number;
  missingCalibrationSamples: number;
  winRate: number | null;
  brierScore: number | null;
  logLoss: number | null;
  avgEdgePct: number | null;
  populatedBuckets: SettledCalibrationBucket[];
  brierByRegime: RegimeBrier[];
  status: ReadinessStatus;
  state: SettledCalibrationState;
  verdict: string;
  schemaIssues: string[];
}

interface StatusRow {
  status: string;
  n: number;
  realized: number | null;
  stake: number | null;
}

interface CalibrationRow {
  estimated_prob: number | null;
  edge_pct: number | null;
  status: string;
  regime_label: string | null;
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

function scalar(db: Database.Database, sql: string, params: unknown[] = []): number {
  const row = db.prepare(sql).get(...params) as { value: number | null } | undefined;
  return row?.value ?? 0;
}

function statusCount(rows: readonly StatusRow[], status: string): number {
  return rows.find(row => row.status === status)?.n ?? 0;
}

function statusSum(rows: readonly StatusRow[], status: string, key: 'realized' | 'stake'): number {
  return rows.find(row => row.status === status)?.[key] ?? 0;
}

function windowLabel(lookbackDays: number | null | undefined): string {
  return lookbackDays && lookbackDays > 0 ? `last ${lookbackDays}d` : 'all-time';
}

function collectCalibrationRows(
  db: Database.Database,
  tradeCols: Set<string>,
  signalCols: Set<string>,
  nowSec: number,
  lookbackDays: number | null | undefined,
  schemaIssues: string[],
): CalibrationRow[] {
  if (!tableExists(db, 'poly_signals')) {
    schemaIssues.push('poly_signals table missing; calibration samples unavailable');
    return [];
  }
  const requiredSignalCols = ['paper_trade_id', 'estimated_prob'];
  for (const column of requiredSignalCols) {
    if (!signalCols.has(column)) {
      schemaIssues.push(`poly_signals.${column} missing; calibration samples unavailable`);
      return [];
    }
  }
  if (lookbackDays && lookbackDays > 0 && !tradeCols.has('resolved_at')) {
    schemaIssues.push('poly_paper_trades.resolved_at missing; lookback window cannot be applied');
    return [];
  }

  const tradeIdExpr = tradeCols.has('id') ? 't.id' : 't.rowid';
  const regimeExpr = signalCols.has('regime_label') ? 's.regime_label' : 'NULL';
  const edgeExpr = signalCols.has('edge_pct') ? 's.edge_pct' : 'NULL';
  const windowStart = lookbackDays && lookbackDays > 0 ? nowSec - lookbackDays * DAY_SEC : null;
  const whereWindow = windowStart === null ? '' : 'AND t.resolved_at >= ? AND t.resolved_at <= ?';
  const params = windowStart === null ? [] : [windowStart, nowSec];

  return db.prepare(`
    SELECT s.estimated_prob, ${edgeExpr} AS edge_pct, t.status, ${regimeExpr} AS regime_label
      FROM poly_paper_trades t
      INNER JOIN poly_signals s ON s.paper_trade_id = ${tradeIdExpr}
     WHERE t.status IN ('won','lost')
       ${whereWindow}
  `).all(...params) as CalibrationRow[];
}

function toResolvedSamples(rows: readonly CalibrationRow[]): ResolvedSample[] {
  return rows
    .filter(row => row.estimated_prob !== null && Number.isFinite(row.estimated_prob))
    .map(row => ({
      estimatedProb: Math.max(0, Math.min(1, row.estimated_prob ?? 0)),
      outcome: row.status === 'won' ? 1 : 0,
      regimeLabel: row.regime_label ?? null,
    }));
}

function avg(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeState(args: {
  schemaIssues: readonly string[];
  settledTrades: number;
  targetSettledTrades: number;
  realizedPnlPositive: boolean;
  calibrationSamples: number;
  missingCalibrationSamples: number;
}): { status: ReadinessStatus; state: SettledCalibrationState; verdict: string } {
  if (args.schemaIssues.some(issue => !issue.includes('calibration samples unavailable'))) {
    return {
      status: 'fail',
      state: 'schema_issue',
      verdict: 'Schema issue blocks settled calibration evidence.',
    };
  }
  if (args.settledTrades === 0) {
    return {
      status: 'warn',
      state: 'waiting_for_settlements',
      verdict: 'Not a Box 2 pass: no won/lost paper trades have settled yet.',
    };
  }
  if (args.settledTrades < args.targetSettledTrades) {
    return {
      status: 'warn',
      state: 'sample_incomplete',
      verdict: `Not a Box 2 pass: ${args.targetSettledTrades - args.settledTrades} more won/lost settlements needed.`,
    };
  }
  if (args.missingCalibrationSamples > 0 || args.calibrationSamples < args.settledTrades) {
    return {
      status: 'warn',
      state: 'calibration_link_incomplete',
      verdict: 'Not a Box 2 pass: settled trades are missing linked probability samples.',
    };
  }
  if (!args.realizedPnlPositive) {
    return {
      status: 'warn',
      state: 'realized_pnl_not_positive',
      verdict: 'Not a Box 2 pass: settled sample exists but realized P&L is not positive.',
    };
  }
  return {
    status: 'pass',
    state: 'box2_ready_for_review',
    verdict: 'Box 2 evidence is ready for operator review: sample, realized P&L, and calibration links pass.',
  };
}

export function collectSettledCalibration(
  db: Database.Database,
  options: SettledCalibrationOptions = {},
): SettledCalibrationSummary {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const targetSettledTrades = options.targetSettledTrades ?? SETTLED_TARGET;
  const lookbackDays = options.lookbackDays ?? null;
  const maxBuckets = Math.max(1, Math.floor(options.maxBuckets ?? 10));
  const schemaIssues: string[] = [];

  if (!tableExists(db, 'poly_paper_trades')) {
    return {
      generatedAt: nowSec,
      windowStart: lookbackDays && lookbackDays > 0 ? nowSec - lookbackDays * DAY_SEC : null,
      windowEnd: nowSec,
      windowLabel: windowLabel(lookbackDays),
      targetSettledTrades,
      settledTrades: 0,
      wonTrades: 0,
      lostTrades: 0,
      voidedTrades: 0,
      exitedTrades: 0,
      openTrades: 0,
      realizedPnlUsd: 0,
      realizedPnlPositive: false,
      settledStakeUsd: 0,
      settledRoiPct: null,
      avgRealizedPnlUsd: null,
      calibrationSamples: 0,
      missingCalibrationSamples: 0,
      winRate: null,
      brierScore: null,
      logLoss: null,
      avgEdgePct: null,
      populatedBuckets: [],
      brierByRegime: [],
      status: 'fail',
      state: 'schema_issue',
      verdict: 'Schema issue blocks settled calibration evidence.',
      schemaIssues: ['poly_paper_trades table missing'],
    };
  }

  const tradeCols = tableColumns(db, 'poly_paper_trades');
  const signalCols = tableColumns(db, 'poly_signals');
  const realizedExpr = tradeCols.has('realized_pnl') ? 'COALESCE(SUM(realized_pnl), 0)' : '0';
  const stakeExpr = tradeCols.has('size_usd') ? 'COALESCE(SUM(size_usd), 0)' : '0';
  if (!tradeCols.has('realized_pnl')) schemaIssues.push('poly_paper_trades.realized_pnl missing');
  if (!tradeCols.has('size_usd')) schemaIssues.push('poly_paper_trades.size_usd missing');

  const rows = db.prepare(`
    SELECT status, COUNT(*) AS n, ${realizedExpr} AS realized, ${stakeExpr} AS stake
      FROM poly_paper_trades
     GROUP BY status
  `).all() as StatusRow[];

  const wonTrades = statusCount(rows, 'won');
  const lostTrades = statusCount(rows, 'lost');
  const settledTrades = wonTrades + lostTrades;
  const voidedTrades = statusCount(rows, 'voided');
  const exitedTrades = statusCount(rows, 'exited');
  const openTrades = statusCount(rows, 'open');
  const realizedPnlUsd = statusSum(rows, 'won', 'realized') + statusSum(rows, 'lost', 'realized');
  const settledStakeUsd = statusSum(rows, 'won', 'stake') + statusSum(rows, 'lost', 'stake');

  const calibrationRows = collectCalibrationRows(db, tradeCols, signalCols, nowSec, lookbackDays, schemaIssues);
  const samples = toResolvedSamples(calibrationRows);
  const calibrationSamples = samples.length;
  const missingCalibrationSamples = Math.max(0, settledTrades - calibrationSamples);
  const populatedBuckets = calibrationCurve(samples)
    .filter(bucket => bucket.count > 0)
    .slice(0, maxBuckets)
    .map(bucket => ({
      ...bucket,
      label: `${Math.round(bucket.predLow * 100)}-${Math.round(bucket.predHigh * 100)}%`,
    }));

  const state = summarizeState({
    schemaIssues,
    settledTrades,
    targetSettledTrades,
    realizedPnlPositive: realizedPnlUsd > 0,
    calibrationSamples,
    missingCalibrationSamples,
  });

  return {
    generatedAt: nowSec,
    windowStart: lookbackDays && lookbackDays > 0 ? nowSec - lookbackDays * DAY_SEC : null,
    windowEnd: nowSec,
    windowLabel: windowLabel(lookbackDays),
    targetSettledTrades,
    settledTrades,
    wonTrades,
    lostTrades,
    voidedTrades,
    exitedTrades,
    openTrades,
    realizedPnlUsd,
    realizedPnlPositive: realizedPnlUsd > 0,
    settledStakeUsd,
    settledRoiPct: settledStakeUsd > 0 ? realizedPnlUsd / settledStakeUsd : null,
    avgRealizedPnlUsd: settledTrades > 0 ? realizedPnlUsd / settledTrades : null,
    calibrationSamples,
    missingCalibrationSamples,
    winRate: calibrationSamples > 0
      ? samples.filter(sample => sample.outcome === 1).length / calibrationSamples
      : null,
    brierScore: brierScore(samples),
    logLoss: logLoss(samples),
    avgEdgePct: avg(calibrationRows
      .map(row => row.edge_pct)
      .filter((value): value is number => value !== null && Number.isFinite(value))),
    populatedBuckets,
    brierByRegime: brierByRegime(samples),
    status: state.status,
    state: state.state,
    verdict: state.verdict,
    schemaIssues,
  };
}

function fmtUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtScore(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '-' : value.toFixed(4);
}

export function formatSettledCalibrationReport(summary: SettledCalibrationSummary): string {
  const lines: string[] = [
    'Polymarket Settled Calibration',
    '--------------------------------',
    `Status                    ${summary.status.toUpperCase()} ${summary.state}`,
    `Window                    ${summary.windowLabel}`,
    `Settled / target          ${summary.settledTrades}/${summary.targetSettledTrades}`,
    `Won / lost                ${summary.wonTrades}/${summary.lostTrades}`,
    `Open / voided / exited    ${summary.openTrades}/${summary.voidedTrades}/${summary.exitedTrades}`,
    `Realized P&L              ${fmtUsd(summary.realizedPnlUsd)}`,
    `Settled stake             ${fmtUsd(summary.settledStakeUsd)}`,
    `Settled ROI               ${fmtPct(summary.settledRoiPct)}`,
    `Avg realized / settled    ${fmtUsd(summary.avgRealizedPnlUsd)}`,
    `Calibration samples       ${summary.calibrationSamples}`,
    `Missing sample links      ${summary.missingCalibrationSamples}`,
    `Win rate                  ${fmtPct(summary.winRate)}`,
    `Brier score               ${fmtScore(summary.brierScore)}`,
    `Log loss                  ${fmtScore(summary.logLoss)}`,
    `Avg approved edge         ${summary.avgEdgePct === null ? '-' : `${summary.avgEdgePct.toFixed(1)}pp`}`,
    `Verdict                   ${summary.verdict}`,
  ];

  if (summary.schemaIssues.length > 0) {
    lines.push('', 'Schema warnings');
    for (const issue of summary.schemaIssues) lines.push(`WARN  ${issue}`);
  }

  if (summary.populatedBuckets.length > 0) {
    lines.push('', 'Calibration curve buckets');
    for (const bucket of summary.populatedBuckets) {
      lines.push(
        `${bucket.label.padEnd(8)} n=${String(bucket.count).padStart(3)} ` +
        `actual=${fmtPct(bucket.actualWinRate)}`,
      );
    }
  }

  if (summary.brierByRegime.length > 0) {
    lines.push('', 'Brier by regime');
    for (const row of summary.brierByRegime.slice(0, 5)) {
      lines.push(`${row.regime.padEnd(18)} n=${String(row.nSamples).padStart(3)} brier=${fmtScore(row.brierScore)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
