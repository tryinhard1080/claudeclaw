import type {
  OperationalEvidenceHistoryPoint,
  OperationalEvidencePayload,
} from './evidence.js';
import type { ReadinessStatus } from './gate-progress.js';
import type { OpenMtmDiagnosticsSummary } from './poly-open-mtm-diagnostics.js';
import type { PnlHeartbeatSummary } from './poly-pnl-heartbeat.js';
import type { ResolutionWatchSummary } from './poly-resolution-watch.js';
import type { SettledCalibrationSummary } from './poly-settled-calibration.js';
import type { SettlementImpactSummary } from './poly-settlement-impact.js';
import type { TradingSchedulerCadenceSummary } from './scheduler-status.js';

export interface OvernightAgentTraceStep {
  name: string;
  status: ReadinessStatus;
  detail: string;
}

export interface OvernightAgentDecision {
  key: string;
  status: ReadinessStatus;
  decision: string;
  reason: string;
}

export interface OvernightAgentSelfEval {
  checksPassed: number;
  checksTotal: number;
  status: ReadinessStatus;
  findings: OvernightAgentTraceStep[];
}

export interface OvernightTradingAgentReport {
  generatedAt: number;
  status: ReadinessStatus;
  verdict: string;
  oneLine: string;
  trace: OvernightAgentTraceStep[];
  decisions: OvernightAgentDecision[];
  selfEval: OvernightAgentSelfEval;
  nextActions: string[];
  history: OperationalEvidenceHistoryPoint[];
  evidence: OperationalEvidencePayload;
  settlementImpact: SettlementImpactSummary | null;
  openMtmDiagnostics: OpenMtmDiagnosticsSummary | null;
  settledCalibration: SettledCalibrationSummary | null;
  resolutionWatch: ResolutionWatchSummary | null;
  scheduler: TradingSchedulerCadenceSummary | null;
  pnlHeartbeat: PnlHeartbeatSummary | null;
}

function rank(status: ReadinessStatus): number {
  return status === 'fail' ? 2 : status === 'warn' ? 1 : 0;
}

function worstStatus(statuses: ReadonlyArray<ReadinessStatus>): ReadinessStatus {
  return statuses.reduce<ReadinessStatus>((worst, status) => (
    rank(status) > rank(worst) ? status : worst
  ), 'pass');
}

function fmtUsd(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function fmtNullableUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return fmtUsd(value);
}

