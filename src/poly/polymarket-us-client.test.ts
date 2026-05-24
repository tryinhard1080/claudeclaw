import { describe, expect, it } from 'vitest';

import { createPolymarketUsReadOnlyClient } from './polymarket-us-client.js';

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('Polymarket US read-only client', () => {
  it('lists markets through the public gateway with filters', async () => {
    const urls: string[] = [];
    const client = createPolymarketUsReadOnlyClient({
      baseUrl: 'https://gateway.polymarket.us',
      fetcher: async (url) => {
        urls.push(url);
        return fakeResponse({ markets: [{ slug: 'btc-100k-2026', active: true }] });
      },
    });

    const markets = await client.listMarkets({ limit: 20, active: true, categories: ['crypto'] });

    expect(markets).toEqual([{ slug: 'btc-100k-2026', active: true }]);
    expect(urls[0]).toContain('/v1/markets');
    expect(urls[0]).toContain('limit=20');
    expect(urls[0]).toContain('active=true');
    expect(urls[0]).toContain('categories=crypto');
  });

  it('fetches market by slug, book, and BBO using read-only endpoints', async () => {
    const urls: string[] = [];
    const client = createPolymarketUsReadOnlyClient({
      fetcher: async (url) => {
        urls.push(url);
        if (url.includes('/book')) return fakeResponse({ marketData: { marketSlug: 'slug', bids: [], offers: [] } });
        if (url.includes('/bbo')) return fakeResponse({ marketData: { marketSlug: 'slug', bestBid: null, bestAsk: null } });
        return fakeResponse({ slug: 'slug', question: 'Will X happen?' });
      },
    });

    await client.fetchMarketBySlug('slug');
    await client.fetchBook('slug');
    await client.fetchBbo('slug');

    expect(urls[0]).toBe('https://gateway.polymarket.us/v1/market/slug/slug');
    expect(urls[1]).toBe('https://gateway.polymarket.us/v1/markets/slug/book');
    expect(urls[2]).toBe('https://gateway.polymarket.us/v1/markets/slug/bbo');
  });

  it('exposes no order, account, portfolio, or cancellation methods', () => {
    const client = createPolymarketUsReadOnlyClient({ fetcher: async () => fakeResponse({}) });
    const methodNames = Object.keys(client).join(' ').toLowerCase();

    expect(client.venue).toBe('polymarket-us-read-only');
    expect(methodNames).not.toMatch(/order|cancel|modify|trade|portfolio|account|position/);
  });
});

