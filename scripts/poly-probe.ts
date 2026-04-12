// scripts/poly-probe.ts
// Hits Gamma + CLOB once, dumps raw JSON to data/poly-probe/. Throwaway.
// Field names discovered by this probe drive Task 4 types. Document them below after running.
//
// ACTUAL FIELD NAMES (verified 2026-04-12 against live Gamma + CLOB):
// markets[].id             = string (numeric), e.g. "540816"
// markets[].slug           = string, e.g. "russia-ukraine-ceasefire-before-gta-vi-554"
// markets[].question       = string
// markets[].outcomes       = string (JSON-encoded string array, must JSON.parse)
// markets[].outcomePrices  = string (JSON-encoded string array, must JSON.parse)
// markets[].volume         = string (numeric). Also: volumeNum (number), volumeClob, volume24hr, volume1wk, volume1mo, volume1yr
// markets[].liquidity      = string (numeric). Also: liquidityNum, liquidityClob
// markets[].endDate        = ISO datetime string. Also: endDateIso, startDate, startDateIso
// markets[].conditionId    = string (0x-prefixed hex)
// markets[].clobTokenIds   = string (JSON-encoded string array, must JSON.parse)
// markets[].bestBid/bestAsk = number
// markets[].lastTradePrice = number
// markets[].oneDayPriceChange/oneHourPriceChange/oneWeekPriceChange/oneMonthPriceChange = number
// markets[].active, closed, archived, acceptingOrders = boolean
// markets[].spread, orderMinSize, orderPriceMinTickSize = number
//
// ENDPOINTS:
// - Gamma list: GET https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=N
// - Gamma single: GET https://gamma-api.polymarket.com/markets/{id}   <-- id, NOT slug (slug 422s)
// - CLOB book:   GET https://clob.polymarket.com/book?token_id={clobTokenId}
// - CLOB mid:    GET https://clob.polymarket.com/midpoint?token_id={clobTokenId}
//
// CLOB BOOK SHAPE: { market, asset_id, timestamp, hash, bids: [{price,size}], asks: [{price,size}],
//                   min_order_size, tick_size, neg_risk, last_trade_price }
//   NOTE: price and size are STRINGS (numeric), must parseFloat. bids/asks are not guaranteed sorted.
// CLOB MID SHAPE:  { mid: string }  <-- also a string, not a number
import fs from 'fs/promises';
import path from 'path';

const OUT = path.resolve('data', 'poly-probe');

async function get(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function main(): Promise<void> {
  await fs.mkdir(OUT, { recursive: true });

  const markets = await get('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=5');
  await fs.writeFile(path.join(OUT, 'markets.json'), JSON.stringify(markets, null, 2));

  const first = Array.isArray(markets) ? (markets[0] as Record<string, unknown>) : null;
  if (!first) throw new Error('No markets returned');

  // NOTE: Gamma single-market endpoint takes numeric `id`, NOT slug (slug returns 422).
  const id = (first.id ?? 'unknown') as string | number;
  const single = await get(`https://gamma-api.polymarket.com/markets/${id}`);
  await fs.writeFile(path.join(OUT, 'market-single.json'), JSON.stringify(single, null, 2));

  const rawTokenIds = first.clobTokenIds;
  const tokenIds: string[] = rawTokenIds
    ? (typeof rawTokenIds === 'string' ? JSON.parse(rawTokenIds) : (rawTokenIds as string[]))
    : [];
  if (tokenIds.length > 0) {
    const book = await get(`https://clob.polymarket.com/book?token_id=${tokenIds[0]}`);
    await fs.writeFile(path.join(OUT, 'book.json'), JSON.stringify(book, null, 2));
    const mid = await get(`https://clob.polymarket.com/midpoint?token_id=${tokenIds[0]}`);
    await fs.writeFile(path.join(OUT, 'midpoint.json'), JSON.stringify(mid, null, 2));
  }

  console.log('Probe complete. See', OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
