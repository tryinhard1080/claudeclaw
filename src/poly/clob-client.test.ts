import { describe, it, expect } from 'vitest';
import { parseBook, bestAskAndDepth } from './clob-client.js';

describe('parseBook / bestAskAndDepth', () => {
  it('returns best ask and summed ask depth', () => {
    const b = parseBook({ bids: [{ price: '0.41', size: '100' }], asks: [{ price: '0.43', size: '50' }, { price: '0.44', size: '100' }] });
    const r = bestAskAndDepth(b);
    expect(r.bestAsk).toBe(0.43);
    expect(r.askDepthShares).toBe(150);
  });

  it('returns nulls on empty book', () => {
    const b = parseBook({ bids: [], asks: [] });
    const r = bestAskAndDepth(b);
    expect(r.bestAsk).toBeNull();
    expect(r.askDepthShares).toBe(0);
  });
});
