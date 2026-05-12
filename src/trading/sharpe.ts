// Sharpe instrumentation for regime-trader paper-trading Box-3 gate.
// All pure functions; no I/O, no SQL. See docs/research/sprint-s1-sharpe-instrumentation.md.

export interface SharpeSnapshot {
  instance: string;
  snapshotDate: string;            // YYYY-MM-DD (US/Central)
  equity: number;
  cash: number | null;
  peakEquity: number | null;
  dailyReturn: number | null;      // null on first day per instance
  rollingSharpe60d: number | null; // null until n_days >= 2 and std > 0
  nDays: number;                   // count of daily returns in rolling window
}

export interface SharpeOptions {
  riskFreeRate?: number;           // annualized, default 0.0
  periodsPerYear?: number;         // default 252 (US trading days)
  windowSize?: number;             // default 60
}

export interface RollingSharpeResult {
  sharpe: number | null;
  nDays: number;
}

/**
 * Daily return as a fraction. Returns null when yesterdayEquity is null,
 * zero, or non-finite.
 */
export function computeDailyReturn(
  todayEquity: number,
  yesterdayEquity: number | null,
): number | null {
  if (!Number.isFinite(todayEquity)) return null;
  if (yesterdayEquity === null) return null;
  if (!Number.isFinite(yesterdayEquity)) return null;
  if (yesterdayEquity === 0) return null;
  return (todayEquity - yesterdayEquity) / yesterdayEquity;
}

function mean(xs: ReadonlyArray<number>): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function sampleStd(xs: ReadonlyArray<number>): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) {
    const d = x - m;
    acc += d * d;
  }
  return Math.sqrt(acc / (xs.length - 1));
}

/**
 * Annualized rolling Sharpe over the last `windowSize` returns.
 * Returns { sharpe: null } when:
 *   - returns.length < 2 (insufficient for std)
 *   - sample standard deviation is 0 (degenerate / constant returns)
 *   - any return is non-finite (defensive)
 * Filters non-finite values defensively before computation.
 *
 * Formula: (mean - rf_daily) * sqrt(periodsPerYear) / std
 * where rf_daily = riskFreeRate / periodsPerYear.
 */
export function computeRollingSharpe(
  dailyReturns: ReadonlyArray<number>,
  options: SharpeOptions = {},
): RollingSharpeResult {
  const riskFreeRate = options.riskFreeRate ?? 0;
  const periodsPerYear = options.periodsPerYear ?? 252;
  const windowSize = options.windowSize ?? 60;

  const finite = dailyReturns.filter((r) => Number.isFinite(r));
  const window = finite.slice(-windowSize);
  const nDays = window.length;

  if (nDays < 2) return { sharpe: null, nDays };

  const std = sampleStd(window);
  // Floating-point sum-of-squares on constant inputs produces ~1e-18 noise.
  // Treat anything below 1e-12 as degenerate; otherwise a single tick of
  // FP noise blows the Sharpe up to ~1e15.
  if (std < 1e-12) return { sharpe: null, nDays };

  const m = mean(window);
  const rfDaily = riskFreeRate / periodsPerYear;
  const sharpe = ((m - rfDaily) * Math.sqrt(periodsPerYear)) / std;

  return { sharpe, nDays };
}

export type SharpeTrend = 'rising' | 'falling' | 'flat' | 'insufficient';

export interface SharpeInstanceSummary {
  instance: string;
  latestSharpe60d: number | null;
  nDays: number;
  trend: SharpeTrend;
  latestSnapshotDate: string | null;
}

/**
 * Per-instance summary from a list of snapshots (assumed sorted ascending by date).
 * Trend: compares latest sharpe to the snapshot 7 entries earlier.
 *  - rising if >0.05 absolute increase
 *  - falling if <-0.05 absolute decrease
 *  - flat otherwise (when both sides are non-null)
 *  - insufficient when either side is null or < 7 snapshots
 */
export function summarizeSharpe(
  snapshots: ReadonlyArray<SharpeSnapshot>,
): SharpeInstanceSummary[] {
  const byInstance = new Map<string, SharpeSnapshot[]>();
  for (const snap of snapshots) {
    const arr = byInstance.get(snap.instance) ?? [];
    arr.push(snap);
    byInstance.set(snap.instance, arr);
  }

  const summaries: SharpeInstanceSummary[] = [];
  for (const [instance, snaps] of byInstance) {
    const sorted = [...snaps].sort((a, b) =>
      a.snapshotDate < b.snapshotDate ? -1 : a.snapshotDate > b.snapshotDate ? 1 : 0,
    );
    const latest = sorted[sorted.length - 1];
    const lookback = sorted.length >= 8 ? sorted[sorted.length - 8] : null;

    let trend: SharpeTrend = 'insufficient';
    if (latest.rollingSharpe60d !== null && lookback && lookback.rollingSharpe60d !== null) {
      const delta = latest.rollingSharpe60d - lookback.rollingSharpe60d;
      if (delta > 0.05) trend = 'rising';
      else if (delta < -0.05) trend = 'falling';
      else trend = 'flat';
    }

    summaries.push({
      instance,
      latestSharpe60d: latest.rollingSharpe60d,
      nDays: latest.nDays,
      trend,
      latestSnapshotDate: latest.snapshotDate,
    });
  }

  // Stable order: alphabetical by instance.
  summaries.sort((a, b) => (a.instance < b.instance ? -1 : a.instance > b.instance ? 1 : 0));
  return summaries;
}

/**
 * Determines the US/Central snapshot date for a given Date. Uses the
 * Intl.DateTimeFormat path so DST transitions are handled correctly.
 */
export function formatSnapshotDate(now: Date, timeZone = 'America/Chicago'): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now); // 'YYYY-MM-DD'
}
