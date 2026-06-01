#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { STORE_DIR } from '../src/config.js';
import {
  collectOperationalEvidence,
  readOperationalEvidenceHistory,
  recordOperationalEvidenceSnapshot,
  type OperationalEvidenceHistoryPoint,
  type OperationalEvidencePayload,
} from '../src/readiness/evidence.js';
import type { ReadinessStatus } from '../src/readiness/gate-progress.js';

function fmtStatus(status: ReadinessStatus): string {
  return status.toUpperCase().padEnd(4);
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtUsd(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function fmtAge(nowSec: number, at: number | null): string {
  if (!at) return '-';
  const ageSec = Math.max(0, nowSec - at);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86_400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86_400)}d ago`;
}

function fmtDate(at: number | null): string {
  if (!at) return '-';
  return new Date(at * 1000).toISOString().slice(0, 10);
}

function fmtDays(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  if (value < 0) return `${Math.ceil(Math.abs(value))}d overdue`;
  if (value < 1) return '<1d';
  return `${Math.ceil(value)}d`;
}

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function printHistory(history: OperationalEvidenceHistoryPoint[]): void {
  if (history.length === 0) return;

  console.log();
  console.log('Snapshot History');
  console.log('----------------');
  for (const row of history) {
    console.log(
      `${row.snapshotYmd}  status=${row.status.toUpperCase()}  ` +
      `poly=${row.polySettledTrades}/${row.polyTargetSettledTrades}  ` +
      `pnl=${fmtUsd(row.polyTotalPnlUsd)}  ` +
      `due30=${row.polyDueNext30Days}/${row.polyOpenTrades}  ` +
      `regime=${row.regimeMinDays}/${row.regimeTargetDays}d  ` +
      `ttl=${fmtPct(row.ttlPassRate)}`,
    );
  }
}

function printEvidence(payload: OperationalEvidencePayload, history: OperationalEvidenceHistoryPoint[] = []): void {
  const { polymarket, regimeSharpe, ttlFilter } = payload;

  console.log('Operational Evidence');
  console.log('--------------------');
  console.log(`${fmtStatus(payload.status)}  Overall evidence status`);
  console.log();

  for (const metric of payload.metrics) {
    const progress = metric.current !== undefined && metric.target !== undefined
      ? ` ${metric.current}/${metric.target}`
      : '';
    const pct = metric.progressPct === null || metric.progressPct === undefined
      ? ''
      : ` (${fmtPct(metric.progressPct)})`;
    console.log(`${fmtStatus(metric.status)}  ${metric.name.padEnd(28)} ${metric.state.padEnd(22)} ${metric.detail}${progress}${pct}`);
  }

  console.log();
  console.log('Polymarket Pipeline');
  console.log('-------------------');
  console.log(`Settled / target          ${polymarket.settledTrades}/${polymarket.targetSettledTrades}`);
  console.log(`Realized P&L              ${fmtUsd(polymarket.realizedPnlUsd)}`);
  console.log(`Unrealized P&L            ${fmtUsd(polymarket.unrealizedPnlUsd)}`);
  console.log(`Total paper P&L           ${fmtUsd(polymarket.totalPnlUsd)} (${fmtPct(polymarket.paperReturnPct)})`);
  console.log(`Paper equity              ${fmtUsd(polymarket.paperEquityUsd)}`);
  console.log(`Open / voided             ${polymarket.openTrades}/${polymarket.voidedTrades}`);
  console.log(`Open exposure             ${fmtUsd(polymarket.openExposureUsd)} (${fmtPct(polymarket.openPnlPct)} open P&L)`);
  console.log(`Due next 7d / 30d         ${polymarket.dueNext7Days}/${polymarket.dueNext30Days}`);
  console.log(`Overdue open              ${polymarket.overdueOpenTrades}`);
  console.log(`Nearest open end date     ${fmtDate(polymarket.nearestOpenEndAt)}`);
  console.log(`Latest paper trade        ${fmtAge(payload.generatedAt, polymarket.latestPaperTradeAt)}`);
  console.log(`Signals / approvals 24h   ${polymarket.signals24h}/${polymarket.approvedSignals24h} (${fmtPct(polymarket.approvalRate24h)})`);

  console.log();
  console.log('Resolution Queue');
  console.log('----------------');
  if (polymarket.resolutionQueue.length === 0) {
    console.log('No open paper trades with resolution metadata');
  } else {
    for (const row of polymarket.resolutionQueue.slice(0, 10)) {
      const label = row.outcomeLabel ? ` ${row.outcomeLabel}` : '';
      console.log(
        `#${row.tradeId.toString().padEnd(3)} ${row.state.padEnd(8)} ` +
        `${fmtDate(row.endAt)} (${fmtDays(row.daysToEnd)}) ` +
        `${fmtUsd(row.sizeUsd).padStart(8)} ${fmtUsd(row.unrealizedPnlUsd).padStart(8)} ` +
        `${row.marketSlug}${label}`,
      );
    }
  }

  console.log();
  console.log('Equity Regime Evidence');
  console.log('----------------------');
  if (regimeSharpe.instances.length === 0) {
    console.log('No regime Sharpe snapshots');
  } else {
    for (const row of regimeSharpe.instances) {
      console.log(`${row.instance.padEnd(18)} ${row.nDays}/${regimeSharpe.targetDays}d  sharpe=${row.rollingSharpe60d?.toFixed(2) ?? 'n/a'}  snapshot=${fmtAge(payload.generatedAt, row.createdAt)}`);
    }
  }

  console.log();
  console.log('TTL Filter Evidence');
  console.log('-------------------');
  if (ttlFilter.latestAt === null) {
    console.log('No TTL shadow ticks');
  } else {
    console.log(`Latest tick               ${fmtAge(payload.generatedAt, ttlFilter.latestAt)}`);
    console.log(`Band days                 ${ttlFilter.bandMinDays ?? '-'}-${ttlFilter.bandMaxDays ?? '-'}`);
    console.log(`Candidates pass / total   ${ttlFilter.candidatesTtlPass}/${ttlFilter.candidatesTotal} (${fmtPct(ttlFilter.passRate)})`);
    console.log(`Avg TTL pass / filtered   ${ttlFilter.avgTtlPass?.toFixed(1) ?? '-'}/${ttlFilter.avgTtlFiltered?.toFixed(1) ?? '-'} days`);
  }

  printHistory(history);
}

export function main(): number {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const shouldRecord = hasArg('--record');
  const historyArg = argValue('--history');
  const historyLimit = historyArg ? Math.max(1, Math.min(365, Number(historyArg) || 14)) : 0;
  const db = new Database(dbPath, { readonly: !shouldRecord, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    if (shouldRecord) db.pragma('journal_mode = WAL');
    const payload = collectOperationalEvidence(db);
    if (shouldRecord) {
      const ymd = recordOperationalEvidenceSnapshot(db, payload);
      console.log(`Recorded readiness evidence snapshot: ${ymd}`);
      console.log();
    }
    const history = historyLimit > 0 ? readOperationalEvidenceHistory(db, historyLimit) : [];
    printEvidence(payload, history);
    return 0;
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error('Operational evidence failed:', error);
    process.exitCode = 1;
  }
}