function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtSignedPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(digits)}%`;
}

function fmtDateTime(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString();
}

function fmtOptionalDateTime(epochSec: number | null): string {
  return epochSec === null ? 'n/a' : fmtDateTime(epochSec);
}

function fmtAgeSec(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  if (value < 60) return '<1m';
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

function metricStatus(
  payload: OperationalEvidencePayload,
  key: string,
  fallback: ReadinessStatus,
): ReadinessStatus {
  return payload.metrics.find(metric => metric.key === key)?.status ?? fallback;
}

function metricDetail(payload: OperationalEvidencePayload, key: string, fallback: string): string {
  const metric = payload.metrics.find(row => row.key === key);
  if (!metric) return fallback;
  return `${metric.state}: ${metric.detail}`;
}

function buildTrace(payload: OperationalEvidencePayload): OvernightAgentTraceStep[] {
  return [
    {
      name: 'collect operational evidence',
      status: payload.status,
      detail: `${payload.metrics.length} metrics collected from the local trading store`,
    },
    {
      name: 'grade Polymarket paper pipeline',
      status: worstStatus([
        metricStatus(payload, 'polymarket_resolution_pipeline', 'warn'),
        metricStatus(payload, 'polymarket_box2_pipeline_capacity', 'warn'),
        metricStatus(payload, 'polymarket_near_term_box2_capacity', 'warn'),
        metricStatus(payload, 'polymarket_signal_flow', 'fail'),
        metricStatus(payload, 'polymarket_approved_signal_quality', 'warn'),
      ]),
      detail: `${payload.polymarket.settledTrades}/${payload.polymarket.targetSettledTrades} settled, ` +
        `${payload.polymarket.openTrades} open, ${payload.polymarket.approvedSignals24h} approvals in 24h`,
    },
    {
      name: 'grade market discovery and filters',
      status: worstStatus([
        payload.marketDiscovery.status,
        payload.polymarket.openBookQuality.status,
        payload.ttlFilter.latestAt === null ? 'warn' : 'pass',
      ]),
      detail: `${payload.marketDiscovery.marketCount}/${payload.marketDiscovery.targetMarketCount} markets, ` +
        `${payload.polymarket.openBookQuality.passingTrades}/${payload.polymarket.openBookQuality.openTrades} open trades pass current filters`,
    },
    {
      name: 'grade equity paper track',
      status: worstStatus([
        payload.equitySync?.status ?? 'warn',
        payload.equityBenchmark?.status ?? 'warn',
        payload.regimeSharpe.allInstancesComplete ? 'pass' : 'warn',
      ]),
      detail: `regime ${payload.regimeSharpe.minDays}/${payload.regimeSharpe.targetDays} days, ` +
        `benchmark edge ${fmtSignedPct(payload.equityBenchmark?.minExcessReturn)}`,
    },
    {
      name: 'preserve live-money gate',
      status: 'warn',
      detail: 'Box 2, Box 3, and final Box 7 sign-off must stay evidence-bound',
    },
  ];
}

function buildDecisions(payload: OperationalEvidencePayload): OvernightAgentDecision[] {
  const poly = payload.polymarket;
  const box2Pass = poly.settledTrades >= poly.targetSettledTrades && poly.realizedPnlPositive;
  const box3Pass = payload.regimeSharpe.allInstancesComplete && payload.regimeSharpe.allInstancesPositive;

  return [
    {
      key: 'box2_polymarket',
      status: box2Pass ? 'pass' : 'warn',
      decision: box2Pass ? 'ready for operator review' : 'keep paper-only',
      reason: `${poly.settledTrades}/${poly.targetSettledTrades} settled, realized ${fmtUsd(poly.realizedPnlUsd)}, total mark-to-market ${fmtUsd(poly.totalPnlUsd)}`,
    },
    {
      key: 'box3_equities',
      status: box3Pass ? 'pass' : 'warn',
      decision: box3Pass ? 'ready for operator review' : 'keep collecting sample',
      reason: `${payload.regimeSharpe.minDays}/${payload.regimeSharpe.targetDays} days, positive Sharpe track=${payload.regimeSharpe.allInstancesPositive ? 'yes' : 'no'}`,
    },
    {
      key: 'box7_live_signoff',
      status: 'warn',
      decision: 'do not enable real money',
      reason: 'final written MISSION.md sign-off is still required after all evidence boxes pass',
    },
  ];
}

function buildNextActions(
  payload: OperationalEvidencePayload,
  settlementImpact: SettlementImpactSummary | null,
  openMtmDiagnostics: OpenMtmDiagnosticsSummary | null,
  settledCalibration: SettledCalibrationSummary | null,
  resolutionWatch: ResolutionWatchSummary | null,
  scheduler: TradingSchedulerCadenceSummary | null,
  pnlHeartbeat: PnlHeartbeatSummary | null,
): string[] {
  const actions: string[] = [];
  const poly = payload.polymarket;

  if (payload.status === 'fail') {
    const failing = payload.metrics.filter(metric => metric.status === 'fail').map(metric => metric.name);
    actions.push(`Fix failing evidence before expanding activity: ${failing.join(', ') || 'unknown failure'}.`);
  }

  if (poly.settledTrades < poly.targetSettledTrades) {
    actions.push(
      `Keep Polymarket in paper mode until Box 2 has ${poly.targetSettledTrades} settled trades and positive realized P&L.`,
    );
  }

  if (poly.openTradeSlotsAvailable === 0 && poly.settledTrades < poly.targetSettledTrades) {
    actions.push(
      `Do not loosen paper caps for activity: ${poly.openTrades}/${poly.maxOpenTrades} paper slots are full, ` +
      `0 slots are available, and actual settled evidence is still ${poly.settledTrades}/${poly.targetSettledTrades}.`,
    );
  }

  if (scheduler) {
    const resolutionFetch = scheduler.tasks.find(task => task.key === 'resolution_fetch');
    const resolutionWatchTask = scheduler.tasks.find(task => task.key === 'resolution_watch');
    if (scheduler.mainOverdueIds.length > 0) {
      actions.push(
        `Clear overdue main-agent scheduler task(s) before trusting unattended readiness cadence: ${scheduler.mainOverdueIds.join(', ')}.`,
      );
    } else if (poly.openTradeSlotsAvailable === 0 && poly.settledTrades < poly.targetSettledTrades) {
      const fetchAt = resolutionFetch?.nextRun ? fmtDateTime(resolutionFetch.nextRun) : 'not scheduled';
      const watchAt = resolutionWatchTask?.nextRun ? fmtDateTime(resolutionWatchTask.nextRun) : 'not scheduled';
      actions.push(
        `Use scheduled resolution turnover while slots are full: next cache refresh ${fetchAt}; next resolution watch ${watchAt}.`,
      );
    }
  }

  if (resolutionWatch) {
    if (resolutionWatch.closedCacheStillOpenTrades > 0) {
      actions.push(
        `Investigate ${resolutionWatch.closedCacheStillOpenTrades} paper trade(s) where the resolution cache is closed but the paper trade remains open before trusting Box 2 settlement evidence.`,
      );
    }

    if (resolutionWatch.overdueBeyondGraceTrades > 0) {
      actions.push(
        `Investigate ${resolutionWatch.overdueBeyondGraceTrades} open paper trade(s) overdue beyond the ${resolutionWatch.overdueGraceDays}d resolution grace window.`,
      );
    }

    if (resolutionWatch.dueWindowTrades > 0 &&
      (resolutionWatch.dueWindowMissingCacheTrades > 0 || resolutionWatch.dueWindowStaleCacheTrades > 0)) {
      actions.push(
        `Refresh due-window resolution cache before trusting Box 2 turnover: ` +
        `${resolutionWatch.dueWindowFreshCacheTrades}/${resolutionWatch.dueWindowTrades} fresh within ` +
        `${Math.round(resolutionWatch.maxCacheAgeSec / 60)}m, stale/missing ` +
        `${resolutionWatch.dueWindowStaleCacheTrades}/${resolutionWatch.dueWindowMissingCacheTrades}.`,
      );
    }

    const overdueWithinGrace = Math.max(0, resolutionWatch.overdueTrades - resolutionWatch.overdueBeyondGraceTrades);
    if (overdueWithinGrace > 0) {
      actions.push(
        `Watch ${overdueWithinGrace} overdue open paper position(s) still inside the ${resolutionWatch.overdueGraceDays}d resolution grace window for the next resolution batch.`,
      );
    }
  } else if (poly.overdueOpenTrades > 0) {
    actions.push(
      `Watch ${poly.overdueOpenTrades} overdue open paper position(s); run the resolution watch before treating them as Box 2 settlement evidence.`,
    );
  }

  if (poly.dueNext7Days > 0) {
    actions.push(`Watch the ${poly.dueNext7Days} paper position(s) due in the next 7 days for the next resolution batch.`);
  }

  if (poly.nearTermVelocityState === 'activity_filled_waiting_for_settlements') {
    actions.push(
      `Do not expand paper activity further yet: Box 2 has ${poly.nearTermPotentialSettledTrades}/${poly.targetSettledTrades} near-term potential settlements, ` +
      `but actual settled evidence is still ${poly.settledTrades}/${poly.targetSettledTrades} with realized ${fmtUsd(poly.realizedPnlUsd)}.`,
    );
  }

  if (openMtmDiagnostics && openMtmDiagnostics.unrealizedPnlUsd < 0) {
    actions.push(
      `Review open MTM drag before changing strategy parameters: ` +
      `${fmtUsd(openMtmDiagnostics.unrealizedPnlUsd)} total, ` +
      `${fmtUsd(openMtmDiagnostics.due7dPnlUsd)} due <=7d, ` +
      `${fmtUsd(openMtmDiagnostics.currentFilterExceptionPnlUsd)} in current-filter exceptions.`,
    );
  }

  if (settledCalibration && settledCalibration.status !== 'pass') {
    actions.push(
      `Keep settled calibration on watch: ${settledCalibration.state}, ` +
      `${settledCalibration.settledTrades}/${settledCalibration.targetSettledTrades} settled, ` +
      `realized ${fmtUsd(settledCalibration.realizedPnlUsd)}.`,
    );
  }

  if (pnlHeartbeat && pnlHeartbeat.status !== 'pass') {
    actions.push(
      `Investigate P&L heartbeat before trusting settlement evidence: ${pnlHeartbeat.state}; ` +
      `${pnlHeartbeat.freshPositionRows}/${pnlHeartbeat.openTrades} open position(s) marked within ` +
      `${Math.round(pnlHeartbeat.maxAgeSec / 60)}m, stale/missing ` +
      `${pnlHeartbeat.stalePositionRows}/${pnlHeartbeat.missingPositionRows}.`,
    );
  }

  if (settlementImpact && settlementImpact.dueTrades > 0 && settlementImpact.stillNeededAfterWindow > 0) {
    actions.push(
      `The next ${settlementImpact.horizonDays}d settlement window can move Box 2 to ` +
      `${settlementImpact.potentialSettledAfterWindow}/${settlementImpact.targetSettledTrades}; ` +
      `${settlementImpact.stillNeededAfterWindow} additional settled trades would still be needed.`,
    );
  }

  if (poly.nearTermVelocityState === 'near_term_below_pace' || poly.nearTermVelocityState === 'no_near_term_trade_velocity') {
    actions.push(
      `Audit recent Polymarket rejections because near-term learning velocity is below the ${poly.dailyNearTermTradeTarget30d.toFixed(1)}/day target.`,
    );
  }

  if (poly.approvedSignalQuality.status !== 'pass') {
    actions.push(`Review approved signal quality: ${poly.approvedSignalQuality.summary}.`);
  }

  if (poly.openBookQuality.status !== 'pass') {
    actions.push(`Review open-book filter exceptions: ${poly.openBookQuality.summary}.`);
  }

  if (!payload.regimeSharpe.allInstancesComplete) {
    actions.push(`Let regime-trader continue the ${payload.regimeSharpe.targetDays}-day Sharpe sample before Box 3 review.`);
  }

  if (actions.length === 0) {
    actions.push('No operator action required tonight. Continue paper trading and review the next scheduled report.');
  }

  return actions;
}

function buildSelfEval(report: Omit<OvernightTradingAgentReport, 'selfEval'>): OvernightAgentSelfEval {
  const findings: OvernightAgentTraceStep[] = [
    {
      name: 'report is trading-only',
      status: 'pass',
      detail: 'No personal-assistant tasks, non-trading research, or external workflows are included.',
    },
    {
      name: 'live-money gate preserved',
      status: report.decisions.some(decision => decision.key === 'box7_live_signoff' && decision.decision === 'do not enable real money')
        ? 'pass'
        : 'fail',
      detail: 'The report must never convert operator pressure into live-money permission.',
    },
    {
      name: 'settled and mark-to-market separated',
      status: report.oneLine.includes('settled') && report.oneLine.includes('MTM') ? 'pass' : 'fail',
      detail: 'Box 2 requires settled realized P&L, not only open-book mark-to-market.',
    },
    {
      name: 'operator next actions emitted',
      status: report.nextActions.length > 0 ? 'pass' : 'fail',
      detail: `${report.nextActions.length} next action(s) generated.`,
    },
  ];
  const checksPassed = findings.filter(finding => finding.status === 'pass').length;
  return {
    checksPassed,
    checksTotal: findings.length,
    status: worstStatus(findings.map(finding => finding.status)),
    findings,
  };
}

export function buildOvernightTradingAgentReport(
  evidence: OperationalEvidencePayload,
  history: OperationalEvidenceHistoryPoint[] = [],
  settlementImpact: SettlementImpactSummary | null = null,
  openMtmDiagnostics: OpenMtmDiagnosticsSummary | null = null,
  settledCalibration: SettledCalibrationSummary | null = null,
  resolutionWatch: ResolutionWatchSummary | null = null,
  scheduler: TradingSchedulerCadenceSummary | null = null,
  pnlHeartbeat: PnlHeartbeatSummary | null = null,
): OvernightTradingAgentReport {
  const trace = buildTrace(evidence);
  const decisions = buildDecisions(evidence);
  const nextActions = buildNextActions(
    evidence,
    settlementImpact,
    openMtmDiagnostics,
    settledCalibration,
    resolutionWatch,
    scheduler,
    pnlHeartbeat,
  );
  const status = worstStatus([...trace.map(step => step.status), ...decisions.map(decision => decision.status)]);
  const verdict = status === 'fail'
    ? 'FAIL: operational blocker needs investigation before activity expands'
    : status === 'warn'
      ? 'WARN: paper trading can continue, live money remains blocked'
      : 'PASS: paper operations clean, continue scheduled monitoring';
  const oneLine =
    `Poly ${evidence.polymarket.settledTrades}/${evidence.polymarket.targetSettledTrades} settled, ` +
    `${evidence.polymarket.openTrades} open, MTM ${fmtUsd(evidence.polymarket.totalPnlUsd)}; ` +
    (settlementImpact
      ? `next ${settlementImpact.horizonDays}d max ${settlementImpact.potentialSettledAfterWindow}/${settlementImpact.targetSettledTrades}; `
      : '') +
    `Regime ${evidence.regimeSharpe.minDays}/${evidence.regimeSharpe.targetDays}d, ` +
    `edge ${fmtSignedPct(evidence.equityBenchmark?.minExcessReturn)}.`;

  const base = {
    generatedAt: evidence.generatedAt,
    status,
    verdict,
    oneLine,
    trace,
    decisions,
    nextActions,
    history,
    evidence,
    settlementImpact,
    openMtmDiagnostics,
    settledCalibration,
    resolutionWatch,
    scheduler,
    pnlHeartbeat,
  };

  return {
    ...base,
    selfEval: buildSelfEval(base),
  };
}

function mdList(items: ReadonlyArray<string>): string {
  return items.map(item => `- ${item}`).join('\n');
}

function mdStatus(status: ReadinessStatus): string {
  return status.toUpperCase();
}

interface QualityReason {
  code: string;
  count: number;
  sampleSlug: string | null;
  reason: string;
}

function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function mdQualityReasonTable(title: string, reasons: QualityReason[]): string[] {
  if (reasons.length === 0) return [];

  return [
    '',
    `### ${title}`,
    '',
    '| Code | Count | Sample | Reason |',
    '| --- | --- | --- | --- |',
    ...reasons.map(reason => (
      `| ${mdCell(reason.code)} | ${reason.count} | ` +
      `${mdCell(reason.sampleSlug ?? 'n/a')} | ${mdCell(reason.reason)} |`
    )),
  ];
}

