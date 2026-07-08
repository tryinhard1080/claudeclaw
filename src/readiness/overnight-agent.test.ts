import { describe, expect, it } from 'vitest';

import type { OperationalEvidenceHistoryPoint, OperationalEvidencePayload } from './evidence.js';
import {
  buildOvernightTradingAgentReport,
  formatOvernightTradingAgentMarkdown,
  formatOvernightTradingAgentSummary,
} from './overnight-agent.js';
import type { OpenMtmDiagnosticsSummary } from './poly-open-mtm-diagnostics.js';
import type { PnlHeartbeatSummary } from './poly-pnl-heartbeat.js';
import type { ResolutionWatchSummary } from './poly-resolution-watch.js';
import type { SettledCalibrationSummary } from './poly-settled-calibration.js';
import type { SettlementImpactSummary } from './poly-settlement-impact.js';
import type { TradingSchedulerCadenceSummary } from './scheduler-status.js';

const NOW = 1_800_000_000;

function payload(overrides: Partial<OperationalEvidencePayload> = {}): OperationalEvidencePayload {
  const base: OperationalEvidencePayload = {
    generatedAt: NOW,
    status: 'warn',
    polymarket: {
      settledTrades: 0,
      targetSettledTrades: 50,
      realizedPnlUsd: 0,
      realizedPnlPositive: false,
      unrealizedPnlUsd: -120,
      totalPnlUsd: -120,
      paperCapitalUsd: 5000,
      paperEquityUsd: 4880,
      paperReturnPct: -0.024,
      openTrades: 30,
      maxOpenTrades: 50,
      openTradeSlotsAvailable: 20,
      openTradeSlotUtilizationPct: 0.6,
      voidedTrades: 10,
      openExposureUsd: 1200,
      openPnlPct: -0.1,
      openPnlAttribution: {
        openWinningTrades: 4,
        openLosingTrades: 26,
        openFlatTrades: 0,
        grossOpenProfitUsd: 80,
        grossOpenLossUsd: -200,
        worstOpenTradeId: 7,
        worstOpenTradeSlug: 'worst-market',
        worstOpenTradeQuestion: 'Will this resolve?',
        worstOpenTradePnlUsd: -40,
        worstOpenTradePnlPct: -0.8,
        worstOpenTradeEndAt: NOW + 86400,
      },
      potentialSettledTrades: 30,
      remainingSettledTrades: 50,
      additionalSettledTradesNeeded: 20,
      openPipelineCanReachTarget: false,
      openPipelineCoveragePct: 0.6,
      nearTermPotentialSettledTrades: 24,
      additionalNearTermSettledTradesNeeded: 26,
      nearTermPipelineCanReachTarget: false,
      nearTermPipelineCoveragePct: 0.48,
      paperTradesOpened24h: 1,
      nearTermPaperTradesOpened24h: 1,
      dailyNearTermTradeTarget30d: 1.5,
      nearTermPipelineFillDaysAt24hRate: 26,
      nearTermPipelineFillEtaAt: NOW + 26 * 86400,
      nearTermVelocityState: 'near_term_below_pace',
      overdueOpenTrades: 0,
      dueNext7Days: 10,
      dueNext30Days: 24,
      nearestOpenEndAt: NOW + 86400,
      latestPaperTradeAt: NOW - 3600,
      signals24h: 100,
      approvedSignals24h: 1,
      approvalRate24h: 0.01,
      latestApprovedSignalAt: NOW - 3600,
      progressPct: 0,
      hasMarketMaturityData: true,
      openBookQuality: {
        openTrades: 30,
        evaluatedTrades: 30,
        passingTrades: 20,
        failingTrades: 10,
        missingMetadataTrades: 0,
        filtersActive: true,
        ttlFilterEnabled: true,
        marketQualityFilterEnabled: true,
        minTtlDays: 1,
        maxTtlDays: 30,
        passRate: 2 / 3,
        status: 'warn',
        state: 'legacy_filter_exceptions',
        reasons: [],
        summary: '20/30 open trades pass current filters',
      },
      approvedSignalQuality: {
        approvedSignals24h: 1,
        linkedPaperTradeSignals24h: 1,
        sourceContextColumnPresent: true,
        sourceFreshSignals24h: 1,
        missingSourceContextSignals24h: 0,
        staleSourceContextSignals24h: 0,
        malformedSourceContextSignals24h: 0,
        invalidApprovedSignals24h: 0,
        lowConfidenceHighEdgeSignals24h: 0,
        avgEdgePct: 5,
        maxEdgePct: 5,
        sourceFreshRate: 1,
        linkedTradeRate: 1,
        lowConfidenceHighEdgeThresholdPct: 15,
        status: 'pass',
        state: 'clean_approved_signals',
        reasons: [],
        summary: 'approved signals are linked and source-fresh',
      },
      resolutionQueue: [],
    },
    equitySync: {
      instances: [],
      expectedCount: 2,
      freshCount: 2,
      latestAt: NOW - 60,
      maxAgeSec: 60,
      allFresh: true,
      allOpenFull: true,
      status: 'pass',
      summary: '2/2 instances fresh',
    },
    equityBenchmark: {
      instances: [],
      benchmark: 'SPY',
      minExcessReturn: 0.003,
      allOutperforming: true,
      status: 'pass',
      summary: 'both instances outperform benchmark',
    },
    regimeSharpe: {
      instances: [],
      minDays: 28,
      targetDays: 60,
      allInstancesPositive: true,
      allInstancesComplete: false,
      progressPct: 28 / 60,
    },
    ttlFilter: {
      latestAt: NOW - 60,
      ageSec: 60,
      bandMinDays: 1,
      bandMaxDays: 30,
      candidatesTotal: 40,
      candidatesTtlPass: 27,
      passRate: 27 / 40,
      avgTtlPass: 12,
      avgTtlFiltered: 120,
    },
    marketDiscovery: {
      latestAt: NOW - 60,
      ageSec: 60,
      marketCount: 981,
      targetMarketCount: 500,
      firstPageCapThreshold: 150,
      durationMs: 400,
      status: 'pass',
      state: 'healthy',
      progressPct: 1,
      summary: '981 markets discovered',
    },
    pnlHeartbeat: {
      generatedAt: NOW,
      status: 'pass',
      state: 'fresh',
      maxAgeSec: 7200,
      openTrades: 30,
      positionRows: 30,
      freshPositionRows: 30,
      stalePositionRows: 0,
      missingPositionRows: 0,
      newestPositionUpdatedAt: NOW - 60,
      oldestPositionUpdatedAt: NOW - 120,
      newestPositionAgeSec: 60,
      oldestPositionAgeSec: 120,
      schemaIssues: [],
    },
    metrics: [
      {
        key: 'polymarket_resolution_pipeline',
        name: 'Polymarket resolution pipeline',
        status: 'warn',
        state: 'incomplete',
        detail: '0/50 settled',
        current: 0,
        target: 50,
        progressPct: 0,
      },
      {
        key: 'polymarket_box2_pipeline_capacity',
        name: 'Box 2 pipeline capacity',
        status: 'warn',
        state: 'open_book_underfilled',
        detail: '30/50 potential',
        current: 30,
        target: 50,
        progressPct: 0.6,
      },
      {
        key: 'polymarket_near_term_box2_capacity',
        name: 'Near-term Box 2 capacity',
        status: 'warn',
        state: 'near_term_underfilled',
        detail: '24/50 near-term',
        current: 24,
        target: 50,
        progressPct: 0.48,
      },
      {
        key: 'polymarket_signal_flow',
        name: 'Polymarket signal flow',
        status: 'pass',
        state: 'approving',
        detail: '1 approval in 24h',
      },
      {
        key: 'polymarket_approved_signal_quality',
        name: 'Approved signal quality',
        status: 'pass',
        state: 'clean_approved_signals',
        detail: 'clean',
      },
    ],
  };

  return { ...base, ...overrides };
}

