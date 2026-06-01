import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  collectApprovedSignalQualityEvidence,
  collectEquityBenchmarkEvidence,
  collectEquitySyncEvidence,
  collectMarketDiscoveryEvidence,
  collectOpenBookQualityEvidence,
  collectOperationalEvidence,
  collectPolymarketEvidence,
  collectRegimeSharpeEvidence,
  collectTtlFilterEvidence,
  readOperationalEvidenceHistory,
  recordOperationalEvidenceSnapshot,
} from './evidence.js';

const NOW = 1_800_000_000;

function db(): Database.Database {
  return new Database(':memory:');
}

describe('operational evidence', () => {
  it('tracks Polymarket settlement progress and near-term maturity pipeline', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_paper_trades (
        id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        status TEXT NOT NULL,
        size_usd REAL,
        realized_pnl REAL
      );
      CREATE TABLE poly_markets (
        slug TEXT PRIMARY KEY,
        end_date INTEGER NOT NULL
      );
      CREATE TABLE poly_signals (
        created_at INTEGER NOT NULL,
        approved INTEGER NOT NULL
      );
      CREATE TABLE poly_positions (
        paper_trade_id INTEGER NOT NULL,
        unrealized_pnl REAL NOT NULL
      );
      INSERT INTO poly_paper_trades(id, created_at, market_slug, status, size_usd, realized_pnl) VALUES
        (1, ${NOW - 900}, 'settled-win', 'won', 50, 12),
        (2, ${NOW - 800}, 'settled-loss', 'lost', 50, -4),
        (3, ${NOW - 700}, 'open-soon', 'open', 25, NULL),
        (4, ${NOW - 600}, 'open-month', 'open', 30, NULL),
        (5, ${NOW - 500}, 'open-overdue', 'open', 10, NULL),
        (6, ${NOW - 400}, 'voided', 'voided', 15, 0);
      INSERT INTO poly_markets(slug, end_date) VALUES
        ('open-soon', ${NOW + 3 * 86400}),
        ('open-month', ${NOW + 20 * 86400}),
        ('open-overdue', ${NOW - 3600});
      INSERT INTO poly_signals(created_at, approved) VALUES
        (${NOW - 60}, 1),
        (${NOW - 120}, 0);
      INSERT INTO poly_positions(paper_trade_id, unrealized_pnl) VALUES
        (3, 5),
        (4, -2),
        (5, 1);
    `);

    const evidence = collectPolymarketEvidence(mem, NOW);

    expect(evidence.settledTrades).toBe(2);
    expect(evidence.realizedPnlUsd).toBe(8);
    expect(evidence.unrealizedPnlUsd).toBe(4);
    expect(evidence.totalPnlUsd).toBe(12);
    expect(evidence.paperEquityUsd).toBe(5012);
    expect(evidence.openPnlPct).toBeCloseTo(4 / 65, 6);
    expect(evidence.openTrades).toBe(3);
    expect(evidence.voidedTrades).toBe(1);
    expect(evidence.openExposureUsd).toBe(65);
    expect(evidence.potentialSettledTrades).toBe(5);
    expect(evidence.remainingSettledTrades).toBe(48);
    expect(evidence.additionalSettledTradesNeeded).toBe(45);
    expect(evidence.openPipelineCanReachTarget).toBe(false);
    expect(evidence.openPipelineCoveragePct).toBe(0.1);
    expect(evidence.nearTermPotentialSettledTrades).toBe(4);
    expect(evidence.additionalNearTermSettledTradesNeeded).toBe(46);
    expect(evidence.nearTermPipelineCanReachTarget).toBe(false);
    expect(evidence.nearTermPipelineCoveragePct).toBe(0.08);
    expect(evidence.paperTradesOpened24h).toBe(5);
    expect(evidence.nearTermPaperTradesOpened24h).toBe(2);
    expect(evidence.dailyNearTermTradeTarget30d).toBeCloseTo(46 / 30, 6);
    expect(evidence.nearTermPipelineFillDaysAt24hRate).toBe(23);
    expect(evidence.nearTermPipelineFillEtaAt).toBe(NOW + 23 * 86400);
    expect(evidence.nearTermVelocityState).toBe('near_term_on_pace');
    expect(evidence.dueNext7Days).toBe(1);
    expect(evidence.dueNext30Days).toBe(2);
    expect(evidence.overdueOpenTrades).toBe(1);
    expect(evidence.approvedSignals24h).toBe(1);
    expect(evidence.approvalRate24h).toBe(0.5);
    expect(evidence.resolutionQueue.map(row => row.marketSlug)).toEqual([
      'open-overdue',
      'open-soon',
      'open-month',
    ]);
    expect(evidence.resolutionQueue[0]).toMatchObject({
      tradeId: 5,
      state: 'overdue',
      sizeUsd: 10,
      unrealizedPnlUsd: 1,
    });
    expect(evidence.resolutionQueue[1]).toMatchObject({
      state: 'due_7d',
      openPnlPct: 5 / 25,
    });
    expect(evidence.resolutionQueue[2]).toMatchObject({
      state: 'due_30d',
      daysToEnd: 20,
    });
    mem.close();
  });

  it('summarizes live equity state sync from regime-trader state files', () => {
    const evidence = collectEquitySyncEvidence(NOW, {
      instanceNames: ['spy-aggressive', 'spy-conservative'],
      freshSec: 900,
      readState: (instance) => ({
        raw: JSON.stringify({
          market_open: true,
          equity: instance === 'spy-aggressive' ? 101000 : 100500,
          regime: { label: 'WEAK_BULL' },
          risk: { max_exposure: 1 },
        }),
        mtimeMs: (NOW - (instance === 'spy-aggressive' ? 30 : 60)) * 1000,
      }),
    });

    expect(evidence.status).toBe('pass');
    expect(evidence.freshCount).toBe(2);
    expect(evidence.allOpenFull).toBe(true);
    expect(evidence.maxAgeSec).toBe(60);
    expect(evidence.instances.map(row => row.state)).toEqual(['fresh_open_full', 'fresh_open_full']);
  });

  it('warns when one equity state file is stale or partial', () => {
    const evidence = collectEquitySyncEvidence(NOW, {
      instanceNames: ['spy-aggressive', 'spy-conservative'],
      freshSec: 900,
      readState: (instance) => ({
        raw: JSON.stringify({
          market_open: true,
          equity: 100000,
          regime: instance === 'spy-aggressive' ? { label: 'WEAK_BULL' } : null,
          risk: { max_exposure: 1 },
        }),
        mtimeMs: (NOW - (instance === 'spy-aggressive' ? 30 : 1200)) * 1000,
      }),
    });

    expect(evidence.status).toBe('warn');
    expect(evidence.freshCount).toBe(1);
    expect(evidence.instances[1]!.state).toBe('stale');
  });

  it('summarizes latest regime Sharpe snapshots per instance', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE regime_sharpe_snapshots (
        instance TEXT NOT NULL,
        n_days INTEGER NOT NULL,
        rolling_sharpe_60d REAL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO regime_sharpe_snapshots(instance, n_days, rolling_sharpe_60d, created_at) VALUES
        ('spy-aggressive', 10, 0.7, 1),
        ('spy-aggressive', 12, 1.1, 2000),
        ('spy-conservative', 11, 0.9, 2);
    `);

    const evidence = collectRegimeSharpeEvidence(mem);

    expect(evidence.instances).toHaveLength(2);
    expect(evidence.minDays).toBe(11);
    expect(evidence.instances.find(row => row.instance === 'spy-aggressive')?.createdAt).toBe(2000);
    expect(evidence.allInstancesPositive).toBe(true);
    expect(evidence.allInstancesComplete).toBe(false);
    mem.close();
  });

  it('compares equity curve returns against the benchmark track', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE equity_benchmark_snapshots (
        benchmark TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        equity REAL NOT NULL,
        daily_return REAL
      );
      CREATE TABLE regime_sharpe_snapshots (
        instance TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        equity REAL NOT NULL,
        daily_return REAL
      );
      INSERT INTO equity_benchmark_snapshots(benchmark, snapshot_date, equity, daily_return) VALUES
        ('SPY', '2026-05-30', 100000, NULL),
        ('SPY', '2026-05-31', 103000, 0.03);
      INSERT INTO regime_sharpe_snapshots(instance, snapshot_date, equity, daily_return) VALUES
        ('spy-aggressive', '2026-05-30', 100000, NULL),
        ('spy-aggressive', '2026-05-31', 106000, 0.06),
        ('spy-conservative', '2026-05-30', 100000, NULL),
        ('spy-conservative', '2026-05-31', 104000, 0.04);
    `);

    const evidence = collectEquityBenchmarkEvidence(mem);

    expect(evidence.status).toBe('pass');
    expect(evidence.benchmark).toBe('SPY');
    expect(evidence.instances).toHaveLength(2);
    expect(evidence.allOutperforming).toBe(true);
    expect(evidence.minExcessReturn).toBeCloseTo(0.01, 6);
    expect(evidence.instances.find(row => row.instance === 'spy-aggressive')?.excessReturn).toBeCloseTo(0.03, 6);
    mem.close();
  });

  it('normalizes millisecond regime Sharpe snapshot timestamps to seconds', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE regime_sharpe_snapshots (
        instance TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        equity REAL NOT NULL,
        daily_return REAL,
        n_days INTEGER NOT NULL,
        rolling_sharpe_60d REAL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO regime_sharpe_snapshots(instance, snapshot_date, equity, daily_return, n_days, rolling_sharpe_60d, created_at) VALUES
        ('spy-aggressive', '2026-05-31', 100000, NULL, 8, 1.2, ${NOW * 1000 + 123});
    `);

    const evidence = collectRegimeSharpeEvidence(mem);

    expect(evidence.instances[0]!.createdAt).toBe(NOW);
    mem.close();
  });

  it('reads the latest TTL filter tick', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_ttl_shadow_ticks (
        scan_tick_at INTEGER NOT NULL,
        candidates_total INTEGER NOT NULL,
        candidates_ttl_pass INTEGER NOT NULL,
        avg_ttl_pass REAL,
        avg_ttl_filtered REAL,
        band_min_days REAL,
        band_max_days REAL
      );
      INSERT INTO poly_ttl_shadow_ticks VALUES
        (${NOW - 900}, 20, 1, 14, 120, 1, 30),
        (${NOW - 60}, 10, 2, 20, 140, 1, 30);
    `);

    const evidence = collectTtlFilterEvidence(mem, NOW);

    expect(evidence.ageSec).toBe(60);
    expect(evidence.candidatesTotal).toBe(10);
    expect(evidence.candidatesTtlPass).toBe(2);
    expect(evidence.passRate).toBe(0.2);
    mem.close();
  });

  it('tracks market discovery depth from the latest successful scan', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_scan_runs (
        started_at INTEGER NOT NULL,
        duration_ms INTEGER,
        market_count INTEGER,
        status TEXT NOT NULL
      );
      INSERT INTO poly_scan_runs VALUES
        (${NOW - 300}, 111, 100, 'ok'),
        (${NOW - 60}, 356, 992, 'ok');
    `);

    const evidence = collectMarketDiscoveryEvidence(mem, NOW);

    expect(evidence.status).toBe('pass');
    expect(evidence.state).toBe('healthy');
    expect(evidence.marketCount).toBe(992);
    expect(evidence.targetMarketCount).toBe(500);
    expect(evidence.durationMs).toBe(356);
    mem.close();
  });

  it('audits open paper trades against current paper-learning filters', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_paper_trades (
        id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        status TEXT NOT NULL,
        size_usd REAL
      );
      CREATE TABLE poly_markets (
        slug TEXT PRIMARY KEY,
        condition_id TEXT,
        question TEXT,
        category TEXT,
        outcomes_json TEXT,
        volume_24h REAL,
        liquidity REAL,
        end_date INTEGER NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO poly_paper_trades(id, created_at, market_slug, status, size_usd) VALUES
        (1, ${NOW - 100}, 'valid-near-term', 'open', 50),
        (2, ${NOW - 90}, 'long-dated', 'open', 50),
        (3, ${NOW - 80}, 'prophecy-market', 'open', 50),
        (4, ${NOW - 70}, 'missing-market', 'open', 50);
      INSERT INTO poly_markets(slug, condition_id, question, category, outcomes_json, volume_24h, liquidity, end_date, closed) VALUES
        ('valid-near-term', 'c1', 'Will a sourced event happen by the end date?', 'news', '[]', 5000, 1000, ${NOW + 5 * 86400}, 0),
        ('long-dated', 'c2', 'Will a sourced event happen next year?', 'news', '[]', 5000, 1000, ${NOW + 90 * 86400}, 0),
        ('prophecy-market', 'c3', 'Will Jesus Christ return before the end date?', 'culture', '[]', 5000, 1000, ${NOW + 5 * 86400}, 0);
    `);

    const evidence = collectOpenBookQualityEvidence(mem, NOW, {
      ttlFilterEnabled: true,
      minTtlDays: 1,
      maxTtlDays: 30,
      marketQualityFilterEnabled: true,
    });

    expect(evidence.status).toBe('warn');
    expect(evidence.state).toBe('legacy_filter_exceptions');
    expect(evidence.openTrades).toBe(4);
    expect(evidence.evaluatedTrades).toBe(3);
    expect(evidence.passingTrades).toBe(1);
    expect(evidence.failingTrades).toBe(2);
    expect(evidence.missingMetadataTrades).toBe(1);
    expect(evidence.reasons.map(reason => reason.code).sort()).toEqual([
      'missing_market_metadata',
      'ttl_too_long',
      'untradeable_question',
    ]);
    mem.close();
  });

  it('audits approved Polymarket signal quality without mutating trades', () => {
    const mem = db();
    const freshContext = JSON.stringify({ allRequiredFresh: true, sources: [] });
    const staleContext = JSON.stringify({ allRequiredFresh: false, sources: [] });
    mem.exec(`
      CREATE TABLE poly_signals (
        id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        outcome_token_id TEXT NOT NULL,
        outcome_label TEXT NOT NULL,
        market_price REAL NOT NULL,
        estimated_prob REAL NOT NULL,
        edge_pct REAL NOT NULL,
        confidence TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        approved INTEGER NOT NULL,
        paper_trade_id INTEGER,
        source_context_json TEXT
      );
    `);
    const insert = mem.prepare(`
      INSERT INTO poly_signals (
        id, created_at, market_slug, outcome_token_id, outcome_label,
        market_price, estimated_prob, edge_pct, confidence, reasoning,
        approved, paper_trade_id, source_context_json
      ) VALUES (?, ?, ?, 'tok', 'Yes', ?, ?, ?, ?, 'r', 1, ?, ?)
    `);
    insert.run(1, NOW - 10, 'clean', 0.40, 0.50, 10, 'high', 101, freshContext);
    insert.run(2, NOW - 20, 'stale-source', 0.30, 0.39, 9, 'medium', 102, staleContext);
    insert.run(3, NOW - 30, 'missing-source', 0.20, 0.38, 18, 'low', 103, null);
    insert.run(4, NOW - 40, 'invalid-edge', 0.70, 0.69, -1, 'high', 104, freshContext);
    insert.run(5, NOW - 2 * 86400, 'old', 0.40, 0.50, 10, 'high', 105, freshContext);

    const evidence = collectApprovedSignalQualityEvidence(mem, NOW);

    expect(evidence.status).toBe('fail');
    expect(evidence.state).toBe('invalid_approved_signal');
    expect(evidence.approvedSignals24h).toBe(4);
    expect(evidence.linkedPaperTradeSignals24h).toBe(4);
    expect(evidence.sourceFreshSignals24h).toBe(2);
    expect(evidence.staleSourceContextSignals24h).toBe(1);
    expect(evidence.missingSourceContextSignals24h).toBe(1);
    expect(evidence.invalidApprovedSignals24h).toBeGreaterThan(0);
    expect(evidence.lowConfidenceHighEdgeSignals24h).toBe(1);
    expect(evidence.reasons.map(reason => reason.code)).toContain('stale_source_context');
    expect(evidence.reasons.map(reason => reason.code)).toContain('missing_source_context');
    expect(evidence.reasons.map(reason => reason.code)).toContain('low_confidence_high_edge');
    mem.close();
  });

  it('warns when market discovery falls back to the old first-page cap', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_scan_runs (
        started_at INTEGER NOT NULL,
        duration_ms INTEGER,
        market_count INTEGER,
        status TEXT NOT NULL
      );
      INSERT INTO poly_scan_runs VALUES (${NOW - 60}, 120, 100, 'ok');
    `);

    const evidence = collectMarketDiscoveryEvidence(mem, NOW);

    expect(evidence.status).toBe('warn');
    expect(evidence.state).toBe('first_page_capped');
    mem.close();
  });

  it('builds dashboard-ready metrics without mutating trading state', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_paper_trades (
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        status TEXT NOT NULL,
        size_usd REAL,
        realized_pnl REAL
      );
      CREATE TABLE poly_markets (slug TEXT PRIMARY KEY, end_date INTEGER NOT NULL);
      CREATE TABLE poly_signals (created_at INTEGER NOT NULL, approved INTEGER NOT NULL);
      CREATE TABLE regime_sharpe_snapshots (
        instance TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        equity REAL NOT NULL,
        daily_return REAL,
        n_days INTEGER NOT NULL,
        rolling_sharpe_60d REAL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE equity_benchmark_snapshots (
        benchmark TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        equity REAL NOT NULL,
        daily_return REAL
      );
      CREATE TABLE poly_ttl_shadow_ticks (
        scan_tick_at INTEGER NOT NULL,
        candidates_total INTEGER NOT NULL,
        candidates_ttl_pass INTEGER NOT NULL,
        avg_ttl_pass REAL,
        avg_ttl_filtered REAL,
        band_min_days REAL,
        band_max_days REAL
      );
      CREATE TABLE poly_scan_runs (
        started_at INTEGER NOT NULL,
        duration_ms INTEGER,
        market_count INTEGER,
        status TEXT NOT NULL
      );
      INSERT INTO poly_paper_trades(created_at, market_slug, status, size_usd, realized_pnl) VALUES
        (${NOW - 100}, 'open-soon', 'open', 50, NULL);
      INSERT INTO poly_markets(slug, end_date) VALUES ('open-soon', ${NOW + 2 * 86400});
      INSERT INTO poly_signals(created_at, approved) VALUES (${NOW - 90}, 1);
      INSERT INTO regime_sharpe_snapshots(instance, snapshot_date, equity, daily_return, n_days, rolling_sharpe_60d, created_at) VALUES
        ('spy-aggressive', '2026-05-30', 100000, NULL, 7, 1.1, ${NOW - 86400}),
        ('spy-aggressive', '2026-05-31', 104000, 0.04, 8, 1.2, ${NOW - 30});
      INSERT INTO equity_benchmark_snapshots(benchmark, snapshot_date, equity, daily_return) VALUES
        ('SPY', '2026-05-30', 100000, NULL),
        ('SPY', '2026-05-31', 101000, 0.01);
      INSERT INTO poly_ttl_shadow_ticks VALUES (${NOW - 30}, 8, 1, 18, 130, 1, 30);
      INSERT INTO poly_scan_runs VALUES (${NOW - 30}, 356, 992, 'ok');
    `);

    const payload = collectOperationalEvidence(mem, NOW, {
      collectEquityBenchmark: true,
      equitySync: {
        instances: [
          {
            instance: 'spy-aggressive',
            state: 'fresh_open_full',
            syncedAt: NOW - 30,
            ageSec: 30,
            marketOpen: true,
            hasRegime: true,
            hasRisk: true,
            equity: 101000,
            error: null,
          },
          {
            instance: 'spy-conservative',
            state: 'fresh_open_full',
            syncedAt: NOW - 30,
            ageSec: 30,
            marketOpen: true,
            hasRegime: true,
            hasRisk: true,
            equity: 100500,
            error: null,
          },
        ],
        expectedCount: 2,
        freshCount: 2,
        latestAt: NOW - 30,
        maxAgeSec: 30,
        allFresh: true,
        allOpenFull: true,
        status: 'pass',
        summary: 'spy-aggressive fresh_open_full 30s; spy-conservative fresh_open_full 30s',
      },
    });

    expect(payload.status).toBe('warn');
    expect(payload.metrics.map(metric => metric.key)).toContain('polymarket_resolution_pipeline');
    expect(payload.metrics.find(metric => metric.key === 'polymarket_box2_pipeline_capacity')).toMatchObject({
      status: 'warn',
      state: 'open_book_underfilled',
      current: 1,
      target: 50,
    });
    expect(payload.metrics.find(metric => metric.key === 'polymarket_near_term_box2_capacity')).toMatchObject({
      status: 'warn',
      state: 'near_term_underfilled',
      current: 1,
      target: 50,
    });
    expect(payload.metrics.find(metric => metric.key === 'polymarket_box2_learning_velocity')).toMatchObject({
      status: 'warn',
      state: 'near_term_below_pace',
      current: 1,
      target: 2,
    });
    expect(payload.metrics.find(metric => metric.key === 'equity_state_sync')?.status).toBe('pass');
    expect(payload.metrics.find(metric => metric.key === 'equity_benchmark_edge')?.status).toBe('pass');
    expect(payload.equityBenchmark?.minExcessReturn).toBeCloseTo(0.03, 6);
    expect(payload.metrics.find(metric => metric.key === 'polymarket_mark_to_market')?.status).toBe('pass');
    expect(payload.metrics.find(metric => metric.key === 'polymarket_open_book_quality')).toMatchObject({
      status: 'pass',
      state: 'all_inside_current_filters',
      current: 1,
      target: 1,
    });
    expect(payload.metrics.find(metric => metric.key === 'polymarket_signal_flow')?.status).toBe('pass');
    expect(payload.metrics.map(metric => metric.key)).toContain('polymarket_approved_signal_quality');
    expect(payload.metrics.find(metric => metric.key === 'polymarket_market_discovery')).toMatchObject({
      status: 'pass',
      state: 'healthy',
      current: 992,
      target: 500,
    });
    expect(payload.metrics.find(metric => metric.key === 'regime_sharpe_track')?.current).toBe(8);
    mem.close();
  });

  it('handles missing evidence tables as explicit incomplete states', () => {
    const mem = db();

    const payload = collectOperationalEvidence(mem, NOW);

    expect(payload.polymarket.settledTrades).toBe(0);
    expect(payload.polymarket.additionalSettledTradesNeeded).toBe(50);
    expect(payload.polymarket.additionalNearTermSettledTradesNeeded).toBe(50);
    expect(payload.polymarket.nearTermVelocityState).toBe('missing_maturity_data');
    expect(payload.regimeSharpe.instances).toEqual([]);
    expect(payload.ttlFilter.latestAt).toBeNull();
    expect(payload.metrics.find(metric => metric.key === 'polymarket_signal_flow')?.status).toBe('fail');
    expect(payload.metrics.find(metric => metric.key === 'polymarket_market_discovery')?.status).toBe('fail');
    mem.close();
  });

  it('records one upserted evidence snapshot per UTC day and reads history oldest first', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_paper_trades (
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        status TEXT NOT NULL,
        size_usd REAL,
        realized_pnl REAL
      );
      CREATE TABLE poly_markets (slug TEXT PRIMARY KEY, end_date INTEGER NOT NULL);
      CREATE TABLE poly_signals (created_at INTEGER NOT NULL, approved INTEGER NOT NULL);
      CREATE TABLE regime_sharpe_snapshots (
        instance TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        equity REAL NOT NULL,
        daily_return REAL,
        n_days INTEGER NOT NULL,
        rolling_sharpe_60d REAL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE equity_benchmark_snapshots (
        benchmark TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        equity REAL NOT NULL,
        daily_return REAL
      );
      CREATE TABLE poly_ttl_shadow_ticks (
        scan_tick_at INTEGER NOT NULL,
        candidates_total INTEGER NOT NULL,
        candidates_ttl_pass INTEGER NOT NULL,
        avg_ttl_pass REAL,
        avg_ttl_filtered REAL,
        band_min_days REAL,
        band_max_days REAL
      );
      CREATE TABLE poly_scan_runs (
        started_at INTEGER NOT NULL,
        duration_ms INTEGER,
        market_count INTEGER,
        status TEXT NOT NULL
      );
      INSERT INTO poly_paper_trades(created_at, market_slug, status, size_usd, realized_pnl) VALUES
        (${NOW - 100}, 'open-soon', 'open', 50, NULL);
      INSERT INTO poly_markets(slug, end_date) VALUES ('open-soon', ${NOW + 2 * 86400});
      INSERT INTO poly_signals(created_at, approved) VALUES (${NOW - 90}, 1);
      INSERT INTO regime_sharpe_snapshots(instance, snapshot_date, equity, daily_return, n_days, rolling_sharpe_60d, created_at) VALUES
        ('spy-aggressive', '2026-05-30', 100000, NULL, 7, 1.1, ${NOW - 86400}),
        ('spy-aggressive', '2026-05-31', 104000, 0.04, 8, 1.2, ${NOW - 30});
      INSERT INTO equity_benchmark_snapshots(benchmark, snapshot_date, equity, daily_return) VALUES
        ('SPY', '2026-05-30', 100000, NULL),
        ('SPY', '2026-05-31', 101000, 0.01);
      INSERT INTO poly_ttl_shadow_ticks VALUES (${NOW - 30}, 8, 1, 18, 130, 1, 30);
      INSERT INTO poly_scan_runs VALUES (${NOW - 30}, 356, 992, 'ok');
    `);

    const firstPayload = collectOperationalEvidence(mem, NOW, { collectEquityBenchmark: true });
    const firstYmd = recordOperationalEvidenceSnapshot(mem, firstPayload);
    const secondPayload = collectOperationalEvidence(mem, NOW + 60, { collectEquityBenchmark: true });
    const secondYmd = recordOperationalEvidenceSnapshot(mem, secondPayload);
    recordOperationalEvidenceSnapshot(mem, collectOperationalEvidence(mem, NOW + 86400, { collectEquityBenchmark: true }));

    const history = readOperationalEvidenceHistory(mem, 10);

    expect(firstYmd).toBe(secondYmd);
    expect(history).toHaveLength(2);
    expect(history[0]!.snapshotYmd).toBe(firstYmd);
    expect(history[0]!.capturedAt).toBe(NOW + 60);
    expect(history[0]!.polyOpenTrades).toBe(1);
    expect(history[0]!.polyPotentialSettledTrades).toBe(1);
    expect(history[0]!.polyAdditionalSettledTradesNeeded).toBe(49);
    expect(history[0]!.polyNearTermPotentialSettledTrades).toBe(1);
    expect(history[0]!.polyAdditionalNearTermSettledTradesNeeded).toBe(49);
    expect(history[0]!.polyPaperTradesOpened24h).toBe(1);
    expect(history[0]!.polyNearTermPaperTradesOpened24h).toBe(1);
    expect(history[0]!.polyDailyNearTermTradeTarget30d).toBeCloseTo(49 / 30, 6);
    expect(history[0]!.polyNearTermFillDaysAt24hRate).toBe(49);
    expect(history[0]!.polyTotalPnlUsd).toBe(0);
    expect(history[0]!.polyPaperEquityUsd).toBe(5000);
    expect(history[0]!.polyApprovalRate24h).toBe(1);
    expect(history[0]!.equitySyncFreshCount).toBe(0);
    expect(history[0]!.equitySyncExpectedCount).toBe(0);
    expect(history[0]!.equityBenchmarkMinExcessReturn).toBeCloseTo(0.03, 6);
    expect(history[0]!.equityBenchmarkAllOutperforming).toBe(true);
    expect(history[0]!.equityBenchmarkInstanceCount).toBe(1);
    expect(history[0]!.regimeMinDays).toBe(8);
    expect(history[0]!.polyMarketDiscoveryCount).toBe(992);
    expect(history[0]!.polyMarketDiscoveryTarget).toBe(500);
    expect(history[0]!.polyMarketDiscoveryAgeSec).toBe(90);
    expect(history[0]!.polyQualityPassingOpenTrades).toBe(1);
    expect(history[0]!.polyQualityFailingOpenTrades).toBe(0);
    expect(history[0]!.polyQualityMissingMetadataTrades).toBe(0);
    expect(history[1]!.snapshotYmd).not.toBe(firstYmd);
    mem.close();
  });
});
