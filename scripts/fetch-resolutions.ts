#!/usr/bin/env tsx
/**
 * Sprint 5 — resolution cache fetcher.
 * Sprint 27 — open-trade slug priority + coverage metric + alarm.
 *
 * Iterates slugs (open-trade slugs first, then signal-evaluated slugs) and
 * fetches each market's current state from Polymarket Gamma. Persists into
 * poly_resolutions (UPSERT by slug). Rate-limited to stay polite.
 *
 * After the fetch run, computes resolution_cache_coverage_pct and pushes to
 * poly_kv-backed history. If the last two consecutive measurements are both
 * below the alarm threshold, emits a [coverage-alarm] line on stderr so the
 * scheduler-shell-runner forwards it to Telegram.
 *
 * Usage:
 *   npx tsx scripts/fetch-resolutions.ts               # priority queue
 *   npx tsx scripts/fetch-resolutions.ts --limit 50    # first 50 slugs
 *   npx tsx scripts/fetch-resolutions.ts --closed-only # refresh only slugs already marked closed
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';
import { fetchMarketBySlug } from '../src/poly/gamma-client.js';
import { persistResolution } from '../src/poly/backtest.js';
import {
  buildSlugPriorityQueue,
  computeCoverage,
  shouldAlarmCoverage,
  loadCoverageHistory,
  saveCoverageHistory,
  formatCoverageLog,
  formatCoverageAlarm,
} from '../src/poly/resolution-coverage.js';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function parseArgs(argv: string[]): { limit: number | null; closedOnly: boolean } {
  let limit: number | null = null;
  const li = argv.indexOf('--limit');
  if (li >= 0 && argv[li + 1]) limit = Number(argv[li + 1]);
  return { limit, closedOnly: argv.includes('--closed-only') };
}

function selectSlugs(db: Database.Database, closedOnly: boolean, limit: number | null): string[] {
  if (closedOnly) {
    const rows = db.prepare(
      `SELECT DISTINCT market_slug FROM poly_signals s
         WHERE EXISTS (SELECT 1 FROM poly_resolutions r WHERE r.slug=s.market_slug AND r.closed=1)`
        + (limit ? ` LIMIT ${Math.floor(limit)}` : ''),
    ).all() as Array<{ market_slug: string }>;
    return rows.map(r => r.market_slug);
  }
  const ordered = buildSlugPriorityQueue(db);
  return limit ? ordered.slice(0, Math.floor(limit)) : ordered;
}

async function main(): Promise<void> {
  const { limit, closedOnly } = parseArgs(process.argv.slice(2));
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  const slugs = selectSlugs(db, closedOnly, limit);
  console.log(`Fetching resolutions for ${slugs.length} distinct slugs...`);
  let ok = 0, closed = 0, miss = 0, err = 0;
  const nowSec = Math.floor(Date.now() / 1000);

  for (const [i, slug] of slugs.entries()) {
    try {
      const market = await fetchMarketBySlug(slug);
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
      console.warn(`  ${slug}: ${String(e).slice(0, 120)}`);
    }
    // Rate-limit: ~10 req/sec. Gamma is generous but we're running ~600
    // requests; 100ms delay spreads them over a minute.
    if ((i + 1) % 10 === 0) {
      process.stdout.write(`\r  ${i + 1}/${slugs.length} ok=${ok} closed=${closed} miss=${miss} err=${err}`);
    }
    await sleep(100);
  }
  process.stdout.write('\n');
  console.log(`Done. ok=${ok} closed=${closed} miss=${miss} err=${err}`);

  // Sprint 27 — coverage measurement + alarm.
  if (!closedOnly) {
    const coverage = computeCoverage(db);
    console.log(formatCoverageLog(coverage));
    const history = loadCoverageHistory(db);
    history.push({ ts: nowSec, pct: coverage.coveragePct });
    saveCoverageHistory(db, history);
    if (shouldAlarmCoverage(history)) {
      console.error(formatCoverageAlarm(history));
    }
  }

  db.close();
}

main().catch(err => {
  console.error('fetch-resolutions failed:', err);
  process.exit(1);
});
