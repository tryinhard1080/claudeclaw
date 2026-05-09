#!/usr/bin/env tsx
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import {
  POLY_EXIT_ENABLED,
  POLY_EXPOSURE_AWARE_SIZING,
  POLY_SCAN_INTERVAL_MIN,
  STORE_DIR,
} from '../src/config.js';
import { getDailyRealizedPnl } from '../src/poly/pnl-tracker.js';

export type PaperReadinessStatus = 'pass' | 'warn' | 'fail';

export interface PaperReadinessCheck {
  name: string;
  status: PaperReadinessStatus;
  state: string;
  detail: string;
}

export interface ScanRunRow {
  started_at: number;
  duration_ms: number | null;
  market_count: number | null;
  status: string;
  error: string | null;
}

function rank(status: PaperReadinessStatus): number {
  return status === 'fail' ? 2 : status === 'warn' ? 1 : 0;
}

export function classifyRecentScanHealth(
  rows: ScanRunRow[],
  nowSec: number,
  intervalMin: number,
): PaperReadinessCheck {
  const latestOk = [...rows]
    .filter(row => row.status === 'ok')
    .sort((a, b) => b.started_at - a.started_at)[0];

  if (!latestOk) {
    return {
      name: 'Recent scan',
      status: 'fail',
      state: 'missing_success',
      detail: 'no successful poly_scan_runs row found',
    };
  }

  const ageSec = nowSec - latestOk.started_at;
  const maxAgeSec = intervalMin * 2 * 60;
  if (ageSec <= maxAgeSec) {
    return {
      name: 'Recent scan',
      status: 'pass',
      state: 'fresh',
      detail: `${Math.round(ageSec / 60)}m old; markets=${latestOk.market_count ?? 'unknown'}`,
    };
  }

  return {
    name: 'Recent scan',
    status: 'fail',
    state: 'stale',
    detail: `${Math.round(ageSec / 60)}m old; threshold=${intervalMin * 2}m`,
  };
}

export function classifyOpenPaperPositions(openCount: number): PaperReadinessCheck {
  if (openCount > 0) {
    return {
      name: 'Open paper positions',
      status: 'pass',
      state: 'positions_open',
      detail: `${openCount} open`,
    };
  }
  return {
    name: 'Open paper positions',
    status: 'warn',
    state: 'none_open',
    detail: 'paper observation has not opened a position yet',
  };
}

export function classifyHaltFlag(value: string | null | undefined): PaperReadinessCheck {
  if (value === '1') {
    return {
      name: 'Halt flag',
      status: 'fail',
      state: 'halted',
      detail: "poly_kv['poly.halt'] is 1",
    };
  }
  return {
    name: 'Halt flag',
    status: 'pass',
    state: 'clear',
    detail: value === undefined || value === null ? 'not set; treated as clear' : `value=${value}`,
  };
}

export function classifyAdvancedPaperFlag(name: string, enabled: boolean): PaperReadinessCheck {
  return {
    name,
    status: enabled ? 'warn' : 'pass',
    state: enabled ? 'enabled' : 'disabled',
    detail: enabled ? 'advanced paper feature is active; confirm acceptance gates' : 'baseline-safe default',
  };
}

function worstStatus(checks: readonly PaperReadinessCheck[]): PaperReadinessStatus {
  return checks.reduce<PaperReadinessStatus>((worst, check) => (
    rank(check.status) > rank(worst) ? check.status : worst
  ), 'pass');
}

function fmtStatus(status: PaperReadinessStatus): string {
  return status.toUpperCase().padEnd(4);
}

function scalar(db: Database.Database, sql: string, fallback = 0): number {
  try {
    const row = db.prepare(sql).get() as { value: number | null } | undefined;
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

function readHaltFlag(db: Database.Database): string | null {
  try {
    const row = db.prepare("SELECT value FROM poly_kv WHERE key='poly.halt'").get() as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function latestCapturedCount(db: Database.Database): number {
  try {
    const latest = db.prepare('SELECT MAX(captured_at) AS value FROM poly_price_history').get() as { value: number | null };
    if (!latest.value) return 0;
    return scalar(db, `SELECT COUNT(*) AS value FROM poly_price_history WHERE captured_at=${Number(latest.value)}`);
  } catch {
    return 0;
  }
}

function print(checks: PaperReadinessCheck[], facts: Record<string, string | number>): void {
  console.log('Polymarket Paper Readiness');
  console.log('--------------------------');
  for (const [key, value] of Object.entries(facts)) {
    console.log(`${key.padEnd(28)} ${value}`);
  }
  console.log();
  for (const check of checks) {
    console.log(`${fmtStatus(check.status)}  ${check.name.padEnd(28)} ${check.state.padEnd(18)} ${check.detail}`);
  }
}

function main(): void {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const nowSec = Math.floor(Date.now() / 1000);
    const dayAgo = nowSec - 24 * 60 * 60;
    const rows = db
      .prepare('SELECT started_at, duration_ms, market_count, status, error FROM poly_scan_runs ORDER BY started_at DESC LIMIT 10')
      .all() as ScanRunRow[];
    const openPositions = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status='open'");
    const signalCount = scalar(db, `SELECT COUNT(*) AS value FROM poly_signals WHERE created_at >= ${dayAgo}`);
    const approvedCount = scalar(db, `SELECT COUNT(*) AS value FROM poly_signals WHERE created_at >= ${dayAgo} AND approved=1`);
    const latestMarketCount = rows.find(row => row.status === 'ok')?.market_count ?? 0;
    const capturedCount = latestCapturedCount(db);
    const todayPnl = getDailyRealizedPnl(db);
    const haltFlag = readHaltFlag(db);

    const checks = [
      classifyRecentScanHealth(rows, nowSec, POLY_SCAN_INTERVAL_MIN),
      classifyOpenPaperPositions(openPositions),
      classifyHaltFlag(haltFlag),
      classifyAdvancedPaperFlag('POLY_EXIT_ENABLED', POLY_EXIT_ENABLED),
      classifyAdvancedPaperFlag('POLY_EXPOSURE_AWARE_SIZING', POLY_EXPOSURE_AWARE_SIZING),
    ];

    print(checks, {
      'DB': dbPath,
      'Latest market count': latestMarketCount,
      'Latest captured prices': capturedCount,
      'Signals last 24h': signalCount,
      'Approved last 24h': approvedCount,
      'Open paper positions': openPositions,
      'Realized P&L today': todayPnl.toFixed(2),
      'Halt flag': haltFlag ?? '(clear)',
    });

    if (worstStatus(checks) === 'fail') process.exitCode = 1;
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