function fmtDate(value: number | null): string {
  return value === null ? 'n/a' : new Date(value * 1000).toISOString().slice(0, 10);
}

function fmtDays(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  if (value < 0) return `${Math.ceil(Math.abs(value))}d overdue`;
  if (value < 1) return '<1d';
  return `${Math.ceil(value)}d`;
}

function mdWorstOpenMarksTable(worstItems: OpenMtmDiagnosticsSummary['worstItems']): string[] {
  if (worstItems.length === 0) return [];

  return [
    '',
    '### Worst Open Marks',
    '',
    '| Trade | End | P&L | Size | Filter | Signal | Market |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...worstItems.map(item => {
      const filter = item.filterState === 'pass' ? 'pass' : item.filterCode ?? item.filterState;
      const signal = item.signalConfidence || item.signalEdgePct !== null
        ? `${item.signalConfidence ?? '-'} ${item.signalEdgePct === null ? '-' : `${item.signalEdgePct.toFixed(1)}pp`}`
        : 'n/a';
      const market = `${item.marketSlug}${item.outcomeLabel ? ` ${item.outcomeLabel}` : ''}`;
      return (
        `| #${item.tradeId} | ${fmtDate(item.endAt)} (${fmtDays(item.daysToEnd)}) | ` +
        `${fmtUsd(item.unrealizedPnlUsd)} (${fmtPct(item.openPnlPct)}) | ` +
        `${fmtUsd(item.sizeUsd)} | ${mdCell(filter)} | ${mdCell(signal)} | ${mdCell(market)} |`
      );
    }),
  ];
}

