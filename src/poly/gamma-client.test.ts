import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeMarket, fetchActiveMarkets, fetchMarketBySlug } from './gamma-client.js';

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

  // Parses out discovery params from a Gamma URL.
  function parseDiscoveryParams(url: string): {
    limit: number;
    offset: number;
    order: string | null;
    ascending: string | null;
  } {
    const u = new URL(url);
    return {
      limit: Number(u.searchParams.get('limit')),
      offset: Number(u.searchParams.get('offset')),
      order: u.searchParams.get('order'),
      ascending: u.searchParams.get('ascending'),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('plumbs pageSize into limit= and starts offset=0', async () => {
    const calls: ReturnType<typeof parseDiscoveryParams>[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(parseDiscoveryParams(url));
      // Return one partial page so we exit after the first batch.
      const { offset, limit } = parseDiscoveryParams(url);
      const items = offset === 0 ? mkPage(0, limit - 1) : [];
      return new Response(JSON.stringify(items), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchActiveMarkets(10, 1);
    expect(calls[0]).toEqual({
      limit: 10,
      offset: 0,
      order: 'volume24hr',
      ascending: 'false',
    });
  });

  it('caps requests at the live Gamma markets page limit', async () => {
    const calls: ReturnType<typeof parseDiscoveryParams>[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const params = parseDiscoveryParams(String(input));
      calls.push(params);
      return new Response(JSON.stringify(mkPage(params.offset, params.limit)), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchActiveMarkets(500, 1, 1);
    expect(calls).toEqual([{
      limit: 100,
      offset: 0,
      order: 'volume24hr',
      ascending: 'false',
    }]);
    expect(result).toHaveLength(100);
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
      const { offset, limit } = parseDiscoveryParams(String(input));
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
      const { offset, limit } = parseDiscoveryParams(String(input));
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
      const { offset, limit } = parseDiscoveryParams(String(input));
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
      const { offset, limit } = parseDiscoveryParams(String(input));
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
      const { offset, limit } = parseDiscoveryParams(String(input));
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

  it('stops at maxPages without issuing requests beyond the discovery window', async () => {
    const offsets: number[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const { offset, limit } = parseDiscoveryParams(String(input));
      offsets.push(offset);
      return new Response(JSON.stringify(mkPage(offset, limit)), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchActiveMarkets(10, 2, 3);
    expect(offsets.sort((a, b) => a - b)).toEqual([0, 10, 20]);
    expect(result).toHaveLength(30);
  });

  it('rejects when any page in a batch fails (Promise.all behavior)', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const { offset } = parseDiscoveryParams(String(input));
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

describe('fetchMarketBySlug (resolution path)', () => {
  // Live Gamma behavior verified 2026-07-18: `/markets?slug=X` EXCLUDES closed
  // markets by default. A resolved market returns an empty array (HTTP 200) on
  // the plain query and is only visible with `closed=true`. Without the
  // fallback, every resolved market reads as "delisted" and no trade can ever
  // settle (poly_resolutions: 468 rows, 0 ever closed).
  const resolvedRaw = {
    conditionId: '0xres', slug: 'resolved-market', question: 'Did it happen?',
    outcomes: '["Yes","No"]', outcomePrices: '["1","0"]',
    clobTokenIds: '["t1","t2"]',
    volume24hr: 0, liquidity: 0,
    endDate: '2026-07-12T23:59:59Z', closed: true,
  };
  const openRaw = {
    conditionId: '0xopen', slug: 'open-market', question: 'Will it happen?',
    outcomes: '["Yes","No"]', outcomePrices: '["0.4","0.6"]',
    clobTokenIds: '["t1","t2"]',
    volume24hr: 100, liquidity: 50,
    endDate: '2026-12-31T23:59:59Z', closed: false,
  };

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('falls back to closed=true when the plain slug query returns empty (resolved market)', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      const closed = new URL(url).searchParams.get('closed');
      // Mirror live Gamma: resolved market invisible without closed=true.
      const body = closed === 'true' ? [resolvedRaw] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const m = await fetchMarketBySlug('resolved-market');
    expect(m).not.toBeNull();
    expect(m!.closed).toBe(true);
    expect(m!.outcomes.map(o => o.price)).toEqual([1, 0]);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]!).searchParams.get('closed')).toBeNull();
    expect(new URL(urls[1]!).searchParams.get('closed')).toBe('true');
  });

  it('does not issue the fallback query when the plain query finds the market (open market)', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify([openRaw]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const m = await fetchMarketBySlug('open-market');
    expect(m).not.toBeNull();
    expect(m!.closed).toBe(false);
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]!).searchParams.get('closed')).toBeNull();
  });

  it('returns null when both plain and closed=true queries come back empty (true miss)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const m = await fetchMarketBySlug('never-existed');
    expect(m).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null (not throw) when the fallback query fails', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const closed = new URL(String(input)).searchParams.get('closed');
      if (closed === 'true') return new Response('boom', { status: 500 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMarketBySlug('flaky')).resolves.toBeNull();
  });
});
