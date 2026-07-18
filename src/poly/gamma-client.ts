import { logger } from '../logger.js';
import { GammaMarketSchema, type GammaMarket, type Market } from './types.js';

const BASE = 'https://gamma-api.polymarket.com';
const GAMMA_MARKETS_PAGE_LIMIT = 100;
const DEFAULT_MARKET_DISCOVERY_PAGES = 10;

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function getJson(url: string, attempt = 0): Promise<unknown> {
  const res = await fetch(url);
  if (res.status === 429 && attempt < 4) {
    await sleep(1000 * 2 ** attempt);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Gamma ${res.status}: ${url}`);
  return res.json();
}

/**
 * Parse and normalize. Two modes:
 *
 *   - Default (`requireEndDate: true`): returns `null` for structurally
 *     valid markets that lack an endDate. Used by the active-market
 *     scanner because such markets can't pass our TTR risk gate anyway.
 *
 *   - `requireEndDate: false`: tolerates missing endDate (returns
 *     endDate=0). Used by resolution-path lookups (PnlTracker) which
 *     only care about `closed` + `outcomes[i].price`. Without this,
 *     a slug fetch that happens to omit endDate would return null,
 *     classifyResolution would treat that as "delisted", and the
 *     trade would be incorrectly voided at zero P&L.
 *
 * Throws for truly malformed shapes (length mismatches, etc.) so the
 * caller can log + skip.
 */
export function normalizeMarket(
  raw: unknown,
  opts: { requireEndDate?: boolean } = {},
): Market | null {
  const requireEndDate = opts.requireEndDate ?? true;
  const g: GammaMarket = GammaMarketSchema.parse(raw);
  if (!g.endDate && requireEndDate) return null;
  if (!g.outcomePrices) return null;
  if (g.outcomes.length !== g.outcomePrices.length || g.outcomes.length !== g.clobTokenIds.length) {
    throw new Error(`market ${g.slug}: outcome/price/tokenId length mismatch`);
  }
  const outcomes = g.outcomes.map((label, i) => ({
    label,
    tokenId: g.clobTokenIds[i]!,
    price: g.outcomePrices![i]!,
  }));
  return {
    slug: g.slug,
    conditionId: g.conditionId,
    question: g.question,
    category: g.category,
    // Sprint 28: pipe the wire-level resolution-criteria text through.
    description: g.description,
    outcomes,
    volume24h: g.volume24hr,
    liquidity: g.liquidity,
    endDate: g.endDate ? Math.floor(new Date(g.endDate).getTime() / 1000) : 0,
    closed: g.closed,
  };
}

/**
 * Fetch a bounded active-market discovery window from Gamma API.
 *
 * Live Gamma responses cap `/markets` list pages at 100 rows even when a
 * larger limit is requested. Requesting 2000 rows made the scanner stop after
 * the first 100 markets. The default now walks ten 100-row pages ordered by
 * live 24h volume, which feeds the downstream selector a liquid candidate
 * universe without turning each scan into a full historical crawl.
 */
export async function fetchActiveMarkets(
  pageSize = GAMMA_MARKETS_PAGE_LIMIT,
  concurrency = 4,
  maxPages = DEFAULT_MARKET_DISCOVERY_PAGES,
): Promise<Market[]> {
  const safePageSize = Math.min(
    GAMMA_MARKETS_PAGE_LIMIT,
    Math.max(1, Math.floor(pageSize)),
  );
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const safeMaxPages = Math.max(1, Math.floor(maxPages));
  const rawPages: unknown[][] = [];
  let nextPage = 0;
  let exhausted = false;

  while (!exhausted && nextPage < safeMaxPages) {
    const offsets: number[] = [];
    for (let i = 0; i < safeConcurrency && nextPage < safeMaxPages; i++) {
      offsets.push(nextPage * safePageSize);
      nextPage++;
    }

    const pages = await Promise.all(
      offsets.map(o => {
        const params = new URLSearchParams({
          active: 'true',
          closed: 'false',
          order: 'volume24hr',
          ascending: 'false',
          limit: String(safePageSize),
          offset: String(o),
        });
        return getJson(`${BASE}/markets?${params.toString()}`);
      }),
    );

    for (const page of pages) {
      if (!Array.isArray(page) || page.length === 0) {
        exhausted = true;
        break;
      }
      rawPages.push(page);
      if (page.length < safePageSize) {
        exhausted = true;
        break;
      }
    }
  }

  const out: Market[] = [];
  let skippedNoEndDate = 0;
  let skippedMalformed = 0;

  for (const page of rawPages) {
    for (const r of page) {
      try {
        const m = normalizeMarket(r);
        if (m === null) skippedNoEndDate++;
        else out.push(m);
      } catch (e) {
        skippedMalformed++;
        // Per-item warn only for truly malformed shapes; missing endDate
        // is expected enough that a batch summary is sufficient.
        logger.warn({ err: String(e) }, 'skipping malformed market');
      }
    }
  }

  if (skippedNoEndDate > 0 || skippedMalformed > 0) {
    logger.info(
      { parsed: out.length, skippedNoEndDate, skippedMalformed },
      'fetchActiveMarkets skip summary',
    );
  }

  return out;
}

/**
 * Fetch a single market by its numeric id.
 * NOTE: The Gamma API's /markets/{slug} endpoint returns 422 (verified by the
 * Task 0 live probe). The working endpoint is /markets/{id} with the numeric id.
 */
export async function fetchMarketById(id: string | number): Promise<Market | null> {
  try {
    const raw = await getJson(`${BASE}/markets/${encodeURIComponent(String(id))}`);
    return normalizeMarket(raw);  // may be null if endDate missing
  } catch (err) {
    logger.warn({ id, err: String(err) }, 'fetchMarketById failed');
    return null;
  }
}

/**
 * Fetch a single market by slug via the list endpoint's `slug=` filter.
 * This is the resolution-safe lookup path used by the P&L tracker: it works
 * without a numeric market id cached locally.
 *
 * Live Gamma behavior (verified 2026-07-18): the plain `?slug=X` query
 * EXCLUDES closed markets — a resolved market returns an empty array with
 * HTTP 200. `?slug=X&closed=true` returns only closed markets (empty for
 * still-open ones). So: query plain first (preserves open-market behavior),
 * and on an empty result retry once with closed=true before concluding the
 * market is delisted. Without the fallback every resolved market reads as
 * "delisted" and no trade can ever settle.
 */
export async function fetchMarketBySlug(slug: string): Promise<Market | null> {
  const base = `${BASE}/markets?slug=${encodeURIComponent(slug)}&limit=1`;
  let raw: unknown = null;
  try {
    raw = await getJson(base);
  } catch (err) {
    // A transport failure here must not skip the closed=true retry: callers
    // treat null as "delisted", which permanently voids open trades.
    logger.warn({ slug, err: String(err) }, 'fetchMarketBySlug plain query failed; trying closed=true');
  }
  try {
    if (!Array.isArray(raw) || raw.length === 0) {
      raw = await getJson(`${base}&closed=true`);
    }
    if (!Array.isArray(raw) || raw.length === 0) return null;
    // Resolution path: tolerate missing endDate so we don't conflate
    // "Gamma omitted endDate" with "market not found" / "delisted".
    return normalizeMarket(raw[0], { requireEndDate: false });
  } catch (err) {
    logger.warn({ slug, err: String(err) }, 'fetchMarketBySlug failed');
    return null;
  }
}