function mdSettlementImpactItemsTable(items: SettlementImpactSummary['items']): string[] {
  if (items.length === 0) return [];

  return [
    '',
    '### Due-Window Trades',
    '',
    '| Trade | End | Unrealized | If Win | If Lose | Size | Market |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...items.map(item => {
      const market = `${item.marketSlug}${item.outcomeLabel ? ` ${item.outcomeLabel}` : ''}`;
      return (
        `| #${item.tradeId} | ${fmtDate(item.endAt)} (${fmtDays(item.daysToEnd)}) | ` +
        `${fmtUsd(item.unrealizedPnlUsd)} | ${fmtNullableUsd(item.winPnlUsd)} | ` +
        `${fmtNullableUsd(item.lossPnlUsd)} | ${fmtUsd(item.sizeUsd)} | ${mdCell(market)} |`
      );
    }),
  ];
}

function mdHistoryTable(history: OperationalEvidenceHistoryPoint[]): string[] {
  if (history.length === 0) return [];

  return [
    '',
    '## Evidence History',
    '',
    '| Date | Status | Box 2 Settled | Box 2 Potential | Near-Term | MTM | Open Quality | Equity Edge | Regime Sample |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...history.map(row => (
      `| ${row.snapshotYmd} | ${mdStatus(row.status)} | ` +
      `${row.polySettledTrades}/${row.polyTargetSettledTrades} realized ${fmtUsd(row.polyRealizedPnlUsd)} | ` +
      `${row.polyPotentialSettledTrades}/${row.polyTargetSettledTrades} | ` +
      `${row.polyNearTermPotentialSettledTrades}/${row.polyTargetSettledTrades}; due ${row.polyDueNext7Days}/${row.polyDueNext30Days} | ` +
      `${fmtUsd(row.polyTotalPnlUsd)} equity ${fmtUsd(row.polyPaperEquityUsd)} | ` +
      `${row.polyQualityPassingOpenTrades}/${row.polyOpenTrades} | ` +
      `${fmtSignedPct(row.equityBenchmarkMinExcessReturn)} | ` +
      `${row.regimeMinDays}/${row.regimeTargetDays}d positive=${row.regimeAllInstancesPositive ? 'yes' : 'no'} |`
    )),
  ];
}

