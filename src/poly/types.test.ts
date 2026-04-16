import { describe, it, expect } from 'vitest';
import { GammaMarketSchema, ClobBookSchema } from './types.js';

describe('GammaMarketSchema', () => {
  it('parses a minimal valid market', () => {
    const raw = {
      conditionId: '0xabc',
      slug: 'will-x-happen',
      question: 'Will X happen?',
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.42","0.58"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 12345.6,
      liquidity: 999,
      endDate: '2026-12-31T23:59:59Z',
      closed: false,
    };
    const parsed = GammaMarketSchema.parse(raw);
    expect(parsed.slug).toBe('will-x-happen');
    expect(parsed.outcomes).toEqual(['Yes', 'No']);
    expect(parsed.outcomePrices).toEqual([0.42, 0.58]);
    expect(parsed.clobTokenIds).toEqual(['t1', 't2']);
  });

  it('rejects malformed outcomes json', () => {
    const raw = {
      conditionId: '0xabc',
      slug: 'will-x-happen',
      question: 'Will X happen?',
      outcomes: 'not-json',
      outcomePrices: '["0.42","0.58"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 12345.6,
      liquidity: 999,
      endDate: '2026-12-31T23:59:59Z',
      closed: false,
    };
    expect(() => GammaMarketSchema.parse(raw)).toThrow();
  });

  it('accepts payload with outcomePrices omitted (Gamma sometimes returns unpriced markets)', () => {
    // Real-world: Polymarket Gamma returns pre-listed / transitional markets
    // without outcomePrices. Schema must accept; normalizeMarket decides skip.
    const raw = {
      conditionId: '0xabc',
      slug: 'will-x-happen',
      question: 'Will X happen?',
      outcomes: '["Yes","No"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 12345.6,
      liquidity: 999,
      endDate: '2026-12-31T23:59:59Z',
      closed: false,
    };
    const parsed = GammaMarketSchema.parse(raw);
    expect(parsed.slug).toBe('will-x-happen');
    expect(parsed.outcomePrices).toBeFalsy();
  });

  it('accepts payload with outcomePrices explicitly null', () => {
    const raw = {
      conditionId: '0xabc',
      slug: 'will-x-happen',
      question: 'Will X happen?',
      outcomes: '["Yes","No"]',
      outcomePrices: null,
      clobTokenIds: '["t1","t2"]',
      volume24hr: 12345.6,
      liquidity: 999,
      endDate: '2026-12-31T23:59:59Z',
      closed: false,
    };
    const parsed = GammaMarketSchema.parse(raw);
    expect(parsed.slug).toBe('will-x-happen');
    expect(parsed.outcomePrices).toBeFalsy();
  });
});

describe('ClobBookSchema', () => {
  it('parses book with string numerics', () => {
    const parsed = ClobBookSchema.parse({
      bids: [{ price: '0.41', size: '100' }],
      asks: [{ price: '0.43', size: '50' }],
    });
    expect(parsed.asks[0]!.price).toBe(0.43);
    expect(parsed.bids[0]!.size).toBe(100);
  });
});
