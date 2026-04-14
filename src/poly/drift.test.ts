import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  percentile, latencyStats, rejectionMix, marketCountTrend,
  recordScanRun, composeDriftReport, formatDriftReport,
  type ScanRun,
} from './drift.js';

function bootDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL,
      duration_ms INTEGER, market_count INTEGER,
      status TEXT NOT NULL, error TEXT);
    CREATE TABLE poly_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      market_slug TEXT, outcome_token_id TEXT, outcome_label TEXT,
      market_price REAL, estimated_prob REAL, edge_pct REAL,
      confidence TEXT, reasoning TEXT, contrarian TEXT, approved INTEGER NOT NULL,
      rejection_reasons TEXT, paper_trade_id INTEGER);
  `);
  return db;
}

describe('percentile', () => {
  it('returns null on empty input', () => {
    expect(percentile([], 0.5)).toBeNull();
  });
  it('returns the sole element for any percentile when len=1', () => {
    expect(percentile([42], 0.95)).toBe(42);
  });
  it('approximates p50 (median) correctly', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
  it('p95 of 100 items is the 95th value', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 0.95)).toBe(95);
  });
});

describe('latencyStats', () => {
  it('computes p50/p95/p99 + mean + count from scan_runs', () => {
    const db = bootDb();
    const now = 1_700_000_000;
    for (let i = 0; i < 100; i++) {
      db.prepare(`INSERT INTO poly_scan_runs (started_at,duration_ms,market_count,status) VALUES (?,?,?,?)`)
        .run(now - i * 60, (i + 1) * 100, 1000, 'ok');
    }
    const s = latencyStats(db, now, 100 * 60);
    expect(s.count).toBe(100);
    expect(s.p50).toBe(5000);  // median = 50th value = 5000
    expect(s.p95).toBe(9500);
    expect(s.p99).toBe(9900);
  });

  it('excludes errored runs from latency percentiles', () => {
    const db = bootDb();
    const now = 1_700_000_000;
    db.prepare(`INSERT INTO poly_scan_runs (started_at,duration_ms,market_count,status) VALUES (?,?,?,?)`)
      .run(now - 60, 500, 1000, 'ok');
    db.prepare(`INSERT INTO poly_scan_runs (started_at,duration_ms,market_count,status,error) VALUES (?,?,?,?,?)`)
      .run(now - 120, null, null, 'error', 'network timeout');
    const s = latencyStats(db, now, 3600);
    expect(s.count).toBe(1);
    expect(s.errorCount).toBe(1);
  });
});

describe('rejectionMix', () => {
  it('returns empty map when no signals in window', () => {
    const db = bootDb();
    expect(rejectionMix(db, 0, 1000).size).toBe(0);
  });

  it('tallies rejections by gate name from the rejection_reasons JSON', () => {
    const db = bootDb();
    const insert = (rr: string | null, approved: number): void => {
      db.prepare(`INSERT INTO poly_signals (created_at,market_slug,outcome_token_id,outcome_label,market_price,estimated_prob,edge_pct,approved,rejection_reasons) VALUES (100,'s','t','Yes',0.4,0.6,10,?,?)`)
        .run(approved, rr);
    };
    insert(JSON.stringify([{ gate: 'signal_quality', reason: 'edge<8' }]), 0);
    insert(JSON.stringify([{ gate: 'signal_quality', reason: 'edge<8' }]), 0);
    insert(JSON.stringify([{ gate: 'position_limits', reason: 'max open' }]), 0);
    insert(null, 1);  // approved, no rejection reasons
    const mix = rejectionMix(db, 0, 1000);
    expect(mix.get('signal_quality')).toBe(2);
    expect(mix.get('position_limits')).toBe(1);
    expect(mix.size).toBe(2);
  });
});

describe('marketCountTrend', () => {
  it('compares latest successful count against rolling average', () => {
    const db = bootDb();
    const now = 1_700_000_000;
    for (let i = 1; i < 10; i++) {
      db.prepare(`INSERT INTO poly_scan_runs (started_at,duration_ms,market_count,status) VALUES (?,?,?,?)`)
        .run(now - i * 300, 1000, 1000, 'ok');
    }
    db.prepare(`INSERT INTO poly_scan_runs (started_at,duration_ms,market_count,status) VALUES (?,?,?,?)`)
      .run(now, 1000, 500, 'ok'); // latest halved
    const t = marketCountTrend(db, now, 24 * 3600);
    expect(t.latest).toBe(500);
    expect(t.rollingAvg).toBeCloseTo(1000, 0);
    expect(t.deltaPct).toBeCloseTo(-50, 0);
  });

  it('null metrics when no runs', () => {
    expect(marketCountTrend(bootDb(), 1000, 3600).latest).toBeNull();
  });
});

describe('recordScanRun', () => {
  it('inserts a row and returns the id', () => {
    const db = bootDb();
    const id = recordScanRun(db, { startedAt: 100, durationMs: 500, marketCount: 1000, status: 'ok' });
    expect(id).toBeGreaterThan(0);
    const row = db.prepare(`SELECT * FROM poly_scan_runs WHERE id=?`).get(id) as ScanRun;
    expect(row.market_count).toBe(1000);
  });

  it('accepts error status with null duration/count', () => {
    const db = bootDb();
    const id = recordScanRun(db, { startedAt: 100, durationMs: null, marketCount: null, status: 'error', error: 'boom' });
    expect(id).toBeGreaterThan(0);
  });
});

describe('formatDriftReport', () => {
  it('renders a readable block with all three sections', () => {
    const txt = formatDriftReport({
      windowHours: 24,
      latency: { p50: 5000, p95: 9500, p99: 9900, mean: 5000, count: 100, errorCount: 2 },
      rejection: new Map([['signal_quality', 40], ['position_limits', 3]]),
      marketCount: { latest: 1000, rollingAvg: 1000, deltaPct: 0 },
    });
    expect(txt).toContain('Drift');
    expect(txt).toContain('p50');
    expect(txt).toContain('9500');
    expect(txt).toContain('signal_quality');
    expect(txt).toContain('market count');
  });
});
