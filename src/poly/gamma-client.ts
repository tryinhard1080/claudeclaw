import { logger } from '../logger.js';
import { GammaMarketSchema, type GammaMarket, type Market } from './types.js';

const BASE = 'https://gamma-api.polymarket.com';

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
 * Parse and normalize. Returns `null` for structurally valid markets that
 * lack an endDate — those are unusable for our TTR gate and are dropped
 * without a warning (the absence is common, not pathological). Throws for
 * every other malformation so fetchActiveMarkets can log + skip.
 */
export function normalizeMarket(raw: unknown): Market | null {
  const g: GammaMarket = GammaMarketSchema.parse(raw);
  if (!g.endDate) return null;
  if (g.outcomes.length !== g.outcomePrices.length || g.outcomes.length !== g.clobTokenIds.length) {
    throw new Error(`market ${g.slug}: outcome/price/tokenId length mismatch`);
  }
  const outcomes = g.outcomes.map((label, i) => ({
    label,
    tokenId: g.clobTokenIds[i]!,
    price: g.outcomePrices[i]!,
  }));
  return {
    slug: g.slug,
    conditionId: g.conditionId,
    question: g.question,
    category: g.category,
    outcomes,
    volume24h: g.volume24hr,
    liquidity: g.liquidity,
    endDate: Math.floor(new Date(g.endDate).getTime() / 1000),
    closed: g.closed,
  };
}

export async function fetchActiveMarkets(pageSize = 500): Promise<Market[]> {
  const out: Market[] = [];
  let skippedNoEndDate = 0;
  let skippedMalformed = 0;
  let offset = 0;
  while (true) {
    const raw = await getJson(`${BASE}/markets?active=true&closed=false&limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(raw) || raw.length === 0) break;
    for (const r of raw) {
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
    if (raw.length < pageSize) break;
    offset += pageSize;
    await sleep(200);
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
 * without a numeric market id cached locally, and it returns closed markets
 * too (we explicitly do NOT pass closed=false so resolved markets are visible).
 */
export async function fetchMarketBySlug(slug: string): Promise<Market | null> {
  try {
    const raw = await getJson(`${BASE}/markets?slug=${encodeURIComponent(slug)}&limit=1`);
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return normalizeMarket(raw[0]);
  } catch (err) {
    logger.warn({ slug, err: String(err) }, 'fetchMarketBySlug failed');
    return null;
  }
}
