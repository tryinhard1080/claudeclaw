import { describe, it, expect } from 'vitest';
import { parseBook, bestAskAndDepth } from './clob-client.js';

describe('parseBook / bestAskAndDepth', () => {
  it('returns best ask and depth at the best level only (Sprint R3)', () => {
    // Deeper levels are NOT executable at bestAsk; the paper broker fills the
    // whole order at bestAsk, so depth must reflect the best level only.
    const b = parseBook({ bids: [{ price: '0.41', size: '100' }], asks: [{ price: '0.43', size: '50' }, { price: '0.44', size: '100' }] });
    const r = bestAskAndDepth(b);
    expect(r.bestAsk).toBe(0.43);
    expect(r.askDepthShares).toBe(50);
  });

  it('sums multiple entries at the same best price level', () => {
    const b = parseBook({ bids: [], asks: [{ price: '0.43', size: '50' }, { price: '0.43', size: '25' }, { price: '0.44', size: '100' }] });
    const r = bestAskAndDepth(b);
    expect(r.bestAsk).toBe(0.43);
    expect(r.askDepthShares).toBe(75);
  });

  it('returns nulls on empty book', () => {
    const b = parseBook({ bids: [], asks: [] });
    const r = bestAskAndDepth(b);
    expect(r.bestAsk).toBeNull();
    expect(r.askDepthShares).toBe(0);
  });
});
