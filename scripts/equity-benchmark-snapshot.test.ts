import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { runAt as applyV18Migration } from '../migrations/v1.18.0/v1.18.0-equity-benchmark-snapshots.js';
import {
  runEquityBenchmarkSnapshot,
  benchmarkSnapshotExitCode,
} from './equity-benchmark-snapshot.js';

interface BenchmarkDbRow {
  benchmark: string;
  snapshot_date: string;
  reference_price: number | null;
  equity: number;
  daily_return: number | null;
  source: string;
}

function readRows(dbPath: string): BenchmarkDbRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`
      SELECT benchmark, snapshot_date, reference_price, equity, daily_return, source
        FROM equity_benchmark_snapshots
       ORDER BY snapshot_date ASC
    `).all() as BenchmarkDbRow[];
  } finally {
    db.close();
  }
}

describe('equity-benchmark-snapshot script', () => {
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `ccclaw-equity-benchmark-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    await applyV18Migration(dbPath);
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('skips cleanly when closed-market state has no SPY price', () => {
    const logged: string[] = [];
    const result = runEquityBenchmarkSnapshot({
      dbPath,
      readStateJson: () => ({
        mode: 'paper',
        market_open: false,
        equity: 105_000,
        cash: 90_000,
        updated_at: '2026-06-01T20:00:00.000Z',
      }),
      logger: msg => logged.push(msg),
    });

    expect(result.written).toHaveLength(0);
    expect(result.skipped).toMatch(/SPY current_price missing/);
    expect(result.errors).toEqual([]);
    expect(benchmarkSnapshotExitCode(result)).toBe(0);
    expect(readRows(dbPath)).toEqual([]);
    expect(logged.some(msg => msg.includes('SKIP'))).toBe(true);
  });

  it('writes a benchmark row when SPY current_price is present', () => {
    const result = runEquityBenchmarkSnapshot({
      dbPath,
      readStateJson: () => ({
        updated_at: '2026-06-01T20:00:00.000Z',
        positions: [{ symbol: 'SPY', current_price: 550 }],
      }),
      logger: () => {},
    });

    expect(result.errors).toEqual([]);
    expect(result.skipped).toBeNull();
    expect(result.written).toHaveLength(1);
    expect(benchmarkSnapshotExitCode(result)).toBe(0);

    const rows = readRows(dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.benchmark).toBe('spy-buy-hold');
    expect(rows[0]!.snapshot_date).toBe('2026-06-01');
    expect(rows[0]!.reference_price).toBe(550);
    expect(rows[0]!.equity).toBe(100_000);
    expect(rows[0]!.daily_return).toBeNull();
    expect(rows[0]!.source).toBe('regime_state_current_price');
  });
});
