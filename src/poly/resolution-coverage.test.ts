import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildSlugPriorityQueue,
  computeCoverage,
  shouldAlarmCoverage,
  loadCoverageHistory,
  saveCoverageHistory,
  formatCoverageLog,
  formatCoverageAlarm,
  COVERAGE_ALARM_THRESHOLD_PCT,
  COVERAGE_TARGET_PCT,
  COVERAGE_HISTORY_MAX,
  type CoverageHistoryEntry,
} from './resolution-coverage.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      market_slug TEXT NOT NULL,
      outcome_token_id TEXT NOT NULL DEFAULT '',
      outcome_label TEXT NOT NULL DEFAULT '',
      side TEXT NOT NULL DEFAULT 'BUY',
      entry_price REAL NOT NULL DEFAULT 0,
      size_usd REAL NOT NULL DEFAULT 0,
      shares REAL NOT NULL DEFAULT 0,
      kelly_fraction REAL NOT NULL DEFAULT 0,
      strategy TEXT NOT NULL DEFAULT 'ai-probability',
      status TEXT NOT NULL,
      resolved_at INTEGER,
      realized_pnl REAL,
      voided_reason TEXT
    );
    CREATE TABLE poly_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      market_slug TEXT NOT NULL,
      outcome_token_id TEXT NOT NULL DEFAULT '',
      outcome_label TEXT NOT NULL DEFAULT '',
      market_price REAL NOT NULL DEFAULT 0,
      estimated_prob REAL NOT NULL DEFAULT 0,
      edge_pct REAL NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'medium',
      reasoning TEXT NOT NULL DEFAULT '',
      contrarian TEXT,
      approved INTEGER NOT NULL DEFAULT 0,
      rejection_reasons TEXT,
      paper_trade_id INTEGER
    );
    CREATE TABLE poly_resolutions (
      slug TEXT PRIMARY KEY,
      closed INTEGER NOT NULL,
      outcomes_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE TABLE poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

function insertTrade(db: Database.Database, slug: string, status: string): void {
  db.prepare(`INSERT INTO poly_paper_trades (created_at, market_slug, status) VALUES (?, ?, ?)`)
    .run(1000, slug, status);
}

function insertSignal(db: Database.Database, slug: string): void {
  db.prepare(`INSERT INTO poly_signals (created_at, market_slug) VALUES (?, ?)`).run(1000, slug);
}

function insertResolution(db: Database.Database, slug: string): void {
  db.prepare(`INSERT INTO poly_resolutions (slug, closed, outcomes_json, fetched_at) VALUES (?, 0, '[]', 0)`)
    .run(slug);
}

describe('buildSlugPriorityQueue', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('returns open-trade slugs first, then signal-only slugs', () => {
    insertTrade(db, 'open-a', 'open');
    insertTrade(db, 'open-b', 'open');
    insertSignal(db, 'signal-c');
    insertSignal(db, 'signal-d');
    const q = buildSlugPriorityQueue(db);
    expect(q.slice(0, 2).sort()).toEqual(['open-a', 'open-b']);
    expect(q.slice(2).sort()).toEqual(['signal-c', 'signal-d']);
  });

  it('dedupes a slug that appears in both pools', () => {
    insertTrade(db, 'shared', 'open');
    insertSignal(db, 'shared');
    insertSignal(db, 'extra');
    const q = buildSlugPriorityQueue(db);
    expect(q).toEqual(['shared', 'extra']);
    expect(q.length).toBe(2);
  });

  it('excludes non-open trades from the priority slice', () => {
    insertTrade(db, 'won-x', 'won');
    insertTrade(db, 'lost-y', 'lost');
    insertTrade(db, 'open-z', 'open');
    insertSignal(db, 'sig-1');
    const q = buildSlugPriorityQueue(db);
    expect(q[0]).toBe('open-z');
    expect(q).not.toContain('won-x');
    expect(q).not.toContain('lost-y');
  });

  it('returns empty when both pools are empty', () => {
    expect(buildSlugPriorityQueue(db)).toEqual([]);
  });

  it('returns only signal slugs when no trades are open', () => {
    insertTrade(db, 'closed', 'won');
    insertSignal(db, 'sig-a');
    insertSignal(db, 'sig-b');
    const q = buildSlugPriorityQueue(db);
    expect(q.sort()).toEqual(['sig-a', 'sig-b']);
  });
});

describe('computeCoverage', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('returns 100% with zero open trades (avoids div-by-zero)', () => {
    const c = computeCoverage(db);
    expect(c).toEqual({ totalOpenTrades: 0, tradesWithCache: 0, coveragePct: 100 });
  });

  it('returns 100% when every open trade has a cache row', () => {
    insertTrade(db, 'a', 'open'); insertResolution(db, 'a');
    insertTrade(db, 'b', 'open'); insertResolution(db, 'b');
    const c = computeCoverage(db);
    expect(c.totalOpenTrades).toBe(2);
    expect(c.tradesWithCache).toBe(2);
    expect(c.coveragePct).toBe(100);
  });

  it('computes partial coverage to one decimal', () => {
    insertTrade(db, 'a', 'open'); insertResolution(db, 'a');
    insertTrade(db, 'b', 'open');
    insertTrade(db, 'c', 'open');
    const c = computeCoverage(db);
    expect(c.totalOpenTrades).toBe(3);
    expect(c.tradesWithCache).toBe(1);
    expect(c.coveragePct).toBeCloseTo(33.33, 1);
  });

  it('returns 0% when zero of N open trades are cached', () => {
    insertTrade(db, 'a', 'open');
    insertTrade(db, 'b', 'open');
    const c = computeCoverage(db);
    expect(c).toEqual({ totalOpenTrades: 2, tradesWithCache: 0, coveragePct: 0 });
  });

  it('counts distinct slugs (two open trades on the same slug count as one)', () => {
    insertTrade(db, 'a', 'open');
    insertTrade(db, 'a', 'open');
    insertResolution(db, 'a');
    const c = computeCoverage(db);
    expect(c.totalOpenTrades).toBe(1);
    expect(c.tradesWithCache).toBe(1);
    expect(c.coveragePct).toBe(100);
  });

  it('ignores closed-status trades in the denominator', () => {
    insertTrade(db, 'open-1', 'open');
    insertTrade(db, 'won-x', 'won');
    insertTrade(db, 'voided-y', 'voided');
    insertResolution(db, 'open-1');
    const c = computeCoverage(db);
    expect(c.totalOpenTrades).toBe(1);
    expect(c.coveragePct).toBe(100);
  });
});

