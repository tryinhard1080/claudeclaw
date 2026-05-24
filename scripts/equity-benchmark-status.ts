#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { STORE_DIR } from '../src/config.js';
import { compareEquityBenchmark, type EquityCurvePoint } from '../src/trading/equity-benchmark.js';

interface RegimeRow {
  instance: string;
  snapshot_date: string;
  equity: number;
  daily_return: number | null;
}

interface BenchmarkRow {
  benchmark: string;
  snapshot_date: string;
  equity: number;
  daily_return: number | null;
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name) as { name?: string } | undefined;
  return row?.name === name;
}

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function asPoints(rows: Array<{ snapshot_date: string; equity: number; daily_return: number | null }>): EquityCurvePoint[] {
  return rows.map(row => ({
    date: row.snapshot_date,
    equity: row.equity,
    dailyReturn: row.daily_return,
  }));
}

export function main(): number {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    console.log('Equity Benchmark');
    console.log('----------------');

    if (!tableExists(db, 'equity_benchmark_snapshots')) {
      console.log('WARN  benchmark table missing. Run migrations.');
      return 0;
    }
    if (!tableExists(db, 'regime_sharpe_snapshots')) {
      console.log('WARN  regime_sharpe_snapshots missing.');
      return 0;
    }

    const benchmarkRows = db.prepare(`
      SELECT benchmark, snapshot_date, equity, daily_return
        FROM equity_benchmark_snapshots
       ORDER BY snapshot_date ASC
    `).all() as BenchmarkRow[];
    if (benchmarkRows.length === 0) {
      console.log('WARN  benchmark table empty. Writer not connected yet.');
      return 0;
    }

    const regimeRows = db.prepare(`
      SELECT instance, snapshot_date, equity, daily_return
        FROM regime_sharpe_snapshots
       ORDER BY instance ASC, snapshot_date ASC
    `).all() as RegimeRow[];

    const byBenchmark = new Map<string, BenchmarkRow[]>();
    for (const row of benchmarkRows) {
      byBenchmark.set(row.benchmark, [...(byBenchmark.get(row.benchmark) ?? []), row]);
    }
    const [benchmarkName, rows] = byBenchmark.entries().next().value as [string, BenchmarkRow[]];

    const instances = [...new Set(regimeRows.map(row => row.instance))].sort();
    for (const instance of instances) {
      const strategyRows = regimeRows.filter(row => row.instance === instance);
      const comparison = compareEquityBenchmark({
        instance,
        benchmark: benchmarkName,
        strategyPoints: asPoints(strategyRows),
        benchmarkPoints: asPoints(rows),
      });
      console.log(
        `${instance.padEnd(18)} benchmark=${benchmarkName} strategy=${pct(comparison.strategy.cumulativeReturn)} benchmark=${pct(comparison.benchmarkStats.cumulativeReturn)} excess=${pct(comparison.excessCumulativeReturn)}`,
      );
    }

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
    console.error('Equity benchmark failed:', error);
    process.exitCode = 1;
  }
}