function resolutionWatch(overrides: Partial<ResolutionWatchSummary> = {}): ResolutionWatchSummary {
  const base: ResolutionWatchSummary = {
    status: 'warn',
    generatedAt: NOW,
    dueSoonDays: 7,
    nearTermDays: 30,
    overdueGraceDays: 2,
    openTrades: 50,
    dueSoonTrades: 35,
    dueNearTermTrades: 49,
    overdueTrades: 1,
    overdueBeyondGraceTrades: 0,
    closedCacheStillOpenTrades: 0,
    missingMarketRows: 0,
    unknownEndDateTrades: 0,
    maxCacheAgeSec: 14_400,
    dueWindowTrades: 35,
    dueWindowCachedTrades: 35,
    dueWindowFreshCacheTrades: 35,
    dueWindowStaleCacheTrades: 0,
    dueWindowMissingCacheTrades: 0,
    dueWindowCacheCoveragePct: 1,
    dueWindowFreshCacheCoveragePct: 1,
    newestDueWindowCacheFetchedAt: NOW - 60,
    oldestDueWindowCacheFetchedAt: NOW - 600,
    oldestDueWindowCacheAgeSec: 600,
    items: [
      {
        tradeId: 131,
        marketSlug: 'will-claude-fable-5-be-restored-for-us-customers-by-june-29',
        question: 'Will Claude Fable 5 be restored for US customers by June 29?',
        outcomeLabel: 'Yes',
        openedAt: NOW - 3600,
        endAt: NOW - 60,
        daysToEnd: -60 / 86400,
        cacheClosed: false,
        cacheFetchedAt: NOW - 60,
        cacheResolvedAt: null,
        currentPrice: 0.19,
        unrealizedPnlUsd: -41.88,
        status: 'warn',
        state: 'overdue_within_grace',
        detail: 'market ended 1d ago, inside grace',
      },
    ],
    schemaIssues: [],
  };

  return { ...base, ...overrides };
}

