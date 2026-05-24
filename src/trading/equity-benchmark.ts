export interface EquityCurvePoint {
  date: string;
  equity: number;
  dailyReturn: number | null;
}

export interface BenchmarkPricePoint {
  snapshotDate: string;
  referencePrice: number;
  equity: number;
  dailyReturn: number | null;
}

export interface EquityCurveStats {
  nDays: number;
  cumulativeReturn: number | null;
  maxDrawdown: number;
  worstDay: number | null;
}

export interface EquityBenchmarkComparison {
  instance: string;
  benchmark: string;
  strategy: EquityCurveStats;
  benchmarkStats: EquityCurveStats;
  excessCumulativeReturn: number | null;
}

export function computeDailyReturn(todayEquity: number, priorEquity: number | null): number | null {
  if (!Number.isFinite(todayEquity)) return null;
  if (priorEquity === null || !Number.isFinite(priorEquity) || priorEquity === 0) return null;
  return (todayEquity - priorEquity) / priorEquity;
}

export function computeEquityCurveStats(points: ReadonlyArray<EquityCurvePoint>): EquityCurveStats {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) {
    return { nDays: 0, cumulativeReturn: null, maxDrawdown: 0, worstDay: null };
  }

  const first = sorted[0]!.equity;
  const last = sorted[sorted.length - 1]!.equity;
  const cumulativeReturn = first > 0 ? (last - first) / first : null;

  let peak = sorted[0]!.equity;
  let maxDrawdown = 0;
  let worstDay: number | null = null;
  for (const point of sorted) {
    if (point.equity > peak) peak = point.equity;
    if (peak > 0) {
      const drawdown = (peak - point.equity) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    if (point.dailyReturn !== null) {
      worstDay = worstDay === null ? point.dailyReturn : Math.min(worstDay, point.dailyReturn);
    }
  }

  return {
    nDays: sorted.filter(point => point.dailyReturn !== null).length,
    cumulativeReturn,
    maxDrawdown,
    worstDay,
  };
}

export function compareEquityBenchmark(args: {
  instance: string;
  benchmark: string;
  strategyPoints: ReadonlyArray<EquityCurvePoint>;
  benchmarkPoints: ReadonlyArray<EquityCurvePoint>;
}): EquityBenchmarkComparison {
  const strategy = computeEquityCurveStats(args.strategyPoints);
  const benchmarkStats = computeEquityCurveStats(args.benchmarkPoints);
  const excessCumulativeReturn =
    strategy.cumulativeReturn === null || benchmarkStats.cumulativeReturn === null
      ? null
      : strategy.cumulativeReturn - benchmarkStats.cumulativeReturn;

  return {
    instance: args.instance,
    benchmark: args.benchmark,
    strategy,
    benchmarkStats,
    excessCumulativeReturn,
  };
}

export function nextBenchmarkPointFromPrice(args: {
  snapshotDate: string;
  referencePrice: number;
  prior: BenchmarkPricePoint | null;
  initialEquity?: number;
}): BenchmarkPricePoint {
  const initialEquity = args.initialEquity ?? 100000;
  if (!Number.isFinite(args.referencePrice) || args.referencePrice <= 0) {
    throw new Error(`invalid reference price: ${args.referencePrice}`);
  }
  if (!args.prior) {
    return {
      snapshotDate: args.snapshotDate,
      referencePrice: args.referencePrice,
      equity: initialEquity,
      dailyReturn: null,
    };
  }

  const dailyReturn = computeDailyReturn(args.referencePrice, args.prior.referencePrice);
  const equity = dailyReturn === null ? args.prior.equity : args.prior.equity * (1 + dailyReturn);
  return {
    snapshotDate: args.snapshotDate,
    referencePrice: args.referencePrice,
    equity,
    dailyReturn,
  };
}
