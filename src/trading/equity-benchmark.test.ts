import { describe, expect, it } from 'vitest';

import {
  compareEquityBenchmark,
  computeDailyReturn,
  computeEquityCurveStats,
  nextBenchmarkPointFromPrice,
  type EquityCurvePoint,
} from './equity-benchmark.js';

describe('equity benchmark math', () => {
  it('computes daily return defensively', () => {
    expect(computeDailyReturn(110, 100)).toBeCloseTo(0.1);
    expect(computeDailyReturn(110, 0)).toBeNull();
    expect(computeDailyReturn(Number.NaN, 100)).toBeNull();
  });

  it('computes cumulative return, max drawdown, and worst day', () => {
    const points: EquityCurvePoint[] = [
      { date: '2026-05-01', equity: 100, dailyReturn: null },
      { date: '2026-05-02', equity: 110, dailyReturn: 0.1 },
      { date: '2026-05-03', equity: 99, dailyReturn: -0.1 },
      { date: '2026-05-04', equity: 120, dailyReturn: 0.2121 },
    ];

    const stats = computeEquityCurveStats(points);

    expect(stats.nDays).toBe(3);
    expect(stats.cumulativeReturn).toBeCloseTo(0.2);
    expect(stats.maxDrawdown).toBeCloseTo(0.1);
    expect(stats.worstDay).toBeCloseTo(-0.1);
  });

  it('compares strategy cumulative return against benchmark', () => {
    const strategyPoints: EquityCurvePoint[] = [
      { date: '2026-05-01', equity: 100, dailyReturn: null },
      { date: '2026-05-02', equity: 110, dailyReturn: 0.1 },
    ];
    const benchmarkPoints: EquityCurvePoint[] = [
      { date: '2026-05-01', equity: 100, dailyReturn: null },
      { date: '2026-05-02', equity: 104, dailyReturn: 0.04 },
    ];

    const comparison = compareEquityBenchmark({
      instance: 'spy-aggressive',
      benchmark: 'spy-buy-hold',
      strategyPoints,
      benchmarkPoints,
    });

    expect(comparison.excessCumulativeReturn).toBeCloseTo(0.06);
  });

  it('builds a benchmark point from reference price history', () => {
    const first = nextBenchmarkPointFromPrice({
      snapshotDate: '2026-05-01',
      referencePrice: 500,
      prior: null,
      initialEquity: 100000,
    });
    const second = nextBenchmarkPointFromPrice({
      snapshotDate: '2026-05-02',
      referencePrice: 550,
      prior: first,
    });

    expect(first.equity).toBe(100000);
    expect(first.dailyReturn).toBeNull();
    expect(second.dailyReturn).toBeCloseTo(0.1);
    expect(second.equity).toBeCloseTo(110000);
  });
});
