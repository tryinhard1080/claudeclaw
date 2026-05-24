import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeMarket, fetchActiveMarkets } from './gamma-client.js';

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

  it('propagates description through to the normalized Market (Sprint 28)', () => {
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      description: 'Resolves YES if X happens before 2026-12-31 23:59 UTC, per UMA.',
      outcomes: '["Yes","No"]', outcomePrices: '["0.42","0.58"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      endDate: '2026-12-31T23:59:59Z', closed: false,
    };
    const m = normalizeMarket(raw);
    expect(m).not.toBeNull();
    expect(m!.description).toBe('Resolves YES if X happens before 2026-12-31 23:59 UTC, per UMA.');
  });

  it('leaves description undefined when Gamma omits it (Sprint 28)', () => {
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      outcomes: '["Yes","No"]', outcomePrices: '["0.42","0.58"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      endDate: '2026-12-31T23:59:59Z', closed: false,
    };
    const m = normalizeMarket(raw);
    expect(m).not.toBeNull();
    expect(m!.description).toBeUndefined();
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

describe('fetchActiveMarkets (parallel pagination)', () => {
  function mkRawMarket(slug: string): unknown {
    return {
      conditionId: '0x' + slug, slug, question: `Will ${slug}?`,
      outcomes: '["Yes","No"]', outcomePrices: '["0.5","0.5"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      endDate: '2026-12-31T23:59:59Z', closed: false,
    };
  }

  function mkPage(start: number, count: number): unknown[] {
    return Array.from({ length: count }, (_, i) => mkRawMarket(`m${start + i}`));
  }

  // Parses out limit and offset from a Gamma URL.
  function parseLimitOffset(url: string): { limit: number; offset: number } {
    const u = new URL(url);
    return {
      limit: Number(u.searchParams.get('limit')),
      offset: Number(u.searchParams.get('offset')),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('plumbs pageSize into limit= and starts offset=0', async () => {
    const calls: { limit: number; offset: number }[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(parseLimitOffset(url));
      // Return one partial page so we exit after the first batch.
      const { offset, limit } = parseLimitOffset(url);
      const items = offset === 0 ? mkPage(0, limit - 1) : [];
      return new Response(JSON.stringify(items), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchActiveMarkets(10, 1);
    expect(calls[0]).toEqual({ limit: 10, offset: 0 });
  });

  it('issues `concurrency` parallel requests per batch', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      // Tiny delay to ensure all peers in the batch are observably in-flight.
      await new Promise(r => setTimeout(r, 5));
      inflight--;
      const { offset, limit } = parseLimitOffset(String(input));
      // First batch (offsets 0,10,20,30): full pages. Then the next batch
      // returns a partial page on its first offset to terminate cleanly.
      if (offset < 40) return new Response(JSON.stringify(mkPage(offset, limit)), { status: 200 });
      return new Response(JSON.stringify(mkPage(offset, 1)), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchActiveMarkets(10, 4);
    expect(maxInflight).toBe(4);
  });

  it('advances offset by concurrency * pageSize between batches', async () => {
    const offsets: number[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const { offset, limit } = parseLimitOffset(String(input));
      offsets.push(offset);
      // Two full batches, then a partial page in the third batch's first slot.
      if (offset < 20) return new Response(JSON.stringify(mkPage(offset, limit)), { status: 200 });
      if (offset === 20) return new Response(JSON.stringify(mkPage(offset, 1)), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchActiveMarkets(10, 2);
    // Batch 1: offsets 0, 10. Batch 2: offsets 20, 30.
    expect(offsets.slice(0, 2).sort((a, b) => a - b)).toEqual([0, 10]);
    expect(offsets.slice(2, 4).sort((a, b) => a - b)).toEqual([20, 30]);
  });

  it('terminates when a page comes back empty mid-batch', async () => {
    let totalCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      totalCalls++;
      const { offset, limit } = parseLimitOffset(String(input));
      // Batch 1: page at offset 0 is full, page at offset 10 is empty.
      if (offset === 0) return new Response(JSON.stringify(mkPage(0, limit)), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchActiveMarkets(10, 2);
    expect(totalCalls).toBe(2); // first batch only — no second batch issued
    expect(result).toHaveLength(10);
  });

  it('terminates after a partial page (page.length < pageSize)', async () => {
    let totalCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      totalCalls++;
      const { offset, limit } = parseLimitOffset(String(input));
      // Batch 1: offset 0 full, offset 10 partial (3 items). Should stop.
      if (offset === 0) return new Response(JSON.stringify(mkPage(0, limit)), { status: 200 });
      if (offset === 10) return new Response(JSON.stringify(mkPage(10, 3)), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchActiveMarkets(10, 2);
    expect(totalCalls).toBe(2);
    expect(result).toHaveLength(13); // 10 + 3
  });

  it('preserves first-to-last order across batches', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const { offset, limit } = parseLimitOffset(String(input));
      if (offset < 20) return new Response(JSON.stringify(mkPage(offset, limit)), { status: 200 });
      if (offset === 20) return new Response(JSON.stringify(mkPage(offset, 5)), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchActiveMarkets(10, 2);
    expect(result.map(m => m.slug)).toEqual(
      Array.from({ length: 25 }, (_, i) => `m${i}`),
    );
  });

  it('rejects when any page in a batch fails (Promise.all behavior)', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const { offset } = parseLimitOffset(String(input));
      if (offset === 10) {
        // Surface a non-OK response → getJson throws.
        return new Response('boom', { status: 500 });
      }
      return new Response(JSON.stringify(mkPage(offset, 10)), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchActiveMarkets(10, 2)).rejects.toThrow(/Gamma 500/);
  });
});
