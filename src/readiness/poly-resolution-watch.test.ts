import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  collectResolutionWatch,
  formatResolutionWatchReport,
} from './poly-resolution-watch.js';

const NOW = 1_800_000_000;
const DAY = 86_400;

function db(): Database.Database {
  const mem = new Database(':memory:');
  mem.exec(`
    CREATE TABLE poly_paper_trades (
      id INTEGER PRIMARY KEY,
      created_at INTEGER NOT NULL,
      market_slug TEXT NOT NULL,
      outcome_label TEXT,
      status TEXT NOT NULL,
      size_usd REAL
    );
    CREATE TABLE poly_markets (
      slug TEXT PRIMARY KEY,
      question TEXT,
      end_date INTEGER
    );
    CREATE TABLE poly_resolutions (
      slug TEXT PRIMARY KEY,
      closed INTEGER,
      fetched_at INTEGER,
      resolved_at INTEGER
    );
    CREATE TABLE poly_positions (
      paper_trade_id INTEGER NOT NULL,
      current_price REAL,
      unrealized_pnl REAL
    );
  `);
  return mem;
}

describe('Polymarket resolution watch', () => {
  it('passes when there are no open paper trades', () => {
    const mem = db();
    mem.exec(`
      INSERT INTO poly_paper_trades(id, created_at, market_slug, status) VALUES
        (1, ${NOW - DAY}, 'settled', 'won');
    `);

    const summary = collectResolutionWatch(mem, { nowSec: NOW });

    expect(summary.status).toBe('pass');
    expect(summary.openTrades).toBe(0);
    expect(summary.items).toEqual([]);
  });

  it('fails when core resolution schema is missing', () => {
    const mem = new Database(':memory:');
    mem.exec(`
      CREATE TABLE poly_paper_trades (
        id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        status TEXT NOT NULL
      );
      INSERT INTO poly_paper_trades(id, created_at, market_slug, status) VALUES
        (1, ${NOW - DAY}, 'open-without-schema', 'open');
    `);

    const summary = collectResolutionWatch(mem, { nowSec: NOW });

    expect(summary.status).toBe('fail');
    expect(summary.schemaIssues).toEqual([
      'poly_markets table missing',
      'poly_resolutions table missing',
    ]);
  });

  it('fails when an open trade is overdue beyond grace or cache says closed', () => {
    const mem = db();
    mem.exec(`
      INSERT INTO poly_paper_trades(id, created_at, market_slug, outcome_label, status) VALUES
        (1, ${NOW - 10 * DAY}, 'old-open', 'Yes', 'open'),
        (2, ${NOW - DAY}, 'cache-closed', 'No', 'open');
      INSERT INTO poly_markets(slug, question, end_date) VALUES
        ('old-open', 'Old open?', ${NOW - 4 * DAY}),
        ('cache-closed', 'Cache says closed?', ${NOW + 5 * DAY});
      INSERT INTO poly_resolutions(slug, closed, fetched_at, resolved_at) VALUES
        ('old-open', 0, ${NOW - 300}, NULL),
        ('cache-closed', 1, ${NOW - 120}, ${NOW - 60});
    `);

    const summary = collectResolutionWatch(mem, { nowSec: NOW, overdueGraceDays: 2 });

    expect(summary.status).toBe('fail');
    expect(summary.overdueBeyondGraceTrades).toBe(1);
    expect(summary.closedCacheStillOpenTrades).toBe(1);
    expect(summary.items.map(item => item.state)).toEqual([
      'overdue_beyond_grace',
      'closed_cache_still_open',
    ]);
  });

  it('warns for missing maturity metadata and overdue trades inside grace', () => {
    const mem = db();
    mem.exec(`
      INSERT INTO poly_paper_trades(id, created_at, market_slug, status) VALUES
        (1, ${NOW - DAY}, 'missing-market', 'open'),
        (2, ${NOW - DAY}, 'unknown-end', 'open'),
        (3, ${NOW - DAY}, 'inside-grace', 'open');
      INSERT INTO poly_markets(slug, question, end_date) VALUES
        ('unknown-end', 'No end date?', NULL),
        ('inside-grace', 'Recently ended?', ${NOW - 3600});
    `);

    const summary = collectResolutionWatch(mem, { nowSec: NOW, overdueGraceDays: 2 });

    expect(summary.status).toBe('warn');
    expect(summary.missingMarketRows).toBe(1);
    expect(summary.unknownEndDateTrades).toBe(1);
    expect(summary.overdueTrades).toBe(1);
    expect(summary.overdueBeyondGraceTrades).toBe(0);
  });

  it('counts the full due window even when displayed items are capped', () => {
    const mem = db();
    mem.exec(`
      INSERT INTO poly_paper_trades(id, created_at, market_slug, status) VALUES
        (1, ${NOW - DAY}, 'due-1', 'open'),
        (2, ${NOW - DAY}, 'due-2', 'open'),
        (3, ${NOW - DAY}, 'due-3', 'open');
      INSERT INTO poly_markets(slug, question, end_date) VALUES
        ('due-1', 'Due 1?', ${NOW + DAY}),
        ('due-2', 'Due 2?', ${NOW + 2 * DAY}),
        ('due-3', 'Due 3?', ${NOW + 3 * DAY});
      INSERT INTO poly_resolutions(slug, closed, fetched_at, resolved_at) VALUES
        ('due-1', 0, ${NOW - 300}, NULL),
        ('due-2', 0, ${NOW - 300}, NULL),
        ('due-3', 0, ${NOW - 300}, NULL);
    `);

    const summary = collectResolutionWatch(mem, { nowSec: NOW, maxItems: 1 });
    const report = formatResolutionWatchReport(summary);

    expect(summary.status).toBe('pass');
    expect(summary.dueSoonTrades).toBe(3);
    expect(summary.dueNearTermTrades).toBe(3);
    expect(summary.items).toHaveLength(1);
    expect(report).toContain('Due <=7d                  3');
  });

  it('summarizes due-window resolution cache coverage and freshness', () => {
    const mem = db();
    mem.exec(`
      INSERT INTO poly_paper_trades(id, created_at, market_slug, status) VALUES
        (1, ${NOW - DAY}, 'fresh-cache', 'open'),
        (2, ${NOW - DAY}, 'stale-cache', 'open'),
        (3, ${NOW - DAY}, 'missing-cache', 'open'),
        (4, ${NOW - DAY}, 'later-cache', 'open');
      INSERT INTO poly_markets(slug, question, end_date) VALUES
        ('fresh-cache', 'Fresh cache?', ${NOW + DAY}),
        ('stale-cache', 'Stale cache?', ${NOW + 2 * DAY}),
        ('missing-cache', 'Missing cache?', ${NOW + 3 * DAY}),
        ('later-cache', 'Later cache?', ${NOW + 20 * DAY});
      INSERT INTO poly_resolutions(slug, closed, fetched_at, resolved_at) VALUES
        ('fresh-cache', 0, ${NOW - 300}, NULL),
        ('stale-cache', 0, ${NOW - 5 * 3600}, NULL),
        ('later-cache', 0, ${NOW - 300}, NULL);
    `);

    const summary = collectResolutionWatch(mem, {
      nowSec: NOW,
      maxCacheAgeSec: 4 * 3600,
    });
    const report = formatResolutionWatchReport(summary);

    expect(summary.status).toBe('warn');
    expect(summary.dueWindowTrades).toBe(3);
    expect(summary.dueWindowCachedTrades).toBe(2);
    expect(summary.dueWindowFreshCacheTrades).toBe(1);
    expect(summary.dueWindowStaleCacheTrades).toBe(1);
    expect(summary.dueWindowMissingCacheTrades).toBe(1);
    expect(summary.dueWindowCacheCoveragePct).toBeCloseTo(2 / 3, 6);
    expect(summary.dueWindowFreshCacheCoveragePct).toBeCloseTo(1 / 3, 6);
    expect(summary.oldestDueWindowCacheAgeSec).toBe(5 * 3600);
    expect(report).toContain('Due-window cache rows');
    expect(report).toContain('Due-window stale/missing  1/1');
  });
});
