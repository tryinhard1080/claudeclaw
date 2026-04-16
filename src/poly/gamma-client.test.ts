import { describe, it, expect } from 'vitest';
import { normalizeMarket } from './gamma-client.js';

describe('normalizeMarket', () => {
  it('zips outcomes, tokenIds, and prices into structured array', () => {
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      outcomes: '["Yes","No"]', outcomePrices: '["0.42","0.58"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      endDate: '2026-12-31T23:59:59Z', closed: false,
    };
    const m = normalizeMarket(raw);
    expect(m).not.toBeNull();
    expect(m!.outcomes).toEqual([
      { label: 'Yes', tokenId: 't1', price: 0.42 },
      { label: 'No',  tokenId: 't2', price: 0.58 },
    ]);
    expect(m!.endDate).toBeGreaterThan(1_700_000_000);
  });

  it('throws on mismatched array lengths', () => {
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      outcomes: '["Yes","No"]', outcomePrices: '["0.42"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      endDate: '2026-12-31T23:59:59Z', closed: false,
    };
    expect(() => normalizeMarket(raw)).toThrow();
  });

  it('returns null when endDate is missing (common in Gamma list responses)', () => {
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      outcomes: '["Yes","No"]', outcomePrices: '["0.42","0.58"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      closed: false,
    };
    expect(normalizeMarket(raw)).toBeNull();
  });

  it('returns null when endDate is explicitly null', () => {
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      outcomes: '["Yes","No"]', outcomePrices: '["0.42","0.58"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      endDate: null, closed: false,
    };
    expect(normalizeMarket(raw)).toBeNull();
  });

  it('parses successfully with requireEndDate=false even when endDate missing (resolution path)', () => {
    // PnlTracker uses this path. Returning null here would conflate
    // "Gamma omitted endDate" with "market delisted", causing every
    // open trade against such a market to be voided at zero P&L.
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      outcomes: '["Yes","No"]', outcomePrices: '["1","0"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      closed: true,
    };
    const m = normalizeMarket(raw, { requireEndDate: false });
    expect(m).not.toBeNull();
    expect(m!.closed).toBe(true);
    expect(m!.endDate).toBe(0);
    expect(m!.outcomes[0]!.price).toBe(1);  // resolution still readable
  });

  it('returns null when outcomePrices missing (scanner mode)', () => {
    // Real failure mode observed 2026-04-16: Gamma API returned markets
    // with outcomePrices: undefined, Zod threw, per-item warn spammed logs.
    // Post-fix: parse cleanly, skip the market without warn.
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      outcomes: '["Yes","No"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      endDate: '2026-12-31T23:59:59Z', closed: false,
    };
    expect(normalizeMarket(raw)).toBeNull();
  });

  it('returns null when outcomePrices missing (resolution mode)', () => {
    // In resolution mode we usually tolerate partial data (e.g. missing
    // endDate). But a market with no prices has nothing to resolve at —
    // PnlTracker has no P&L to compute. Skip cleanly instead of throwing.
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      outcomes: '["Yes","No"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      closed: true,
    };
    expect(normalizeMarket(raw, { requireEndDate: false })).toBeNull();
  });

  it('returns null when outcomePrices is explicitly null', () => {
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      outcomes: '["Yes","No"]', outcomePrices: null,
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      endDate: '2026-12-31T23:59:59Z', closed: false,
    };
    expect(normalizeMarket(raw)).toBeNull();
  });
});
