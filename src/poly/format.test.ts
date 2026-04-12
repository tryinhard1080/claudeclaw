import { describe, it, expect } from 'vitest';
import { truncateForTelegram, fmtUsd, fmtPrice, truncateQuestion } from './format.js';

describe('truncateForTelegram', () => {
  it('returns input unchanged under cap', () => {
    expect(truncateForTelegram('hi', 10)).toEqual({ text: 'hi', truncated: 0 });
  });
  it('truncates with footer', () => {
    const long = 'x'.repeat(5000);
    const r = truncateForTelegram(long, 100);
    expect(r.truncated).toBeGreaterThan(0);
    expect(r.text.startsWith('x'.repeat(100))).toBe(true);
    expect(r.text).toContain('truncated');
  });
});

describe('fmtUsd / fmtPrice / truncateQuestion', () => {
  it('fmtUsd rounds and adds thousands separators', () => {
    expect(fmtUsd(1234.7)).toBe('$1,235');
    expect(fmtUsd(0)).toBe('$0');
  });
  it('fmtPrice keeps 2 decimals', () => {
    expect(fmtPrice(0.1)).toBe('$0.10');
    expect(fmtPrice(0.555)).toBe('$0.56');
  });
  it('truncateQuestion leaves short strings alone and ellipsizes long ones', () => {
    expect(truncateQuestion('short', 80)).toBe('short');
    const long = 'a'.repeat(100);
    const out = truncateQuestion(long, 20);
    expect(out.length).toBe(20);
    expect(out.endsWith('…')).toBe(true);
  });
});