describe('shouldAlarmCoverage', () => {
  it('does not alarm with empty history', () => {
    expect(shouldAlarmCoverage([])).toBe(false);
  });

  it('does not alarm with a single sub-threshold measurement', () => {
    expect(shouldAlarmCoverage([{ ts: 1, pct: 50 }])).toBe(false);
  });

  it('alarms when the last two measurements are both below threshold', () => {
    const h: CoverageHistoryEntry[] = [
      { ts: 1, pct: 95 },
      { ts: 2, pct: 70 },
      { ts: 3, pct: 60 },
    ];
    expect(shouldAlarmCoverage(h)).toBe(true);
  });

  it('does not alarm when only the most recent is below threshold', () => {
    const h: CoverageHistoryEntry[] = [
      { ts: 1, pct: 90 },
      { ts: 2, pct: 70 },
    ];
    expect(shouldAlarmCoverage(h)).toBe(false);
  });

  it('does not alarm when the second-most-recent is below but most recent is healthy', () => {
    const h: CoverageHistoryEntry[] = [
      { ts: 1, pct: 70 },
      { ts: 2, pct: 90 },
    ];
    expect(shouldAlarmCoverage(h)).toBe(false);
  });

  it('treats exactly threshold as healthy (strict less-than)', () => {
    const h: CoverageHistoryEntry[] = [
      { ts: 1, pct: COVERAGE_ALARM_THRESHOLD_PCT },
      { ts: 2, pct: COVERAGE_ALARM_THRESHOLD_PCT },
    ];
    expect(shouldAlarmCoverage(h)).toBe(false);
  });
});

describe('loadCoverageHistory + saveCoverageHistory', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('returns empty when key is absent', () => {
    expect(loadCoverageHistory(db)).toEqual([]);
  });

  it('round-trips a sequence of measurements', () => {
    const h: CoverageHistoryEntry[] = [
      { ts: 100, pct: 95 },
      { ts: 200, pct: 75 },
    ];
    saveCoverageHistory(db, h);
    expect(loadCoverageHistory(db)).toEqual(h);
  });

  it('trims to COVERAGE_HISTORY_MAX entries on save', () => {
    const h: CoverageHistoryEntry[] = [];
    for (let i = 1; i <= COVERAGE_HISTORY_MAX + 3; i++) h.push({ ts: i * 100, pct: 90 });
    saveCoverageHistory(db, h);
    const loaded = loadCoverageHistory(db);
    expect(loaded.length).toBe(COVERAGE_HISTORY_MAX);
    expect(loaded[0]!.ts).toBe(400); // first 3 dropped: ts=100,200,300
  });

  it('overwrites prior history on subsequent save', () => {
    saveCoverageHistory(db, [{ ts: 1, pct: 99 }]);
    saveCoverageHistory(db, [{ ts: 2, pct: 50 }]);
    expect(loadCoverageHistory(db)).toEqual([{ ts: 2, pct: 50 }]);
  });

  it('returns empty when stored value is malformed JSON', () => {
    db.prepare(`INSERT INTO poly_kv(key, value) VALUES ('poly.coverage.history', 'not-json')`).run();
    expect(loadCoverageHistory(db)).toEqual([]);
  });

  it('returns empty when stored value parses to non-array', () => {
    db.prepare(`INSERT INTO poly_kv(key, value) VALUES ('poly.coverage.history', '{"oops":true}')`).run();
    expect(loadCoverageHistory(db)).toEqual([]);
  });
});

describe('formatCoverageLog + formatCoverageAlarm', () => {
  it('formats a coverage line with all three counters and target', () => {
    const line = formatCoverageLog({ totalOpenTrades: 5, tradesWithCache: 4, coveragePct: 80 });
    expect(line).toContain('[coverage]');
    expect(line).toContain('4/5');
    expect(line).toContain('80.0%');
    expect(line).toContain(`target=${COVERAGE_TARGET_PCT}%`);
  });

  it('rounds coverage pct to one decimal in the log line', () => {
    const line = formatCoverageLog({ totalOpenTrades: 3, tradesWithCache: 1, coveragePct: 33.3333 });
    expect(line).toContain('33.3%');
  });

  it('formats an alarm line with the last-2 history snapshot', () => {
    const line = formatCoverageAlarm([
      { ts: 100, pct: 70 },
      { ts: 200, pct: 60 },
    ]);
    expect(line).toContain('[coverage-alarm]');
    expect(line).toContain('70.0%');
    expect(line).toContain('60.0%');
    expect(line).toContain(`<${COVERAGE_ALARM_THRESHOLD_PCT}%`);
  });
});