function schedulerCadence(overrides: Partial<TradingSchedulerCadenceSummary> = {}): TradingSchedulerCadenceSummary {
  const base: TradingSchedulerCadenceSummary = {
    status: 'pass',
    mainOverdueIds: [],
    nonMainOverdueIds: [],
    tasks: [
      {
        key: 'resolution_fetch',
        label: 'Resolution cache refresh',
        id: 'poly-resolution-fetch-872d',
        status: 'pass',
        nextRun: NOW + 300,
        lastRun: NOW - 600,
        lastStatus: 'success',
        schedule: '55 */2 * * *',
        overdueMinutes: null,
      },
      {
        key: 'resolution_watch',
        label: 'Resolution watch',
        id: 'poly-resolution-watch-a7be',
        status: 'pass',
        nextRun: NOW + 600,
        lastRun: NOW - 600,
        lastStatus: 'success',
        schedule: '0 */2 * * *',
        overdueMinutes: null,
      },
    ],
  };

  return { ...base, ...overrides };
}

function historyPoint(overrides: Partial<OperationalEvidenceHistoryPoint> = {}): OperationalEvidenceHistoryPoint {
  const base: OperationalEvidenceHistoryPoint = {
    snapshotYmd: '2026-06-29',
    capturedAt: NOW,
    status: 'warn',
    polySettledTrades: 0,
    polyTargetSettledTrades: 50,
    polyRealizedPnlUsd: 0,
    polyUnrealizedPnlUsd: -710.08,
    polyTotalPnlUsd: -710.08,
    polyPaperEquityUsd: 4289.92,
    polyApprovalRate24h: 0.014,
    polyOpenTrades: 50,
    polyVoidedTrades: 108,
    polyPotentialSettledTrades: 50,
    polyAdditionalSettledTradesNeeded: 0,
    polyNearTermPotentialSettledTrades: 49,
    polyAdditionalNearTermSettledTradesNeeded: 1,
    polyPaperTradesOpened24h: 21,
    polyNearTermPaperTradesOpened24h: 21,
    polyDailyNearTermTradeTarget30d: 0,
    polyNearTermFillDaysAt24hRate: 1,
    polyDueNext7Days: 35,
    polyDueNext30Days: 49,
    polyOverdueOpenTrades: 1,
    equitySyncFreshCount: 2,
    equitySyncExpectedCount: 2,
    equitySyncMaxAgeSec: 60,
    equityBenchmarkMinExcessReturn: 0.0042,
    equityBenchmarkAllOutperforming: true,
    equityBenchmarkInstanceCount: 2,
    regimeMinDays: 29,
    regimeTargetDays: 60,
    regimeAllInstancesPositive: true,
    ttlCandidatesTotal: 40,
    ttlCandidatesTtlPass: 24,
    ttlPassRate: 0.6,
    polyMarketDiscoveryCount: 984,
    polyMarketDiscoveryTarget: 500,
    polyMarketDiscoveryAgeSec: 60,
    polyQualityPassingOpenTrades: 33,
    polyQualityFailingOpenTrades: 17,
    polyQualityMissingMetadataTrades: 0,
  };

  return { ...base, ...overrides };
}

