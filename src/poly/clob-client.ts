import { ClobBookSchema, type ClobBook } from './types.js';
import { logger } from '../logger.js';

const BASE = 'https://clob.polymarket.com';

export function parseBook(raw: unknown): ClobBook {
  return ClobBookSchema.parse(raw);
}

export function bestAskAndDepth(book: ClobBook): { bestAsk: number | null; askDepthShares: number } {
  const asks = book.asks.slice().sort((a, b) => a.price - b.price);
  if (asks.length === 0) return { bestAsk: null, askDepthShares: 0 };
  return {
    bestAsk: asks[0]!.price,
    askDepthShares: asks.reduce((s, l) => s + l.size, 0),
  };
}

export async function fetchBook(tokenId: string): Promise<ClobBook | null> {
  try {
    const res = await fetch(`${BASE}/book?token_id=${encodeURIComponent(tokenId)}`);
    if (!res.ok) return null;
    return parseBook(await res.json());
  } catch (err) {
    logger.warn({ tokenId, err: String(err) }, 'fetchBook failed');
    return null;
  }
}

export async function fetchMidpoint(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/midpoint?token_id=${encodeURIComponent(tokenId)}`);
    if (!res.ok) return null;
    const json = await res.json() as { mid?: unknown };
    const n = typeof json.mid === 'string' ? Number(json.mid) : typeof json.mid === 'number' ? json.mid : NaN;
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}
