import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { runAt as applyV15Migration } from '../migrations/v1.15.0/v1.15.0-regime-sharpe-snapshots.js';
import { runRegimeSharpeSnapshot } from './regime-sharpe-snapshot.js';

interface SnapshotDbRow {
  instance: string;
  snapshot_date: string;
  equity: number;
  cash: number | null;
  peak_equity: number | null;
  daily_return: number | null;
  rolling_sharpe_60d: number | null;
  n_days: number;
  source: string;
  created_at: number;
}

function makeClosedState(equity: number, cash = equity, nextOpen = '2030-01-01T14:30:00Z') {
  return {
    mode: 'paper' as const,
    market_open: false,
    next_open: nextOpen,
    equity,
    cash,
  };
}

function makeStateReader(states: Map<string, unknown>): (instance: string) => unknown {
  return (instance: string) => {
    if (!states.has(instance)) {
      throw new Error(`no state for ${instance}`);
    }
    return states.get(instance);
  };
}

function readAllSnapshots(dbPath: string, instance: string): SnapshotDbRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT instance, snapshot_date, equity, cash, peak_equity, daily_return,
                rolling_sharpe_60d, n_days, source, created_at
         FROM regime_sharpe_snapshots WHERE instance = ?
         ORDER BY snapshot_date ASC`,
      )
      .all(instance) as SnapshotDbRow[];
  } finally {
    db.close();
  }
}

describe('regime-sharpe-snapshot script', () => {
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `ccclaw-regime-sharpe-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    await applyV15Migration(dbPath);
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('day 1: writes row with daily_return=null, sharpe=null, n_days=0', () => {
    const states = new Map<string, unknown>([
      ['spy-aggressive', makeClosedState(100_000, 100_000)],
    ]);

    const result = runRegimeSharpeSnapshot({
      dbPath,
      instanceNames: ['spy-aggressive'],
      readStateJson: makeStateReader(states),
      now: () => new Date('2026-05-12T22:00:00Z'),
      timeZone: 'America/Chicago',
    });

    expect(result.errors).toEqual([]);
    expect(result.written).toHaveLength(1);
    const row = result.written[0];
    expect(row.instance).toBe('spy-aggressive');
    expect(row.equity).toBe(100_000);
    expect(row.dailyReturn).toBeNull();
    expect(row.rollingSharpe60d).toBeNull();
    expect(row.nDays).toBe(0);

    const persisted = readAllSnapshots(dbPath, 'spy-aggressive');
    expect(persisted).toHaveLength(1);
    expect(persisted[0].equity).toBe(100_000);
    expect(persisted[0].daily_return).toBeNull();
    expect(persisted[0].rolling_sharpe_60d).toBeNull();
    expect(persisted[0].n_days).toBe(0);
    expect(persisted[0].source).toBe('state_json');
  });

  it('day 2: computes daily_return, sharpe stays null (n_days=1)', () => {
    // Day 1 seed
    runRegimeSharpeSnapshot({
      dbPath,
      instanceNames: ['spy-aggressive'],
      readStateJson: makeStateReader(new Map([['spy-aggressive', makeClosedState(100_000)]])),
      now: () => new Date('2026-05-11T22:00:00Z'),
      timeZone: 'America/Chicago',
    });

    // Day 2: +1% equity move
    const result = runRegimeSharpeSnapshot({
      dbPath,
      instanceNames: ['spy-aggressive'],
      readStateJson: makeStateReader(new Map([['spy-aggressive', makeClosedState(101_000)]])),
      now: () => new Date('2026-05-12T22:00:00Z'),
      timeZone: 'America/Chicago',
    });

    expect(result.errors).toEqual([]);
    expect(result.written).toHaveLength(1);
    const row = result.written[0];
    expect(row.dailyReturn).not.toBeNull();
    expect(row.dailyReturn!).toBeCloseTo(0.01, 10);
    expect(row.rollingSharpe60d).toBeNull(); // need >=2 returns for std
    expect(row.nDays).toBe(1);

    const persisted = readAllSnapshots(dbPath, 'spy-aggressive');
    expect(persisted).toHaveLength(2);
    expect(persisted[1].daily_return!).toBeCloseTo(0.01, 10);
    expect(persisted[1].rolling_sharpe_60d).toBeNull();
    expect(persisted[1].n_days).toBe(1);
  });

  it('day 3: n_days=2, sharpe is a number (or null only if std=0)', () => {
    // Seed three days with non-degenerate moves: +1%, -0.5%
    runRegimeSharpeSnapshot({
      dbPath,
      instanceNames: ['spy-aggressive'],
      readStateJson: makeStateReader(new Map([['spy-aggressive', makeClosedState(100_000)]])),
      now: () => new Date('2026-05-10T22:00:00Z'),
      timeZone: 'America/Chicago',
    });
    runRegimeSharpeSnapshot({
      dbPath,
      instanceNames: ['spy-aggressive'],
      readStateJson: makeStateReader(new Map([['spy-aggressive', makeClosedState(101_000)]])),
      now: () => new Date('2026-05-11T22:00:00Z'),
      timeZone: 'America/Chicago',
    });
    const result = runRegimeSharpeSnapshot({
      dbPath,
      instanceNames: ['spy-aggressive'],
      readStateJson: makeStateReader(new Map([['spy-aggressive', makeClosedState(100_495)]])),
      now: () => new Date('2026-05-12T22:00:00Z'),
      timeZone: 'America/Chicago',
    });

    expect(result.errors).toEqual([]);
    const row = result.written[0];
    expect(row.dailyReturn).not.toBeNull();
    expect(row.dailyReturn!).toBeCloseTo(-0.005, 4);
    expect(row.nDays).toBe(2);
    expect(typeof row.rollingSharpe60d).toBe('number'); // returns +1% then -0.5%, std>0
    expect(Number.isFinite(row.rollingSharpe60d!)).toBe(true);
  });

  it('is idempotent: re-running on the same date replaces the row', () => {
    runRegimeSharpeSnapshot({
      dbPath,
      instanceNames: ['spy-aggressive'],
      readStateJson: makeStateReader(new Map([['spy-aggressive', makeClosedState(100_000)]])),
      now: () => new Date('2026-05-12T22:00:00Z'),
      timeZone: 'America/Chicago',
    });

    // Re-run same day with a different equity value
    runRegimeSharpeSnapshot({
      dbPath,
      instanceNames: ['spy-aggressive'],
      readStateJson: makeStateReader(new Map([['spy-aggressive', makeClosedState(99_500)]])),
      now: () => new Date('2026-05-12T22:30:00Z'),
      timeZone: 'America/Chicago',
    });

    const persisted = readAllSnapshots(dbPath, 'spy-aggressive');
    expect(persisted).toHaveLength(1);
    expect(persisted[0].equity).toBe(99_500);
    // daily_return is still null because the upsert ran without a prior row on a different day
    expect(persisted[0].daily_return).toBeNull();
    expect(persisted[0].n_days).toBe(0);
  });

  it('logs and continues when one instance state is missing', () => {
    const states = new Map<string, unknown>([
      ['spy-aggressive', makeClosedState(100_000)],
    ]);
    // 'spy-conservative' intentionally missing — reader will throw

    const logged: string[] = [];
    const result = runRegimeSharpeSnapshot({
      dbPath,
      instanceNames: ['spy-aggressive', 'spy-conservative'],
      readStateJson: makeStateReader(states),
      now: () => new Date('2026-05-12T22:00:00Z'),
      timeZone: 'America/Chicago',
      logger: (msg) => logged.push(msg),
    });

    expect(result.written).toHaveLength(1);
    expect(result.written[0].instance).toBe('spy-aggressive');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].instance).toBe('spy-conservative');
    expect(logged.some((m) => m.includes('spy-conservative') && m.includes('ERROR'))).toBe(true);
  });

  it('rejects malformed state.json via parseInstanceState and skips the row', () => {
    const states = new Map<string, unknown>([
      ['spy-aggressive', { mode: 'paper', market_open: false, equity: 'not-a-number', cash: 0 }],
    ]);

    const result = runRegimeSharpeSnapshot({
      dbPath,
      instanceNames: ['spy-aggressive'],
      readStateJson: makeStateReader(states),
      now: () => new Date('2026-05-12T22:00:00Z'),
      timeZone: 'America/Chicago',
      logger: () => {},
    });

    expect(result.written).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/state.json parse/);

    const persisted = readAllSnapshots(dbPath, 'spy-aggressive');
    expect(persisted).toHaveLength(0);
  });
});
