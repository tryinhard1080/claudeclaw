import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  collectOpenMtmDiagnostics,
  formatOpenMtmDiagnosticsReport,
} from './poly-open-mtm-diagnostics.js';

const NOW = 1_800_000_000;

function db(): Database.Database {
  return new Database(':memory:');
}

describe('Polymarket open MTM diagnostics', () => {
  it('attributes open mark-to-market drag by maturity, filters, and signal quality', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_paper_trades (
        id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        outcome_label TEXT,
        status TEXT NOT NULL,
        size_usd REAL
      );
      CREATE TABLE poly_positions (
        paper_trade_id INTEGER NOT NULL,
        current_price REAL,
        unrealized_pnl REAL
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
        closed INTEGER
      );
      CREATE TABLE poly_signals (
        id INTEGER PRIMARY KEY,
        paper_trade_id INTEGER,
        approved INTEGER NOT NULL,
        confidence TEXT,
        edge_pct REAL
      );
      INSERT INTO poly_paper_trades(id, created_at, market_slug, outcome_label, status, size_usd) VALUES
        (1, ${NOW - 500}, 'due-loss', 'Yes', 'open', 50),
        (2, ${NOW - 400}, 'due-win', 'Yes', 'open', 40),
        (3, ${NOW - 300}, 'too-short', 'Yes', 'open', 25),
        (4, ${NOW - 200}, 'later-loss', 'Yes', 'open', 30),
        (5, ${NOW - 100}, 'closed-win', 'Yes', 'won', 20);
      INSERT INTO poly_positions(paper_trade_id, current_price, unrealized_pnl) VALUES
        (1, 0.10, -45),
        (2, 0.70, 8),
        (3, 0.02, -24),
        (4, 0.20, -12);
      INSERT INTO poly_markets(slug, condition_id, question, category, outcomes_json, volume_24h, liquidity, end_date, closed) VALUES
        ('due-loss', 'c1', 'Due loss?', 'news', '[]', 1000, 1000, ${NOW + 2 * 86400}, 0),
        ('due-win', 'c2', 'Due win?', 'news', '[]', 1000, 1000, ${NOW + 3 * 86400}, 0),
        ('too-short', 'c3', 'Too short?', 'news', '[]', 1000, 1000, ${NOW + 3600}, 0),
        ('later-loss', 'c4', 'Later loss?', 'news', '[]', 1000, 1000, ${NOW + 40 * 86400}, 0);
      INSERT INTO poly_signals(id, paper_trade_id, approved, confidence, edge_pct) VALUES
        (11, 1, 1, 'low', 20),
        (12, 2, 1, 'high', 6),
        (13, 3, 1, 'medium', 8),
        (14, 4, 1, 'low', 10);
    `);

    const summary = collectOpenMtmDiagnostics(mem, {
      nowSec: NOW,
      maxItems: 3,
      ttlFilterEnabled: true,
      marketQualityFilterEnabled: true,
      minTtlDays: 1,
      maxTtlDays: 30,
    });

    expect(summary.openTrades).toBe(4);
    expect(summary.openExposureUsd).toBe(145);
    expect(summary.unrealizedPnlUsd).toBe(-73);
    expect(summary.winners).toBe(1);
    expect(summary.losers).toBe(3);
    expect(summary.currentFilterExceptionTrades).toBe(2);
    expect(summary.currentFilterExceptionPnlUsd).toBe(-36);
    expect(summary.due7dTrades).toBe(3);
    expect(summary.due7dPnlUsd).toBe(-61);
    expect(summary.lowConfidenceHighEdgeTrades).toBe(1);
    expect(summary.lowConfidenceHighEdgePnlUsd).toBe(-45);
    expect(summary.worstItems.map(item => item.marketSlug)).toEqual(['due-loss', 'too-short', 'later-loss']);

    const exceptionBucket = summary.buckets.find(bucket => bucket.code === 'current_filter_exception');
    expect(exceptionBucket).toMatchObject({ count: 2, unrealizedPnlUsd: -36 });

    const report = formatOpenMtmDiagnosticsReport(summary);
    expect(report).toContain('Current-filter exceptions   2 (-$36.00)');
    expect(report).toContain('Low-conf high-edge drag     1 (-$45.00)');
    expect(report).toContain('#1');
    mem.close();
  });

  it('reports missing core tables as schema warnings without throwing', () => {
    const mem = db();

    const summary = collectOpenMtmDiagnostics(mem, { nowSec: NOW });

    expect(summary.schemaIssues).toEqual([
      'poly_paper_trades table missing',
      'poly_positions table missing',
      'poly_markets table missing',
    ]);
    expect(summary.openTrades).toBe(0);
    expect(formatOpenMtmDiagnosticsReport(summary)).toContain('Schema warnings');
    mem.close();
  });
});
