import { describe, it, expect } from 'vitest';
import {
  computeDailyReturn,
  computeRollingSharpe,
  summarizeSharpe,
  formatSnapshotDate,
  type SharpeSnapshot,
} from './sharpe.js';

describe('computeDailyReturn', () => {
  it('returns null when yesterdayEquity is null (first day per instance)', () => {
    expect(computeDailyReturn(100, null)).toBeNull();
  });

  it('returns null when yesterdayEquity is zero (degenerate)', () => {
    expect(computeDailyReturn(100, 0)).toBeNull();
  });

  it('returns null when either input is non-finite', () => {
    expect(computeDailyReturn(NaN, 100)).toBeNull();
    expect(computeDailyReturn(100, NaN)).toBeNull();
    expect(computeDailyReturn(Infinity, 100)).toBeNull();
    expect(computeDailyReturn(100, -Infinity)).toBeNull();
  });

  it('computes positive return when equity rises', () => {
    expect(computeDailyReturn(101, 100)).toBeCloseTo(0.01, 10);
  });

  it('computes negative return when equity falls', () => {
    expect(computeDailyReturn(99, 100)).toBeCloseTo(-0.01, 10);
  });

  it('handles fractional dollars correctly', () => {
    // (103300.04 - 103100.00) / 103100.00 = 0.0019402521823471736
    expect(computeDailyReturn(103300.04, 103100.00)).toBeCloseTo(0.00194025, 7);
  });
});

describe('computeRollingSharpe', () => {
  it('returns null sharpe when input is empty', () => {
    expect(computeRollingSharpe([])).toEqual({ sharpe: null, nDays: 0 });
  });

  it('returns null sharpe when input has one value (no std possible)', () => {
    expect(computeRollingSharpe([0.01])).toEqual({ sharpe: null, nDays: 1 });
  });

  it('returns null sharpe when std is zero (constant returns)', () => {
    const returns = Array(60).fill(0.005);
    const { sharpe, nDays } = computeRollingSharpe(returns);
    expect(sharpe).toBeNull();
    expect(nDays).toBe(60);
  });

  it('returns sharpe = 0 when mean is exactly zero (rf=0 default)', () => {
    const returns = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
    const { sharpe, nDays } = computeRollingSharpe(returns);
    expect(sharpe).not.toBeNull();
    expect(sharpe!).toBeCloseTo(0, 10);
    expect(nDays).toBe(6);
  });

  it('annualizes correctly with default periodsPerYear=252', () => {
    // Mean = 0.0004, std ≈ 0.012 (SPY-like). Expected Sharpe ≈ 0.5292.
    // Use a deterministic seed-ish sequence.
    const returns = [
      0.012, -0.011, 0.013, -0.010, 0.011, -0.009, 0.014, -0.012, 0.010, -0.008,
      0.012, -0.011, 0.013, -0.010, 0.011, -0.009, 0.014, -0.012, 0.010, -0.008,
      0.012, -0.011, 0.013, -0.010, 0.011, -0.009, 0.014, -0.012, 0.010, -0.008,
      0.012, -0.011, 0.013, -0.010, 0.011, -0.009, 0.014, -0.012, 0.010, -0.008,
      0.012, -0.011, 0.013, -0.010, 0.011, -0.009, 0.014, -0.012, 0.010, -0.008,
      0.012, -0.011, 0.013, -0.010, 0.011, -0.009, 0.014, -0.012, 0.010, -0.008,
    ];
    const { sharpe, nDays } = computeRollingSharpe(returns);
    expect(nDays).toBe(60);
    expect(sharpe).not.toBeNull();
    expect(sharpe!).toBeGreaterThan(0);
    expect(sharpe!).toBeLessThan(5); // sanity: in plausible range
  });

  it('uses sample std (ddof=1), not population std', () => {
    // Two values: 0.01 and 0.03. Mean = 0.02, sample std = sqrt((0.01^2+0.01^2)/1) = 0.01414...
    // Sharpe = (0.02 - 0) * sqrt(252) / 0.01414 ≈ 22.45.
    const { sharpe } = computeRollingSharpe([0.01, 0.03]);
    expect(sharpe).toBeCloseTo((0.02 * Math.sqrt(252)) / Math.sqrt(2 * 0.0001), 3);
  });

  it('applies non-zero risk-free rate when provided', () => {
    // rf=0.04 annualized → 0.04/252 daily ≈ 0.0001587 subtracted from mean before scaling.
    const returns = [0.005, 0.005, 0.005, 0.006, 0.004, 0.005, 0.005, 0.006];
    const zeroRf = computeRollingSharpe(returns, { riskFreeRate: 0 });
    const fourPct = computeRollingSharpe(returns, { riskFreeRate: 0.04 });
    expect(zeroRf.sharpe).not.toBeNull();
    expect(fourPct.sharpe).not.toBeNull();
    expect(fourPct.sharpe!).toBeLessThan(zeroRf.sharpe!);
  });

  it('respects windowSize override', () => {
    const returns = Array.from({ length: 90 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.005));
    const sixty = computeRollingSharpe(returns, { windowSize: 60 });
    const thirty = computeRollingSharpe(returns, { windowSize: 30 });
    expect(sixty.nDays).toBe(60);
    expect(thirty.nDays).toBe(30);
  });

  it('filters non-finite values defensively', () => {
    const returns = [0.01, NaN, 0.02, Infinity, -0.005, 0.015];
    const { nDays } = computeRollingSharpe(returns);
    expect(nDays).toBe(4); // NaN + Infinity dropped
  });

  it('uses only last windowSize entries when input exceeds window', () => {
    // First 60 entries are large positive returns, last 60 are zeros.
    // Window of last 60 should yield zero mean → either null (std=0) or 0 (std>0).
    const returns = [
      ...Array.from({ length: 60 }, () => 0.05),
      ...Array.from({ length: 60 }, () => 0.0),
    ];
    const { sharpe, nDays } = computeRollingSharpe(returns, { windowSize: 60 });
    expect(nDays).toBe(60);
    expect(sharpe).toBeNull(); // zeros → std=0
  });
});

