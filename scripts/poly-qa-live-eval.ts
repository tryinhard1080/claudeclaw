#!/usr/bin/env tsx
/**
 * One-shot live LLM evaluation sanity check. Costs ~1 cent.
 * Fetches the top-volume market, calls evaluateMarket() for real, prints
 * the estimate.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { fetchActiveMarkets } from '../src/poly/gamma-client.js';
import { fetchBook, bestAskAndDepth } from '../src/poly/clob-client.js';
import { evaluateMarket } from '../src/poly/strategies/ai-probability.js';
import { POLY_MODEL } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '..', 'store', 'poly-qa-live.tmp.db');

async function main() {
  if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
  const db = new Database(TMP);
  db.exec(`CREATE TABLE poly_eval_cache (cache_key TEXT PRIMARY KEY, slug TEXT NOT NULL,
    outcome_token_id TEXT NOT NULL, created_at INTEGER NOT NULL, probability REAL NOT NULL,
    confidence TEXT NOT NULL, reasoning TEXT NOT NULL, contrarian TEXT);`);

  console.log(`Model: ${POLY_MODEL}`);
  console.log('Fetching live markets…');
  const markets = await fetchActiveMarkets();
  const candidate = [...markets]
    .filter(m => !m.closed && m.volume24h >= 50_000)
    .sort((a, b) => b.volume24h - a.volume24h)[0];
  if (!candidate) throw new Error('no candidate market');
  const yes = candidate.outcomes.find(o => o.label.toLowerCase() === 'yes') ?? candidate.outcomes[0]!;
  console.log(`Candidate: ${candidate.slug}`);
  console.log(`  Q: ${candidate.question}`);
  console.log(`  vol: $${Math.round(candidate.volume24h).toLocaleString()}`);

  const book = await fetchBook(yes.tokenId);
  if (!book) throw new Error('no book');
  const { bestAsk, askDepthShares } = bestAskAndDepth(book);
  if (bestAsk === null) throw new Error('empty asks');
  const bestBid = book.bids.length > 0 ? book.bids[0]!.price : null;
  const spreadPct = bestBid !== null ? ((bestAsk - bestBid) / bestAsk) * 100 : null;

  console.log(`  ask=${bestAsk}  bid=${bestBid}  spread=${spreadPct?.toFixed(2)}%  depth=${askDepthShares} shares`);
  console.log('\nCalling evaluateMarket() — this makes a real Anthropic API call…');

  const t0 = Date.now();
  const est = await evaluateMarket({
    market: candidate, outcome: yes, bestAsk, bestBid, spreadPct,
    askDepthUsd: askDepthShares * bestAsk, db,
  });
  const ms = Date.now() - t0;

  if (!est) {
    console.error(`\n❌ evaluateMarket returned null (${ms}ms) — check logs above for reason`);
    process.exit(1);
  }

  console.log(`\n✅ estimate in ${ms}ms:`);
  console.log(`  probability: ${(est.probability * 100).toFixed(1)}%`);
  console.log(`  confidence:  ${est.confidence}`);
  console.log(`  edge vs ask: ${((est.probability - bestAsk) * 100).toFixed(1)}pp`);
  console.log(`  reasoning:   ${est.reasoning}`);
  if (est.contrarian) console.log(`  contrarian:  ${est.contrarian}`);

  const cached = (db.prepare(`SELECT COUNT(*) AS n FROM poly_eval_cache`).get() as { n: number }).n;
  console.log(`\n  cache rows: ${cached} (should be 1 — verifies insert path)`);

  db.close();
  fs.unlinkSync(TMP);
}

main().catch(err => {
  console.error('\n❌ live eval failed:', err);
  process.exit(1);
});
