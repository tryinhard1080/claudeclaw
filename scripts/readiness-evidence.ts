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

function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtSignedPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(digits)}%`;
}

function fmtUsd(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function fmtWorstOpenTrade(attribution: OperationalEvidencePayload['polymarket']['openPnlAttribution']): string {
  if (attribution.worstOpenTradeId === null || attribution.worstOpenTradePnlUsd === null) return '-';
  const slug = attribution.worstOpenTradeSlug ?? '-';
  const shortSlug = slug.length > 88 ? `${slug.slice(0, 85)}...` : slug;
  return `#${attribution.worstOpenTradeId} ${fmtUsd(attribution.worstOpenTradePnlUsd)} ` +
    `(${fmtPct(attribution.worstOpenTradePnlPct)}) ${shortSlug}`;
}

function fmtAge(nowSec: number, at: number | null): string {
  if (!at) return '-';
  const ageSec = Math.max(0, nowSec - at);
  return `${fmtDuration(ageSec)} ago`;
}

function fmtDuration(ageSec: number | null): string {
  if (ageSec === null || ageSec === undefined) return '-';
  if (ageSec < 60) return `${ageSec}s`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m`;
  if (ageSec < 86_400) return `${Math.floor(ageSec / 3600)}h`;
  return `${Math.floor(ageSec / 86_400)}d`;
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

function fmtEta(nowSec: number, at: number | null): string {
  if (!at) return '-';
  return `${fmtDate(at)} (${fmtDays((at - nowSec) / 86_400)})`;
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
      `potential=${row.polyPotentialSettledTrades}/${row.polyTargetSettledTrades}  ` +
      `near30=${row.polyNearTermPotentialSettledTrades}/${row.polyTargetSettledTrades}  ` +
      `vel=${row.polyNearTermPaperTradesOpened24h}/24h  ` +
      `pnl=${fmtUsd(row.polyTotalPnlUsd)}  ` +
      `due30=${row.polyDueNext30Days}/${row.polyOpenTrades}  ` +
      `equitySync=${row.equitySyncFreshCount}/${row.equitySyncExpectedCount}  ` +
      `edge=${fmtSignedPct(row.equityBenchmarkMinExcessReturn, 2)}  ` +
      `regime=${row.regimeMinDays}/${row.regimeTargetDays}d  ` +
      `discover=${row.polyMarketDiscoveryCount}/${row.polyMarketDiscoveryTarget}  ` +
      `quality=${row.polyQualityPassingOpenTrades}/${row.polyOpenTrades}  ` +
      `ttl=${fmtPct(row.ttlPassRate)}`,
    );
  }
}

function printEvidence(payload: OperationalEvidencePayload, history: OperationalEvidenceHistoryPoint[] = []): void {
  const { polymarket, equitySync, equityBenchmark, regimeSharpe, ttlFilter, marketDiscovery } = payload;

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
  console.log(`Open-book quality         ${polymarket.openBookQuality.passingTrades}/${polymarket.openBookQuality.openTrades} pass current filters`);
  if (polymarket.openBookQuality.reasons.length > 0) {
    const reasonText = polymarket.openBookQuality.reasons
      .slice(0, 3)
      .map(reason => `${reason.code}=${reason.count}${reason.sampleSlug ? ` sample=${reason.sampleSlug}` : ''}`)
      .join('; ');
    console.log(`Quality exceptions        ${reasonText}`);
  }
  console.log(`Box 2 potential settled   ${polymarket.potentialSettledTrades}/${polymarket.targetSettledTrades}`);
  console.log(`Additional resolved need  ${polymarket.additionalSettledTradesNeeded}`);
  console.log(`Open book reaches target  ${polymarket.openPipelineCanReachTarget ? 'yes' : 'no'}`);
  console.log(`Near-term Box 2 capacity  ${polymarket.nearTermPotentialSettledTrades}/${polymarket.targetSettledTrades}`);
  console.log(`Near-term resolved need   ${polymarket.additionalNearTermSettledTradesNeeded}`);
  console.log(`Learning trades 24h       ${polymarket.paperTradesOpened24h}`);
  console.log(`Near-term opened 24h      ${polymarket.nearTermPaperTradesOpened24h}`);
  console.log(`30d near-term target      ${polymarket.dailyNearTermTradeTarget30d.toFixed(1)}/day`);
  console.log(`Near-term fill ETA        ${fmtEta(payload.generatedAt, polymarket.nearTermPipelineFillEtaAt)}`);
  console.log(`Open exposure             ${fmtUsd(polymarket.openExposureUsd)} (${fmtPct(polymarket.openPnlPct)} open P&L)`);
  console.log(
    `Open win/loss/flat        ${polymarket.openPnlAttribution.openWinningTrades}/` +
    `${polymarket.openPnlAttribution.openLosingTrades}/${polymarket.openPnlAttribution.openFlatTrades}`,
  );
  console.log(
    `Gross open win/loss       ${fmtUsd(polymarket.openPnlAttribution.grossOpenProfitUsd)} / ` +
    `${fmtUsd(polymarket.openPnlAttribution.grossOpenLossUsd)}`,
  );
  console.log(`Worst open trade          ${fmtWorstOpenTrade(polymarket.openPnlAttribution)}`);
  console.log(`Due next 7d / 30d         ${polymarket.dueNext7Days}/${polymarket.dueNext30Days}`);
  console.log(`Overdue open              ${polymarket.overdueOpenTrades}`);
  console.log(`Nearest open end date     ${fmtDate(polymarket.nearestOpenEndAt)}`);
  console.log(`Latest paper trade        ${fmtAge(payload.generatedAt, polymarket.latestPaperTradeAt)}`);
  console.log(`Signals / approvals 24h   ${polymarket.signals24h}/${polymarket.approvedSignals24h} (${fmtPct(polymarket.approvalRate24h)})`);
  console.log(
    `Approved signal quality   source ${polymarket.approvedSignalQuality.sourceFreshSignals24h}/${polymarket.approvedSignalQuality.approvedSignals24h}; ` +
    `linked ${polymarket.approvedSignalQuality.linkedPaperTradeSignals24h}/${polymarket.approvedSignalQuality.approvedSignals24h}; ` +
    `avg edge ${polymarket.approvedSignalQuality.avgEdgePct === null ? '-' : `${polymarket.approvedSignalQuality.avgEdgePct.toFixed(1)}pp`}; ` +
    `state ${polymarket.approvedSignalQuality.state}`,
  );
  if (polymarket.approvedSignalQuality.reasons.length > 0) {
    const reasonText = polymarket.approvedSignalQuality.reasons
      .slice(0, 3)
      .map(reason => `${reason.code}=${reason.count}${reason.sampleSlug ? ` sample=${reason.sampleSlug}` : ''}`)
      .join('; ');
    console.log(`Signal quality warnings   ${reasonText}`);
  }

  console.log();
  console.log('Market Discovery Evidence');
  console.log('-------------------------');
  console.log(`Latest scan               ${fmtAge(payload.generatedAt, marketDiscovery.latestAt)}`);
  console.log(`Markets discovered        ${marketDiscovery.marketCount}/${marketDiscovery.targetMarketCount}`);
  console.log(`State                     ${marketDiscovery.state}`);
  console.log(`Duration                  ${marketDiscovery.durationMs === null ? '-' : `${marketDiscovery.durationMs}ms`}`);
  console.log(`First-page cap threshold  ${marketDiscovery.firstPageCapThreshold}`);

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
  console.log('Equity Live Sync');
  console.log('----------------');
  if (!equitySync) {
    console.log('Equity state sync not collected');
  } else {
    console.log(`Fresh instances          ${equitySync.freshCount}/${equitySync.expectedCount}`);
    console.log(`Latest state write       ${fmtAge(payload.generatedAt, equitySync.latestAt)}`);
    console.log(`Max state age            ${fmtDuration(equitySync.maxAgeSec)}`);
    for (const row of equitySync.instances) {
      const equity = row.equity === null ? '-' : fmtUsd(row.equity);
      console.log(`${row.instance.padEnd(18)} ${row.state.padEnd(18)} age=${fmtDuration(row.ageSec)} equity=${equity}`);
    }
  }

  console.log();
  console.log('Equity Benchmark Evidence');
  console.log('-------------------------');
  if (!equityBenchmark) {
    console.log('Equity benchmark not collected');
  } else if (equityBenchmark.instances.length === 0) {
    console.log(equityBenchmark.summary);
  } else {
    console.log(`Benchmark                ${equityBenchmark.benchmark ?? '-'}`);
    console.log(`Min excess return        ${fmtSignedPct(equityBenchmark.minExcessReturn, 2)}`);
    console.log(`All outperforming        ${equityBenchmark.allOutperforming ? 'yes' : 'no'}`);
    for (const row of equityBenchmark.instances) {
      console.log(
        `${row.instance.padEnd(18)} ${row.nDays}d  ` +
        `strategy=${fmtPct(row.strategyReturn, 2)}  ` +
        `benchmark=${fmtPct(row.benchmarkReturn, 2)}  ` +
        `excess=${fmtSignedPct(row.excessReturn, 2)}`,
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
    const payload = collectOperationalEvidence(db, Math.floor(Date.now() / 1000), {
      collectEquitySync: true,
      collectEquityBenchmark: true,
    });
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