describe('summarizeSharpe', () => {
  function snap(
    instance: string,
    date: string,
    sharpe: number | null,
    nDays = 60,
  ): SharpeSnapshot {
    return {
      instance,
      snapshotDate: date,
      equity: 100000,
      cash: 20000,
      peakEquity: 101000,
      dailyReturn: 0.001,
      rollingSharpe60d: sharpe,
      nDays,
    };
  }

  it('returns empty array when no snapshots', () => {
    expect(summarizeSharpe([])).toEqual([]);
  });

  it('returns one summary per instance', () => {
    const out = summarizeSharpe([
      snap('spy-aggressive', '2026-05-12', 0.4),
      snap('spy-conservative', '2026-05-12', 0.2),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.instance)).toEqual(['spy-aggressive', 'spy-conservative']);
  });

  it('reports latest snapshot per instance regardless of input order', () => {
    const out = summarizeSharpe([
      snap('spy-aggressive', '2026-05-10', 0.1),
      snap('spy-aggressive', '2026-05-12', 0.4),
      snap('spy-aggressive', '2026-05-11', 0.3),
    ]);
    expect(out[0].latestSharpe60d).toBe(0.4);
    expect(out[0].latestSnapshotDate).toBe('2026-05-12');
  });

  it('marks trend as insufficient when fewer than 8 snapshots', () => {
    const out = summarizeSharpe([
      snap('spy-aggressive', '2026-05-12', 0.4),
      snap('spy-aggressive', '2026-05-11', 0.3),
    ]);
    expect(out[0].trend).toBe('insufficient');
  });

  it('marks trend rising when latest exceeds 7-day lookback by >0.05', () => {
    const dates = Array.from({ length: 8 }, (_, i) => `2026-05-${(5 + i).toString().padStart(2, '0')}`);
    const sharpes = [0.1, 0.15, 0.18, 0.2, 0.22, 0.25, 0.28, 0.4];
    const snaps = dates.map((d, i) => snap('x', d, sharpes[i]));
    const out = summarizeSharpe(snaps);
    expect(out[0].trend).toBe('rising');
  });

  it('marks trend falling when latest is below 7-day lookback by >0.05', () => {
    const dates = Array.from({ length: 8 }, (_, i) => `2026-05-${(5 + i).toString().padStart(2, '0')}`);
    const sharpes = [0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.1];
    const snaps = dates.map((d, i) => snap('x', d, sharpes[i]));
    const out = summarizeSharpe(snaps);
    expect(out[0].trend).toBe('falling');
  });

  it('marks trend flat when delta within +/-0.05 band', () => {
    const dates = Array.from({ length: 8 }, (_, i) => `2026-05-${(5 + i).toString().padStart(2, '0')}`);
    const sharpes = [0.4, 0.41, 0.42, 0.43, 0.42, 0.41, 0.4, 0.42];
    const snaps = dates.map((d, i) => snap('x', d, sharpes[i]));
    const out = summarizeSharpe(snaps);
    expect(out[0].trend).toBe('flat');
  });

  it('marks trend insufficient when either side has null sharpe', () => {
    const dates = Array.from({ length: 8 }, (_, i) => `2026-05-${(5 + i).toString().padStart(2, '0')}`);
    const sharpes: Array<number | null> = [null, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
    const snaps = dates.map((d, i) => snap('x', d, sharpes[i]));
    const out = summarizeSharpe(snaps);
    expect(out[0].trend).toBe('insufficient');
  });
});

describe('formatSnapshotDate', () => {
  it('formats a UTC date as US/Central YYYY-MM-DD', () => {
    // 2026-05-12 23:00 UTC = 2026-05-12 18:00 CT (CDT)
    const utc = new Date('2026-05-12T23:00:00Z');
    expect(formatSnapshotDate(utc)).toBe('2026-05-12');
  });

  it('rolls to next day in CT when UTC has crossed midnight CT', () => {
    // 2026-05-13 05:30 UTC = 2026-05-13 00:30 CT (next day in CT)
    const utc = new Date('2026-05-13T05:30:00Z');
    expect(formatSnapshotDate(utc)).toBe('2026-05-13');
  });

  it('stays on the previous CT day when UTC just past midnight UTC', () => {
    // 2026-05-13 03:00 UTC = 2026-05-12 22:00 CT (still 2026-05-12 in CT)
    const utc = new Date('2026-05-13T03:00:00Z');
    expect(formatSnapshotDate(utc)).toBe('2026-05-12');
  });

  it('accepts a custom timezone override', () => {
    const utc = new Date('2026-05-12T23:00:00Z');
    // London is UTC+1 in May (BST)
    expect(formatSnapshotDate(utc, 'Europe/London')).toBe('2026-05-13');
  });
});
