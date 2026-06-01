import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  collectOperationalEvidence,
  collectPolymarketEvidence,
  collectRegimeSharpeEvidence,
  collectTtlFilterEvidence,
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
    `);

    const evidence = collectPolymarketEvidence(mem, NOW);

    expect(evidence.settledTrades).toBe(2);
    expect(evidence.realizedPnlUsd).toBe(8);
    expect(evidence.openTrades).toBe(3);
    expect(evidence.voidedTrades).toBe(1);
    expect(evidence.openExposureUsd).toBe(65);
    expect(evidence.dueNext7Days).toBe(1);
    expect(evidence.dueNext30Days).toBe(2);
    expect(evidence.overdueOpenTrades).toBe(1);
    expect(evidence.approvedSignals24h).toBe(1);
    mem.close();
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
        ('spy-aggressive', 12, 1.1, 2),
        ('spy-conservative', 11, 0.9, 2);
    `);

    const evidence = collectRegimeSharpeEvidence(mem);

    expect(evidence.instances).toHaveLength(2);
    expect(evidence.minDays).toBe(11);
    expect(evidence.allInstancesPositive).toBe(true);
    expect(evidence.allInstancesComplete).toBe(false);
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
        n_days INTEGER NOT NULL,
        rolling_sharpe_60d REAL,
        created_at INTEGER NOT NULL
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
      INSERT INTO poly_paper_trades(created_at, market_slug, status, size_usd, realized_pnl) VALUES
        (${NOW - 100}, 'open-soon', 'open', 50, NULL);
      INSERT INTO poly_markets(slug, end_date) VALUES ('open-soon', ${NOW + 86400});
      INSERT INTO poly_signals(created_at, approved) VALUES (${NOW - 90}, 1);
      INSERT INTO regime_sharpe_snapshots(instance, n_days, rolling_sharpe_60d, created_at) VALUES
        ('spy-aggressive', 8, 1.2, ${NOW - 30});
      INSERT INTO poly_ttl_shadow_ticks VALUES (${NOW - 30}, 8, 1, 18, 130, 1, 30);
    `);

    const payload = collectOperationalEvidence(mem, NOW);

    expect(payload.status).toBe('warn');
    expect(payload.metrics.map(metric => metric.key)).toContain('polymarket_resolution_pipeline');
    expect(payload.metrics.find(metric => metric.key === 'polymarket_signal_flow')?.status).toBe('pass');
    expect(payload.metrics.find(metric => metric.key === 'regime_sharpe_track')?.current).toBe(8);
    mem.close();
  });

  it('handles missing evidence tables as explicit incomplete states', () => {
    const mem = db();

    const payload = collectOperationalEvidence(mem, NOW);

    expect(payload.polymarket.settledTrades).toBe(0);
    expect(payload.regimeSharpe.instances).toEqual([]);
    expect(payload.ttlFilter.latestAt).toBeNull();
    expect(payload.metrics.find(metric => metric.key === 'polymarket_signal_flow')?.status).toBe('fail');
    mem.close();
  });
});
