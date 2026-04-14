#!/usr/bin/env tsx
/**
 * Sprint 5 — resolution cache fetcher.
 *
 * Iterates distinct slugs referenced in poly_signals and fetches each
 * market's current state from Polymarket Gamma. Persists into
 * poly_resolutions (UPSERT by slug). Rate-limited to stay polite.
 *
 * Usage:
 *   npx tsx scripts/fetch-resolutions.ts               # all slugs
 *   npx tsx scripts/fetch-resolutions.ts --limit 50    # first 50 slugs
 *   npx tsx scripts/fetch-resolutions.ts --closed-only # refresh only slugs already marked closed
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';
import { fetchMarketBySlug } from '../src/poly/gamma-client.js';
import { persistResolution } from '../src/poly/backtest.js';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function parseArgs(argv: string[]): { limit: number | null; closedOnly: boolean } {
  let limit: number | null = null;
  const li = argv.indexOf('--limit');
  if (li >= 0 && argv[li + 1]) limit = Number(argv[li + 1]);
  return { limit, closedOnly: argv.includes('--closed-only') };
}

async function main(): Promise<void> {
  const { limit, closedOnly } = parseArgs(process.argv.slice(2));
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
  db.pragma('journal_mode = WAL');

  const baseSql = closedOnly
    ? `SELECT DISTINCT market_slug FROM poly_signals s
         WHERE EXISTS (SELECT 1 FROM poly_resolutions r WHERE r.slug=s.market_slug AND r.closed=1)`
    : `SELECT DISTINCT market_slug FROM poly_signals`;
  const rows = db.prepare(baseSql + (limit ? ` LIMIT ${Math.floor(limit)}` : '')).all() as Array<{ market_slug: string }>;

  console.log(`Fetching resolutions for ${rows.length} distinct slugs...`);
  let ok = 0, closed = 0, miss = 0, err = 0;
  const nowSec = Math.floor(Date.now() / 1000);

  for (const [i, row] of rows.entries()) {
    try {
      const market = await fetchMarketBySlug(row.market_slug);
      if (!market) {
        miss++;
      } else {
        persistResolution(db, {
          slug: market.slug, closed: market.closed,
          outcomes: market.outcomes, fetchedAtSec: nowSec,
          resolvedAtSec: market.closed ? nowSec : null,
        });
        ok++;
        if (market.closed) closed++;
      }
    } catch (e) {
      err++;
      console.warn(`  ${row.market_slug}: ${String(e).slice(0, 120)}`);
    }
    // Rate-limit: ~10 req/sec. Gamma is generous but we're running ~600
    // requests; 100ms delay spreads them over a minute.
    if ((i + 1) % 10 === 0) {
      process.stdout.write(`\r  ${i + 1}/${rows.length} ok=${ok} closed=${closed} miss=${miss} err=${err}`);
    }
    await sleep(100);
  }
  process.stdout.write('\n');
  console.log(`Done. ok=${ok} closed=${closed} miss=${miss} err=${err}`);
  db.close();
}

main().catch(err => {
  console.error('fetch-resolutions failed:', err);
  process.exit(1);
});