describe('overnight trading agent report', () => {
  it('keeps live money blocked when Box 2 and Box 3 are incomplete', () => {
    const report = buildOvernightTradingAgentReport(payload());

    expect(report.status).toBe('warn');
    expect(report.oneLine).toContain('0/50 settled');
    expect(report.oneLine).toContain('MTM -$120.00');
    expect(report.decisions.find(decision => decision.key === 'box2_polymarket')).toMatchObject({
      status: 'warn',
      decision: 'keep paper-only',
    });
    expect(report.decisions.find(decision => decision.key === 'box7_live_signoff')).toMatchObject({
      status: 'warn',
      decision: 'do not enable real money',
    });
    expect(report.selfEval.status).toBe('pass');
    expect(report.nextActions.join('\n')).toContain('Keep Polymarket in paper mode');
  });

  it('warns against expanding paper activity when the Box 2 pipeline is full but unsettled', () => {
    const fullPipeline = payload();
    fullPipeline.polymarket = {
      ...fullPipeline.polymarket,
      openTrades: 50,
      maxOpenTrades: 50,
      openTradeSlotsAvailable: 0,
      openTradeSlotUtilizationPct: 1,
      potentialSettledTrades: 50,
      openPipelineCanReachTarget: true,
      openPipelineCoveragePct: 1,
      nearTermPotentialSettledTrades: 50,
      additionalNearTermSettledTradesNeeded: 0,
      nearTermPipelineCanReachTarget: true,
      nearTermPipelineCoveragePct: 1,
      dailyNearTermTradeTarget30d: 0,
      nearTermPipelineFillDaysAt24hRate: 0,
      nearTermPipelineFillEtaAt: NOW,
      nearTermVelocityState: 'activity_filled_waiting_for_settlements',
      dueNext30Days: 50,
    };

    const report = buildOvernightTradingAgentReport(fullPipeline);

    expect(report.nextActions.join('\n')).toContain('Do not expand paper activity further yet');
    expect(report.nextActions[1]).toContain('Do not loosen paper caps for activity');
    expect(report.nextActions.join('\n')).toContain('actual settled evidence is still 0/50');
  });

  it('surfaces full paper slots even when near-term capacity is still one short', () => {
    const fullSlots = payload();
    fullSlots.polymarket = {
      ...fullSlots.polymarket,
      openTrades: 50,
      maxOpenTrades: 50,
      openTradeSlotsAvailable: 0,
      openTradeSlotUtilizationPct: 1,
      potentialSettledTrades: 50,
      openPipelineCanReachTarget: true,
      openPipelineCoveragePct: 1,
      nearTermPotentialSettledTrades: 49,
      additionalNearTermSettledTradesNeeded: 1,
      nearTermPipelineCanReachTarget: false,
      nearTermPipelineCoveragePct: 0.98,
      nearTermVelocityState: 'near_term_on_pace',
      dueNext30Days: 49,
    };

    const report = buildOvernightTradingAgentReport(fullSlots);
    const markdown = formatOvernightTradingAgentMarkdown(report);

    expect(report.nextActions[1]).toContain('Do not loosen paper caps for activity');
    expect(report.nextActions.join('\n')).toContain('50/50 paper slots are full');
    expect(report.nextActions.join('\n')).toContain('actual settled evidence is still 0/50');
    expect(markdown).toContain('- Paper slots used / max: 50/50 (0 available)');
  });

  it('adds scheduler cadence when full slots depend on resolution turnover', () => {
    const fullSlots = payload();
    fullSlots.polymarket = {
      ...fullSlots.polymarket,
      openTrades: 50,
      maxOpenTrades: 50,
      openTradeSlotsAvailable: 0,
      openTradeSlotUtilizationPct: 1,
    };

    const report = buildOvernightTradingAgentReport(
      fullSlots,
      [],
      null,
      null,
      null,
      null,
      schedulerCadence(),
    );
    const markdown = formatOvernightTradingAgentMarkdown(report);

    expect(report.nextActions.join('\n')).toContain('Use scheduled resolution turnover while slots are full');
    expect(report.nextActions.join('\n')).toContain('next cache refresh 2027-01-15T08:05:00.000Z');
    expect(markdown).toContain('## Scheduler Cadence');
    expect(markdown).toContain('| Resolution cache refresh | PASS | 2027-01-15T08:05:00.000Z | 2027-01-15T07:50:00.000Z | success |');
    expect(markdown).toContain('- Main-agent overdue tasks: none');
  });

  it('renders quality exception reason codes and samples', () => {
    const qualityPayload = payload();
    qualityPayload.polymarket = {
      ...qualityPayload.polymarket,
      openBookQuality: {
        ...qualityPayload.polymarket.openBookQuality,
        reasons: [
          {
            code: 'ttl_too_short',
            count: 17,
            sampleSlug: 'strait-of-hormuz-traffic-returns-to-normal-by-end-of-june',
            reason: 'ttl_days 0.26 < min 1',
          },
        ],
      },
      approvedSignalQuality: {
        ...qualityPayload.polymarket.approvedSignalQuality,
        status: 'warn',
        state: 'low_confidence_high_edge_watch',
        reasons: [
          {
            code: 'low_confidence_high_edge',
            count: 1,
            sampleSlug: 'elon-musk-of-tweets-june-23-june-30-220-239',
            reason: 'approved signal edge >= 15pp without high confidence',
          },
        ],
      },
    };

    const report = buildOvernightTradingAgentReport(qualityPayload);
    const markdown = formatOvernightTradingAgentMarkdown(report);

    expect(markdown).toContain('## Quality Exceptions');
    expect(markdown).toContain('### Open Book');
    expect(markdown).toContain('| ttl_too_short | 17 | strait-of-hormuz-traffic-returns-to-normal-by-end-of-june | ttl_days 0.26 < min 1 |');
    expect(markdown).toContain('### Approved Signals');
    expect(markdown).toContain('| low_confidence_high_edge | 1 | elon-musk-of-tweets-june-23-june-30-220-239 | approved signal edge >= 15pp without high confidence |');
  });

  it('surfaces overdue resolution-watch items before the generic due-soon queue', () => {
    const report = buildOvernightTradingAgentReport(
      payload(),
      [],
      null,
      null,
      null,
      resolutionWatch(),
    );
    const summary = formatOvernightTradingAgentSummary(report);
    const markdown = formatOvernightTradingAgentMarkdown(report);

    expect(report.nextActions[1]).toContain('inside the 2d resolution grace window');
    expect(summary).toContain('inside the 2d resolution grace window');
    expect(markdown).toContain('## Resolution Watch');
    expect(markdown).toContain('#131 overdue_within_grace');
  });

  it('surfaces failing evidence as a blocker action', () => {
    const report = buildOvernightTradingAgentReport(payload({
      status: 'fail',
      metrics: [
        {
          key: 'polymarket_signal_flow',
          name: 'Polymarket signal flow',
          status: 'fail',
          state: 'no_signals',
          detail: '0 signals in 24h',
        },
      ],
    }));

    expect(report.status).toBe('fail');
    expect(report.nextActions[0]).toContain('Fix failing evidence');
  });

  it('formats Markdown and scheduler summaries without mutating the report', () => {
    const report = buildOvernightTradingAgentReport(payload());
    const markdown = formatOvernightTradingAgentMarkdown(report);
    const summary = formatOvernightTradingAgentSummary(report);

    expect(markdown).toContain('# Overnight Trading Agent Report');
    expect(markdown).toContain('## Gate Decisions');
    expect(markdown).toContain('This report is read-only');
    expect(summary).toContain('Overnight trading agent report');
    expect(summary).toContain('Status: WARN');
  });

  it('renders evidence history with realized P&L separated from mark-to-market', () => {
    const report = buildOvernightTradingAgentReport(payload(), [
      historyPoint({
        snapshotYmd: '2026-06-28',
        polyOpenTrades: 30,
        polyPotentialSettledTrades: 30,
        polyNearTermPotentialSettledTrades: 29,
        polyDueNext7Days: 14,
        polyDueNext30Days: 29,
        polyTotalPnlUsd: -644.63,
        polyPaperEquityUsd: 4355.37,
        polyQualityPassingOpenTrades: 28,
        regimeMinDays: 28,
        equityBenchmarkMinExcessReturn: 0.003,
      }),
      historyPoint(),
    ]);
    const markdown = formatOvernightTradingAgentMarkdown(report);

    expect(markdown).toContain('## Evidence History');
    expect(markdown).toContain('| 2026-06-28 | WARN | 0/50 realized $0.00 | 30/50 | 29/50; due 14/29 | -$644.63 equity $4355.37 | 28/30 | +0.30% | 28/60d positive=yes |');
    expect(markdown).toContain('| 2026-06-29 | WARN | 0/50 realized $0.00 | 50/50 | 49/50; due 35/49 | -$710.08 equity $4289.92 | 33/50 | +0.42% | 29/60d positive=yes |');
  });

  it('includes settlement-impact movement in the report when supplied', () => {
    const settlementImpact: SettlementImpactSummary = {
      generatedAt: NOW,
      horizonDays: 7,
      targetSettledTrades: 50,
      settledTrades: 0,
      dueTrades: 35,
      potentialSettledAfterWindow: 35,
      stillNeededAfterWindow: 15,
      dueExposureUsd: 1569.85,
      dueUnrealizedPnlUsd: -578.2,
      allHeldOutcomesWinPnlUsd: 3631.97,
      allHeldOutcomesLosePnlUsd: -1569.8,
      unknownImpactTrades: 0,
      items: [
        {
          tradeId: 58,
          marketSlug: 'iran-agrees-to-end-enrichment-of-uranium-by-june-30',
          question: 'Iran agrees to end enrichment of uranium by June 30?',
          outcomeLabel: 'Yes',
          endAt: NOW + 3600,
          daysToEnd: 3600 / 86400,
          sizeUsd: 50,
          shares: 121.95,
          entryPrice: 0.41,
          currentPrice: 0.01,
          unrealizedPnlUsd: -49.45,
          winPnlUsd: 71.95,
          lossPnlUsd: -50,
        },
        {
          tradeId: 65,
          marketSlug: 'iran-agrees-to-unrestricted-shipping-through-hormuz-by-june-30',
          question: 'Iran agrees to unrestricted shipping through Hormuz by June 30?',
          outcomeLabel: 'Yes',
          endAt: NOW + 7200,
          daysToEnd: 7200 / 86400,
          sizeUsd: 50,
          shares: 156.25,
          entryPrice: 0.32,
          currentPrice: 0.01,
          unrealizedPnlUsd: -48.75,
          winPnlUsd: 106.25,
          lossPnlUsd: -50,
        },
      ],
      schemaIssues: [],
    };

    const report = buildOvernightTradingAgentReport(payload(), [], settlementImpact);
    const markdown = formatOvernightTradingAgentMarkdown(report);

    expect(report.oneLine).toContain('next 7d max 35/50');
    expect(report.nextActions.join('\n')).toContain('15 additional settled trades would still be needed');
    expect(markdown).toContain('## Settlement Impact');
    expect(markdown).toContain('Potential after window: 35/50');
    expect(markdown).toContain('If held outcomes lose: -$1569.80');
    expect(markdown).toContain('### Due-Window Trades');
    expect(markdown).toContain('| #58 | 2027-01-15 (<1d) | -$49.45 | $71.95 | -$50.00 | $50.00 | iran-agrees-to-end-enrichment-of-uranium-by-june-30 Yes |');
    expect(markdown).toContain('| #65 | 2027-01-15 (<1d) | -$48.75 | $106.25 | -$50.00 | $50.00 | iran-agrees-to-unrestricted-shipping-through-hormuz-by-june-30 Yes |');
  });

  it('includes open MTM concentration in the report when supplied', () => {
    const openMtmDiagnostics: OpenMtmDiagnosticsSummary = {
      generatedAt: NOW,
      openTrades: 50,
      openExposureUsd: 2261.21,
      unrealizedPnlUsd: -702.16,
      openPnlPct: -0.311,
      winners: 9,
      losers: 41,
      flat: 0,
      currentFilterExceptionTrades: 9,
      currentFilterExceptionPnlUsd: -316.81,
      due7dTrades: 35,
      due7dPnlUsd: -673.27,
      lowConfidenceHighEdgeTrades: 1,
      lowConfidenceHighEdgePnlUsd: 6.87,
      buckets: [],
      worstItems: [
        {
          tradeId: 86,
          marketSlug: 'will-bitcoin-reach-67500-in-june-2026-from-june-4',
          question: 'Will Bitcoin reach $67,500 in June?',
          outcomeLabel: 'Yes',
          sizeUsd: 50,
          unrealizedPnlUsd: -49.74,
          openPnlPct: -0.9948,
          currentPrice: 0.01,
          endAt: NOW + 86_400,
          daysToEnd: 1.2,
          filterState: 'pass',
          filterCode: null,
          signalConfidence: 'low',
          signalEdgePct: 8,
        },
        {
          tradeId: 58,
          marketSlug: 'iran-agrees-to-end-enrichment-of-uranium-by-june-30',
          question: 'Iran agrees to end enrichment of uranium by June 30?',
          outcomeLabel: 'Yes',
          sizeUsd: 50,
          unrealizedPnlUsd: -49.45,
          openPnlPct: -0.989,
          currentPrice: 0.01,
          endAt: NOW + 3_600,
          daysToEnd: 3_600 / 86_400,
          filterState: 'exception',
          filterCode: 'ttl_too_short',
          signalConfidence: 'low',
          signalEdgePct: 10,
        },
      ],
      schemaIssues: [],
    };

    const report = buildOvernightTradingAgentReport(payload(), [], null, openMtmDiagnostics);
    const markdown = formatOvernightTradingAgentMarkdown(report);

    expect(report.nextActions.join('\n')).toContain('Review open MTM drag');
    expect(markdown).toContain('## Open MTM Diagnostics');
    expect(markdown).toContain('Current-filter exceptions: 9 trade(s), -$316.81');
    expect(markdown).toContain('Low-confidence high-edge: 1 trade(s), $6.87');
    expect(markdown).toContain('### Worst Open Marks');
    expect(markdown).toContain('| #86 | 2027-01-16 (2d) | -$49.74 (-99.5%) | $50.00 | pass | low 8.0pp | will-bitcoin-reach-67500-in-june-2026-from-june-4 Yes |');
    expect(markdown).toContain('| #58 | 2027-01-15 (<1d) | -$49.45 (-98.9%) | $50.00 | ttl_too_short | low 10.0pp | iran-agrees-to-end-enrichment-of-uranium-by-june-30 Yes |');
  });

  it('includes settled calibration readiness in the overnight report when supplied', () => {
    const settledCalibration: SettledCalibrationSummary = {
      generatedAt: NOW,
      windowStart: null,
      windowEnd: NOW,
      windowLabel: 'all-time',
      targetSettledTrades: 50,
      settledTrades: 0,
      wonTrades: 0,
      lostTrades: 0,
      voidedTrades: 108,
      exitedTrades: 0,
      openTrades: 50,
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
      status: 'warn',
      state: 'waiting_for_settlements',
      verdict: 'Not a Box 2 pass: no won/lost paper trades have settled yet.',
      schemaIssues: [],
    };

    const report = buildOvernightTradingAgentReport(payload(), [], null, null, settledCalibration);
    const markdown = formatOvernightTradingAgentMarkdown(report);

    expect(report.nextActions.join('\n')).toContain('Keep settled calibration on watch');
    expect(markdown).toContain('## Settled Calibration');
    expect(markdown).toContain('Status: WARN waiting_for_settlements');
    expect(markdown).toContain('Brier score: n/a');
  });

  it('includes P&L heartbeat freshness in the overnight report when supplied', () => {
    const pnlHeartbeat: PnlHeartbeatSummary = {
      generatedAt: NOW,
      status: 'warn',
      state: 'stale_positions',
      maxAgeSec: 7200,
      openTrades: 50,
      positionRows: 50,
      freshPositionRows: 47,
      stalePositionRows: 3,
      missingPositionRows: 0,
      newestPositionUpdatedAt: NOW - 300,
      oldestPositionUpdatedAt: NOW - 9000,
      newestPositionAgeSec: 300,
      oldestPositionAgeSec: 9000,
      schemaIssues: [],
    };

    const report = buildOvernightTradingAgentReport(
      payload(),
      [],
      null,
      null,
      null,
      null,
      null,
      pnlHeartbeat,
    );
    const markdown = formatOvernightTradingAgentMarkdown(report);

    expect(report.nextActions.join('\n')).toContain('Investigate P&L heartbeat');
    expect(markdown).toContain('## P&L Heartbeat');
    expect(markdown).toContain('- Status: WARN stale_positions');
    expect(markdown).toContain('- Fresh positions <=120m: 47/50');
    expect(markdown).toContain('- Latest mark: 2027-01-15T07:55:00.000Z (5m ago)');
    expect(markdown).toContain('- Oldest mark: 2027-01-15T05:30:00.000Z (2h 30m ago)');
  });
});
