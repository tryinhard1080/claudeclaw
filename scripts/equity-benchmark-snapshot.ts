#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { REGIME_TRADER_PATH, STORE_DIR } from '../src/config.js';
import { nextBenchmarkPointFromPrice, type BenchmarkPricePoint } from '../src/trading/equity-benchmark.js';
import { formatSnapshotDate } from '../src/trading/sharpe.js';

interface RegimePosition {
  symbol?: string;
  current_price?: number;
}

interface RegimeState {
  positions?: RegimePosition[];
  updated_at?: string;
}

interface PriorBenchmarkRow {
  snapshot_date: string;
  reference_price: number;
  equity: number;
  daily_return: number | null;
}

function regimeRoot(): string {
  return REGIME_TRADER_PATH || 'C:\\Code\\regime-trader';
}

function readState(): RegimeState {
  const statePath = path.join(regimeRoot(), 'instances', 'spy-aggressive', 'data', 'state.json');
  return JSON.parse(fs.readFileSync(statePath, 'utf8')) as RegimeState;
}

function spyPriceFromState(state: RegimeState): number {
  const spy = state.positions?.find(position => position.symbol === 'SPY');
  const price = spy?.current_price;
  if (!Number.isFinite(price) || price === undefined || price <= 0) {
    throw new Error('SPY current_price missing from regime state');
  }
  return price;
}

function snapshotDateFromState(state: RegimeState): string {
  const updatedAt = state.updated_at ? new Date(state.updated_at) : new Date();
  return formatSnapshotDate(updatedAt);
}

function latestPrior(db: Database.Database, benchmark: string, snapshotDate: string): BenchmarkPricePoint | null {
  const row = db.prepare(`
    SELECT snapshot_date, reference_price, equity, daily_return
      FROM equity_benchmark_snapshots
     WHERE benchmark=? AND snapshot_date < ?
     ORDER BY snapshot_date DESC
     LIMIT 1
  `).get(benchmark, snapshotDate) as PriorBenchmarkRow | undefined;

  if (!row) return null;
  return {
    snapshotDate: row.snapshot_date,
    referencePrice: row.reference_price,
    equity: row.equity,
    dailyReturn: row.daily_return,
  };
}

export function main(): number {
  const benchmark = 'spy-buy-hold';
  const state = readState();
  const snapshotDate = snapshotDateFromState(state);
  const referencePrice = spyPriceFromState(state);
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
  try {
    db.pragma('busy_timeout = 5000');
    const prior = latestPrior(db, benchmark, snapshotDate);
    const point = nextBenchmarkPointFromPrice({ snapshotDate, referencePrice, prior });
    db.prepare(`
      INSERT INTO equity_benchmark_snapshots (
        benchmark, snapshot_date, reference_price, equity, daily_return, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(benchmark, snapshot_date) DO UPDATE SET
        reference_price = excluded.reference_price,
        equity = excluded.equity,
        daily_return = excluded.daily_return,
        source = excluded.source,
        created_at = excluded.created_at
    `).run(
      benchmark,
      point.snapshotDate,
      point.referencePrice,
      point.equity,
      point.dailyReturn,
      'regime_state_current_price',
      Math.floor(Date.now() / 1000),
    );
    console.log(`Benchmark snapshot ${benchmark} ${point.snapshotDate}: price=${point.referencePrice.toFixed(2)} equity=${point.equity.toFixed(2)}`);
    return 0;
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error('Equity benchmark snapshot failed:', error);
    process.exitCode = 1;
  }
}

