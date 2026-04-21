import { describe, it, expect } from 'vitest';
import { buildPnlBars, type DailyPnlPoint } from './dashboard-charts.js';

function point(day: string, pnl: number, n = 1): DailyPnlPoint {
  return { day, pnl, n };
}

describe('buildPnlBars', () => {
  it('returns empty bars for empty data', () => {
    const out = buildPnlBars([], { width: 300, height: 60 });
    expect(out.bars).toEqual([]);
    expect(out.cumTotal).toBe(0);
    expect(out.maxAbs).toBe(0);
  });

  it('renders a single positive bar above the zero axis', () => {
    const out = buildPnlBars([point('2026-04-26', 25, 3)], { width: 300, height: 60 });
    expect(out.bars).toHaveLength(1);
    const b = out.bars[0]!;
    expect(b.color).toBe('#6ee7b7');
    expect(b.y).toBeLessThan(out.zeroY);             // positive → above axis (smaller y)
    expect(b.y + b.height).toBeCloseTo(out.zeroY);   // bar top-edge reaches axis
    expect(b.label).toContain('2026-04-26');
    expect(b.label).toContain('+$25');
    expect(out.cumTotal).toBe(25);
    expect(out.maxAbs).toBe(25);
  });

  it('renders a single negative bar below the zero axis', () => {
    const out = buildPnlBars([point('2026-04-26', -15)], { width: 300, height: 60 });
    const b = out.bars[0]!;
    expect(b.color).toBe('#f87171');
    expect(b.y).toBeCloseTo(out.zeroY);              // negative → starts at axis
    expect(b.height).toBeGreaterThan(0);
    expect(b.label).toContain('-$15');
    expect(out.cumTotal).toBe(-15);
  });

  it('scales multiple bars relative to maxAbs', () => {
    const data = [point('d1', 10), point('d2', -30), point('d3', 20)];
    const out = buildPnlBars(data, { width: 300, height: 60, padding: 0 });
    expect(out.maxAbs).toBe(30);
    const big = out.bars[1]!;   // -30
    const mid = out.bars[2]!;   // +20
    const small = out.bars[0]!; // +10
    expect(big.height).toBeCloseTo(30, 0);  // half-height = 30 when height=60
    expect(mid.height).toBeCloseTo(20, 0);
    expect(small.height).toBeCloseTo(10, 0);
  });

  it('spaces bars horizontally across the plot width with padding', () => {
    const data = [point('a', 1), point('b', 1), point('c', 1), point('d', 1)];
    const out = buildPnlBars(data, { width: 320, height: 60, padding: 10 });
    expect(out.bars).toHaveLength(4);
    // usable width = 320 - 20 = 300, per-slot = 75
    expect(out.bars[1]!.x - out.bars[0]!.x).toBeCloseTo(75, 0);
    expect(out.bars[3]!.x - out.bars[2]!.x).toBeCloseTo(75, 0);
    // first bar left edge inside padding
    expect(out.bars[0]!.x).toBeGreaterThanOrEqual(10);
    // last bar right edge within width minus padding
    const last = out.bars[3]!;
    expect(last.x + last.width).toBeLessThanOrEqual(310 + 0.01);
  });

  it('cumTotal is simple sum including negatives', () => {
    const out = buildPnlBars(
      [point('a', 10), point('b', -5), point('c', 20), point('d', -8)],
      { width: 300, height: 60 },
    );
    expect(out.cumTotal).toBe(17);
  });

  it('zeroY is centered when max positive equals max negative', () => {
    const out = buildPnlBars([point('a', 10), point('b', -10)], { width: 300, height: 60 });
    expect(out.zeroY).toBeCloseTo(30, 0); // height/2
  });

  it('bar width fits within its slot with small gap', () => {
    const out = buildPnlBars([point('a', 1), point('b', 1)], { width: 200, height: 60, padding: 0 });
    const slot = 100;
    expect(out.bars[0]!.width).toBeGreaterThan(0);
    expect(out.bars[0]!.width).toBeLessThan(slot);
  });

  it('uses gray for zero-pnl day', () => {
    const out = buildPnlBars([point('a', 0, 2)], { width: 300, height: 60 });
    expect(out.bars[0]!.color).toBe('#9ca3af');
    expect(out.bars[0]!.height).toBe(0);
  });

  it('label includes trade count when n > 1', () => {
    const out = buildPnlBars([point('2026-04-26', 25, 4)], { width: 300, height: 60 });
    expect(out.bars[0]!.label).toContain('4 trades');
  });

  it('label uses singular trade when n = 1', () => {
    const out = buildPnlBars([point('2026-04-26', 5, 1)], { width: 300, height: 60 });
    expect(out.bars[0]!.label).toMatch(/1 trade\b/);
  });
});
