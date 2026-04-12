#!/usr/bin/env tsx
/**
 * Task 19 headless QA — exercises Phase C end-to-end without Telegram.
 * Uses a temp sqlite DB, real Gamma + CLOB API, stubbed evaluator (no API $).
 */
import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { fetchActiveMarkets, fetchMarketBySlug } from '../src/poly/gamma-client.js';
import { fetchBook, bestAskAndDepth } from '../src/poly/clob-client.js';
import { upsertMarkets, capturePrices } from '../src/poly/market-scanner.js';
import { StrategyEngine } from '../src/poly/strategy-engine.js';
import { PnlTracker } from '../src/poly/pnl-tracker.js';
import { registerPolyAlerts } from '../src/poly/alerts.js';
import { renderSignals, renderPositions, renderPnl } from '../src/poly/telegram-commands.js';
import { composeDigest } from '../src/poly/digest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DB = path.join(__dirname, '..', 'store', 'poly-qa.tmp.db');

async function main() {
  const startedAt = Date.now();
  const step = (n: number, t: string) => console.log(`\n━━━ [${n}] ${t} ━━━`);

  // 0. Fresh DB + schema from migration.
  step(0, 'Fresh DB + v1.2.0 schema');
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  const db = new Database(TMP_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS poly_markets (slug TEXT PRIMARY KEY, condition_id TEXT NOT NULL,
      question TEXT NOT NULL, category TEXT, outcomes_json TEXT NOT NULL, volume_24h REAL NOT NULL,
      liquidity REAL NOT NULL, end_date INTEGER NOT NULL, closed INTEGER NOT NULL,
      resolution TEXT, last_scan_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS poly_signals (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT NOT NULL, outcome_token_id TEXT NOT NULL,
      outcome_label TEXT NOT NULL, market_price REAL NOT NULL, estimated_prob REAL NOT NULL,
      edge_pct REAL NOT NULL, confidence TEXT NOT NULL, reasoning TEXT NOT NULL,
      contrarian TEXT, approved INTEGER NOT NULL, rejection_reasons TEXT, paper_trade_id INTEGER);
    CREATE TABLE IF NOT EXISTS poly_paper_trades (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT NOT NULL, outcome_token_id TEXT NOT NULL,
      outcome_label TEXT NOT NULL, side TEXT NOT NULL, entry_price REAL NOT NULL,
      size_usd REAL NOT NULL, shares REAL NOT NULL, kelly_fraction REAL NOT NULL,
      strategy TEXT NOT NULL, status TEXT NOT NULL, resolved_at INTEGER,
      realized_pnl REAL, voided_reason TEXT);
    CREATE TABLE IF NOT EXISTS poly_positions (paper_trade_id INTEGER PRIMARY KEY REFERENCES poly_paper_trades(id),
      market_slug TEXT NOT NULL, current_price REAL NOT NULL, unrealized_pnl REAL NOT NULL,
      updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS poly_price_history (token_id TEXT NOT NULL, captured_at INTEGER NOT NULL,
      price REAL NOT NULL, PRIMARY KEY (token_id, captured_at));
    CREATE TABLE IF NOT EXISTS poly_eval_cache (cache_key TEXT PRIMARY KEY, slug TEXT NOT NULL,
      outcome_token_id TEXT NOT NULL, created_at INTEGER NOT NULL, probability REAL NOT NULL,
      confidence TEXT NOT NULL, reasoning TEXT NOT NULL, contrarian TEXT);
  `);
  console.log('  ✓ schema applied');

  // 1. Live Gamma fetch.
  step(1, 'Live Gamma fetch — fetchActiveMarkets');
  const markets = await fetchActiveMarkets();
  console.log(`  ✓ fetched ${markets.length} active markets`);
  if (markets.length === 0) throw new Error('zero markets — Gamma API unreachable?');
  upsertMarkets(db, markets);
  capturePrices(db, markets);
  const cached = (db.prepare(`SELECT COUNT(*) AS n FROM poly_markets WHERE closed=0`).get() as { n: number }).n;
  console.log(`  ✓ ${cached} markets upserted into poly_markets`);

  // 2. Live CLOB book on top market.
  step(2, 'Live CLOB book on the top-volume YES outcome');
  const top = [...markets].sort((a, b) => b.volume24h - a.volume24h)[0]!;
  const yes = top.outcomes.find(o => o.label.toLowerCase() === 'yes') ?? top.outcomes[0]!;
  console.log(`  top: ${top.slug}  vol $${Math.round(top.volume24h).toLocaleString()}`);
  const book = await fetchBook(yes.tokenId);
  if (!book) throw new Error('fetchBook returned null');
  const { bestAsk, askDepthShares } = bestAskAndDepth(book);
  console.log(`  ✓ bestAsk=${bestAsk}  askDepthShares=${askDepthShares}  bids=${book.bids.length}  asks=${book.asks.length}`);

  // 3. fetchMarketBySlug (the codex-review fix path).
  step(3, 'fetchMarketBySlug (resolution lookup path)');
  const refetched = await fetchMarketBySlug(top.slug);
  console.log(`  ✓ refetched slug=${refetched?.slug ?? 'null'}  closed=${refetched?.closed}`);

  // 4. StrategyEngine with a stubbed evaluator — exercises selection → Kelly → gates → signal persist.
  step(4, 'StrategyEngine cycle with stub evaluator (no API $)');
  const scanner = new EventEmitter();
  const engine = new StrategyEngine({
    db, scanner,
    paperCapital: 5000, maxTradeUsd: 50, kellyFraction: 0.25,
    minVolumeUsd: 1000, minTtrHours: 1, topN: 5,
    // Stub: forces approval when ask < 0.9, ensures one fill if market has enough depth.
    evaluate: async ({ outcome }) => {
      const mkt = markets.find(m => m.outcomes.some(o => o.tokenId === outcome.tokenId));
      const ask = mkt?.outcomes.find(o => o.tokenId === outcome.tokenId)?.price ?? 0.5;
      if (ask >= 0.9) return null;
      return { probability: Math.min(ask + 0.15, 0.98), confidence: 'medium', reasoning: 'QA stub' };
    },
  });
  const filledEvents: unknown[] = [];
  const rejectedEvents: unknown[] = [];
  engine.on('signal_filled', e => filledEvents.push(e));
  engine.on('signal_rejected', e => rejectedEvents.push(e));
  await engine.onScanComplete({ markets });
  const signalCount = (db.prepare(`SELECT COUNT(*) AS n FROM poly_signals`).get() as { n: number }).n;
  const tradeCount = (db.prepare(`SELECT COUNT(*) AS n FROM poly_paper_trades`).get() as { n: number }).n;
  console.log(`  ✓ signals=${signalCount}  paper trades=${tradeCount}`);
  console.log(`  ✓ filled events=${filledEvents.length}  rejected events=${rejectedEvents.length}`);
  if (signalCount === 0) console.log('  ⚠  zero signals — top 5 markets may all be closed/stale');

  // 5. Alert wiring.
  step(5, 'registerPolyAlerts → sender');
  const tracker = new PnlTracker(db);
  const sent: string[] = [];
  registerPolyAlerts({ strategyEngine: engine, pnlTracker: tracker, sender: async t => { sent.push(t); } });
  // Replay a filled event synthetically so we see the formatter output.
  if (filledEvents.length > 0) {
    engine.emit('signal_filled', filledEvents[0]);
    await new Promise(r => setImmediate(r));
    console.log(`  ✓ sender received: ${sent[0]?.slice(0, 100)}…`);
  } else {
    console.log('  ⚠  no filled events this cycle — skipping alert replay');
  }

  // 6. PnlTracker.runOnce against real positions.
  step(6, 'PnlTracker.runOnce against open trades');
  const before = Date.now();
  const pnlRes = await tracker.runOnce();
  console.log(`  ✓ runOnce: updatedOpen=${pnlRes.updatedOpen}  resolved=${pnlRes.resolved}  (${Date.now() - before}ms)`);

  // 7. Render the three new commands.
  step(7, 'Render /poly signals, /poly positions, /poly pnl');
  console.log('\n--- /poly signals ---\n' + renderSignals(db));
  console.log('\n--- /poly positions ---\n' + renderPositions(db));
  console.log('\n--- /poly pnl ---\n' + renderPnl(db));

  // 8. Digest composer (no send).
  step(8, 'composeDigest');
  const digest = composeDigest(db);
  console.log(`  ✓ digest ymd=${digest.ymd}  len=${digest.text.length}`);
  console.log('\n--- digest preview ---\n' + digest.text.slice(0, 400) + (digest.text.length > 400 ? '…' : ''));

  db.close();
  fs.unlinkSync(TMP_DB);
  console.log(`\n✅ headless QA finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error('\n❌ QA smoke failed:', err);
  process.exit(1);
});
