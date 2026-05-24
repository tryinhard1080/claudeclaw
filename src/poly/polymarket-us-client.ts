const DEFAULT_BASE_URL = 'https://gateway.polymarket.us';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PolymarketUsAmount {
  value: string | number;
  currency?: string;
}

export interface PolymarketUsMarket {
  id?: number | string;
  slug: string;
  question?: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  bestBid?: number | string | null;
  bestAsk?: number | string | null;
  lastTradePrice?: number | string | null;
}

export interface PolymarketUsBookLevel {
  px: PolymarketUsAmount;
  qty: string;
}

export interface PolymarketUsBook {
  marketData: {
    marketSlug: string;
    bids: PolymarketUsBookLevel[];
    offers: PolymarketUsBookLevel[];
    stats?: Record<string, unknown>;
    transactTime?: string;
  };
}

export interface PolymarketUsBbo {
  marketData: {
    marketSlug: string;
    bestBid?: PolymarketUsAmount | null;
    bestAsk?: PolymarketUsAmount | null;
    currentPx?: PolymarketUsAmount | null;
    [key: string]: unknown;
  };
}

export interface ListPolymarketUsMarketsParams {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  categories?: string[];
  volumeNumMin?: number;
  liquidityNumMin?: number;
}

export interface PolymarketUsReadOnlyClient {
  readonly venue: 'polymarket-us-read-only';
  listMarkets(params?: ListPolymarketUsMarketsParams): Promise<PolymarketUsMarket[]>;
  fetchMarketBySlug(slug: string): Promise<PolymarketUsMarket | null>;
  fetchBook(slug: string): Promise<PolymarketUsBook>;
  fetchBbo(slug: string): Promise<PolymarketUsBbo>;
}

function appendParam(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) url.searchParams.append(key, String(item));
    return;
  }
  url.searchParams.set(key, String(value));
}

async function getJson(fetcher: FetchLike, url: URL): Promise<unknown> {
  const res = await fetcher(url.toString(), { method: 'GET' });
  if (!res.ok) throw new Error(`Polymarket US ${res.status}: ${url.toString()}`);
  return res.json();
}

function marketArrayFromList(raw: unknown): PolymarketUsMarket[] {
  if (Array.isArray(raw)) return raw as PolymarketUsMarket[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { markets?: unknown }).markets)) {
    return (raw as { markets: PolymarketUsMarket[] }).markets;
  }
  return [];
}

export function createPolymarketUsReadOnlyClient(opts: {
  baseUrl?: string;
  fetcher?: FetchLike;
} = {}): PolymarketUsReadOnlyClient {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const fetcher = opts.fetcher ?? fetch;

  const urlFor = (pathname: string): URL => new URL(pathname, baseUrl);

  return {
    venue: 'polymarket-us-read-only',

    async listMarkets(params: ListPolymarketUsMarketsParams = {}): Promise<PolymarketUsMarket[]> {
      const url = urlFor('/v1/markets');
      for (const [key, value] of Object.entries(params)) appendParam(url, key, value);
      return marketArrayFromList(await getJson(fetcher, url));
    },

    async fetchMarketBySlug(slug: string): Promise<PolymarketUsMarket | null> {
      const raw = await getJson(fetcher, urlFor(`/v1/market/slug/${encodeURIComponent(slug)}`));
      if (raw && typeof raw === 'object') return raw as PolymarketUsMarket;
      return null;
    },

    async fetchBook(slug: string): Promise<PolymarketUsBook> {
      return await getJson(fetcher, urlFor(`/v1/markets/${encodeURIComponent(slug)}/book`)) as PolymarketUsBook;
    },

    async fetchBbo(slug: string): Promise<PolymarketUsBbo> {
      return await getJson(fetcher, urlFor(`/v1/markets/${encodeURIComponent(slug)}/bbo`)) as PolymarketUsBbo;
    },
  };
}