export function formatOvernightTradingAgentMarkdown(report: OvernightTradingAgentReport): string {
  const poly = report.evidence.polymarket;
  const equityBenchmark = report.evidence.equityBenchmark;
  const settlementImpact = report.settlementImpact;
  const openMtmDiagnostics = report.openMtmDiagnostics;
  const settledCalibration = report.settledCalibration;
  const resolutionWatch = report.resolutionWatch;
  const scheduler = report.scheduler;
  const pnlHeartbeat = report.pnlHeartbeat;
  const hasQualityExceptions = poly.openBookQuality.reasons.length > 0 || poly.approvedSignalQuality.reasons.length > 0;
  const notableResolutionItems = resolutionWatch?.items
    .filter(item => item.status !== 'pass' || item.state === 'due_soon')
    .slice(0, 5) ?? [];
  const lines = [
    '# Overnight Trading Agent Report',
    '',
    `Generated: ${fmtDateTime(report.generatedAt)}`,
    `Status: ${mdStatus(report.status)}`,
    '',
    '## Verdict',
    '',
    report.verdict,
    '',
    report.oneLine,
    '',
    '## Trace',
    '',
    '| Step | Status | Detail |',
    '| --- | --- | --- |',
    ...report.trace.map(step => `| ${step.name} | ${mdStatus(step.status)} | ${step.detail} |`),
    '',
    '## Polymarket Paper Evidence',
    '',
    `- Settled / target: ${poly.settledTrades}/${poly.targetSettledTrades}`,
    `- Realized P&L: ${fmtUsd(poly.realizedPnlUsd)}`,
    `- Unrealized P&L: ${fmtUsd(poly.unrealizedPnlUsd)}`,
    `- Total paper P&L: ${fmtUsd(poly.totalPnlUsd)} (${fmtPct(poly.paperReturnPct)})`,
    `- Open / voided: ${poly.openTrades}/${poly.voidedTrades}`,
    `- Paper slots used / max: ${poly.openTrades}/${poly.maxOpenTrades} (${poly.openTradeSlotsAvailable} available)`,
    `- Due next 7d / 30d: ${poly.dueNext7Days}/${poly.dueNext30Days}`,
    `- Signals / approvals 24h: ${poly.signals24h}/${poly.approvedSignals24h} (${fmtPct(poly.approvalRate24h)})`,
    `- Open-book quality: ${poly.openBookQuality.summary}`,
    `- Approved signal quality: ${poly.approvedSignalQuality.summary}`,
    ...(hasQualityExceptions ? [
      '',
      '## Quality Exceptions',
      ...mdQualityReasonTable('Open Book', poly.openBookQuality.reasons),
      ...mdQualityReasonTable('Approved Signals', poly.approvedSignalQuality.reasons),
    ] : []),
    ...(resolutionWatch ? [
      '',
      '## Resolution Watch',
      '',
      `- Status: ${mdStatus(resolutionWatch.status)}`,
      `- Open trades: ${resolutionWatch.openTrades}`,
      `- Due <=${resolutionWatch.dueSoonDays}d / <=${resolutionWatch.nearTermDays}d: ${resolutionWatch.dueSoonTrades}/${resolutionWatch.dueNearTermTrades}`,
      `- Overdue open / beyond grace: ${resolutionWatch.overdueTrades}/${resolutionWatch.overdueBeyondGraceTrades}`,
      `- Closed cache still open: ${resolutionWatch.closedCacheStillOpenTrades}`,
      `- Missing market rows / unknown end dates: ${resolutionWatch.missingMarketRows}/${resolutionWatch.unknownEndDateTrades}`,
      `- Due-window cache rows: ${resolutionWatch.dueWindowCachedTrades}/${resolutionWatch.dueWindowTrades} (${fmtPct(resolutionWatch.dueWindowCacheCoveragePct)})`,
      `- Due-window fresh cache: ${resolutionWatch.dueWindowFreshCacheTrades}/${resolutionWatch.dueWindowTrades} <=${Math.round(resolutionWatch.maxCacheAgeSec / 60)}m (${fmtPct(resolutionWatch.dueWindowFreshCacheCoveragePct)})`,
      `- Due-window stale / missing cache: ${resolutionWatch.dueWindowStaleCacheTrades}/${resolutionWatch.dueWindowMissingCacheTrades}`,
      `- Oldest due-window cache fetch: ${fmtOptionalDateTime(resolutionWatch.oldestDueWindowCacheFetchedAt)} (${fmtAgeSec(resolutionWatch.oldestDueWindowCacheAgeSec)} ago)`,
      ...(notableResolutionItems.length > 0 ? [
        '- Notable items:',
        ...notableResolutionItems.map(item => (
          `  - #${item.tradeId} ${item.state} ${item.marketSlug}: ${item.detail}`
        )),
      ] : []),
    ] : []),
    ...(scheduler ? [
      '',
      '## Scheduler Cadence',
      '',
      `- Status: ${mdStatus(scheduler.status)}`,
      `- Main-agent overdue tasks: ${scheduler.mainOverdueIds.length > 0 ? scheduler.mainOverdueIds.join(', ') : 'none'}`,
      `- Non-main overdue tasks: ${scheduler.nonMainOverdueIds.length > 0 ? `${scheduler.nonMainOverdueIds.join(', ')} (not main readiness blockers)` : 'none'}`,
      '',
      '| Cadence | Status | Next Run | Last Run | Last Status |',
      '| --- | --- | --- | --- | --- |',
      ...scheduler.tasks.map(task => (
        `| ${task.label} | ${mdStatus(task.status)} | ` +
        `${task.nextRun ? fmtDateTime(task.nextRun) : 'not scheduled'} | ` +
        `${task.lastRun ? fmtDateTime(task.lastRun) : 'never'} | ` +
        `${task.lastStatus ?? '-'} |`
      )),
    ] : []),
    ...(settledCalibration ? [
      '',
      '## Settled Calibration',
      '',
      `- Status: ${mdStatus(settledCalibration.status)} ${settledCalibration.state}`,
      `- Settled / target: ${settledCalibration.settledTrades}/${settledCalibration.targetSettledTrades}`,
      `- Won / lost: ${settledCalibration.wonTrades}/${settledCalibration.lostTrades}`,
      `- Realized P&L: ${fmtUsd(settledCalibration.realizedPnlUsd)}`,
      `- Calibration samples: ${settledCalibration.calibrationSamples}`,
      `- Win rate: ${fmtPct(settledCalibration.winRate)}`,
      `- Brier score: ${settledCalibration.brierScore === null ? 'n/a' : settledCalibration.brierScore.toFixed(4)}`,
      `- Log loss: ${settledCalibration.logLoss === null ? 'n/a' : settledCalibration.logLoss.toFixed(4)}`,
      `- Verdict: ${settledCalibration.verdict}`,
    ] : []),
    ...(pnlHeartbeat ? [
      '',
      '## P&L Heartbeat',
      '',
      `- Status: ${mdStatus(pnlHeartbeat.status)} ${pnlHeartbeat.state}`,
      `- Open trades / position rows: ${pnlHeartbeat.openTrades}/${pnlHeartbeat.positionRows}`,
      `- Fresh positions <=${Math.round(pnlHeartbeat.maxAgeSec / 60)}m: ${pnlHeartbeat.freshPositionRows}/${pnlHeartbeat.openTrades}`,
      `- Stale / missing positions: ${pnlHeartbeat.stalePositionRows}/${pnlHeartbeat.missingPositionRows}`,
      `- Latest mark: ${fmtOptionalDateTime(pnlHeartbeat.newestPositionUpdatedAt)} (${fmtAgeSec(pnlHeartbeat.newestPositionAgeSec)} ago)`,
      `- Oldest mark: ${fmtOptionalDateTime(pnlHeartbeat.oldestPositionUpdatedAt)} (${fmtAgeSec(pnlHeartbeat.oldestPositionAgeSec)} ago)`,
      ...(pnlHeartbeat.schemaIssues.length > 0 ? [
        `- Schema warnings: ${pnlHeartbeat.schemaIssues.join('; ')}`,
      ] : []),
    ] : []),
    ...(settlementImpact ? [
      '',
      '## Settlement Impact',
      '',
      `- Window: <=${settlementImpact.horizonDays}d`,
      `- Due trades: ${settlementImpact.dueTrades}`,
      `- Potential after window: ${settlementImpact.potentialSettledAfterWindow}/${settlementImpact.targetSettledTrades}`,
      `- Still needed after window: ${settlementImpact.stillNeededAfterWindow}`,
      `- Due exposure: ${fmtUsd(settlementImpact.dueExposureUsd)}`,
      `- Current due unrealized: ${fmtUsd(settlementImpact.dueUnrealizedPnlUsd)}`,
      `- If held outcomes win: ${fmtUsd(settlementImpact.allHeldOutcomesWinPnlUsd)}`,
      `- If held outcomes lose: ${fmtUsd(settlementImpact.allHeldOutcomesLosePnlUsd)}`,
      `- Unknown impact trades: ${settlementImpact.unknownImpactTrades}`,
      ...mdSettlementImpactItemsTable(settlementImpact.items),
    ] : []),
    ...(openMtmDiagnostics ? [
      '',
      '## Open MTM Diagnostics',
      '',
      `- Open trades: ${openMtmDiagnostics.openTrades}`,
      `- Open exposure: ${fmtUsd(openMtmDiagnostics.openExposureUsd)}`,
      `- Unrealized P&L: ${fmtUsd(openMtmDiagnostics.unrealizedPnlUsd)} (${fmtPct(openMtmDiagnostics.openPnlPct)})`,
      `- Open win/loss/flat: ${openMtmDiagnostics.winners}/${openMtmDiagnostics.losers}/${openMtmDiagnostics.flat}`,
      `- Due <=7d drag: ${openMtmDiagnostics.due7dTrades} trade(s), ${fmtUsd(openMtmDiagnostics.due7dPnlUsd)}`,
      `- Current-filter exceptions: ${openMtmDiagnostics.currentFilterExceptionTrades} trade(s), ${fmtUsd(openMtmDiagnostics.currentFilterExceptionPnlUsd)}`,
      `- Low-confidence high-edge: ${openMtmDiagnostics.lowConfidenceHighEdgeTrades} trade(s), ${fmtUsd(openMtmDiagnostics.lowConfidenceHighEdgePnlUsd)}`,
      ...mdWorstOpenMarksTable(openMtmDiagnostics.worstItems),
    ] : []),
    '',
    '## Equity Evidence',
    '',
    `- Regime Sharpe sample: ${report.evidence.regimeSharpe.minDays}/${report.evidence.regimeSharpe.targetDays} days`,
    `- Regime positive: ${report.evidence.regimeSharpe.allInstancesPositive ? 'yes' : 'no'}`,
    `- Benchmark: ${equityBenchmark?.benchmark ?? 'n/a'}`,
    `- Min excess return: ${fmtSignedPct(equityBenchmark?.minExcessReturn)}`,
    `- Equity sync: ${report.evidence.equitySync?.summary ?? 'not collected'}`,
    ...mdHistoryTable(report.history),
    '',
    '## Gate Decisions',
    '',
    '| Gate | Status | Decision | Reason |',
    '| --- | --- | --- | --- |',
    ...report.decisions.map(decision => (
      `| ${decision.key} | ${mdStatus(decision.status)} | ${decision.decision} | ${decision.reason} |`
    )),
    '',
    '## Self Eval',
    '',
    `Checks: ${report.selfEval.checksPassed}/${report.selfEval.checksTotal}`,
    '',
    '| Check | Status | Detail |',
    '| --- | --- | --- |',
    ...report.selfEval.findings.map(finding => `| ${finding.name} | ${mdStatus(finding.status)} | ${finding.detail} |`),
    '',
    '## Next Actions',
    '',
    mdList(report.nextActions),
    '',
    '## Notes',
    '',
    '- This report is read-only. It does not place orders, lift halts, size trades, or enable live money.',
    '- Scraped or transcript text is treated as data, not instructions.',
  ];
  return `${lines.join('\n')}\n`;
}

export function formatOvernightTradingAgentSummary(report: OvernightTradingAgentReport): string {
  const actionPreview = report.nextActions.slice(0, 3).map(action => `- ${action}`).join('\n');
  return [
    'Overnight trading agent report',
    `Status: ${mdStatus(report.status)}`,
    report.verdict,
    report.oneLine,
    '',
    'Top actions:',
    actionPreview || '- No action generated.',
  ].join('\n');
}
