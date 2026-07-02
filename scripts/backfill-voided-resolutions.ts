#!/usr/bin/env tsx
/**
 * Sprint 29 — retroactive re-classification of voided-as-delisted trades.
 *
 * Fix scope reminder: Sprint 29 patched `makeDefaultMarketFetcher` to fall
 * back to `poly_resolutions` when Gamma's live endpoint returns null (delisted
 * post-settlement, standard Polymarket behavior). Forward-only, that fix stops
 * the bleeding. This script walks the accumulated wreckage — trades that
 * closed BEFORE the fix and got stamped `status='voided', voided_reason='delisted'`
 * despite the cache having the settlement data — and re-classifies each one
 * against the current cache.
 *
 * Hard rules (see docs/research/sprint-29-resolution-cache-fallback.md §backfill):
 *   - Only touch rows where `status='voided' AND voided_reason='delisted'`.
 *   - Never touch rows where status IS 'open', 'won', 'lost', or 'exited'.
 *   - Never touch rows where voided_reason != 'delisted'.
 *   - Recompute realized_pnl via `realizedFor` (single source of truth).
 *   - Emit a summary and a JSON audit file so operator can reconcile.
 *
 * Usage:
 *   npx tsx scripts/backfill-voided-resolutions.ts --dry-run
 *   npx tsx scripts/backfill-voided-resolutions.ts
 *
 * Exit codes:
 *   0 = success (dry-run OR real write)
 *   1 = failure (DB error, parse error, sanity-check tripped)
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { STORE_DIR } from '../src/config.js';
import { readMarketFromCache, classifyResolution, realizedFor } from '../src/poly/pnl-tracker.js';

interface VoidedRow {
  id: number;
  market_slug: string;
  outcome_token_id: string;
  outcome_label: string;
  entry_price: number;
  shares: number;
  voided_reason: string | null;
}

interface FlipRecord {
  id: number;
  slug: string;
  outcome_label: string;
  from_status: 'voided';
  to_status: 'won' | 'lost';
  entry_price: number;
  shares: number;
  new_realized_pnl: number;
}

interface Summary {
  total_candidates: number;
  flipped_to_won: number;
  flipped_to_lost: number;
  stayed_voided_no_cache: number;
  stayed_voided_cache_open: number;
  stayed_voided_cache_unresolved: number;
  net_pnl_delta_usd: number;
  dry_run: boolean;
  audit_file: string;
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  try {
    const candidates = db.prepare(`
      SELECT id, market_slug, outcome_token_id, outcome_label, entry_price, shares, voided_reason
        FROM poly_paper_trades
       WHERE status = 'voided' AND voided_reason = 'delisted'
    `).all() as VoidedRow[];

    const flips: FlipRecord[] = [];
    let stayed_no_cache = 0;
    let stayed_open = 0;
    let stayed_unresolved = 0;

    for (const t of candidates) {
      const market = readMarketFromCache(db, t.market_slug);
      if (market === null) {
        stayed_no_cache++;
        continue;
      }
      const classification = classifyResolution(market, t.outcome_token_id);
      if (classification.status === 'open') {
        // Cache row exists but reports closed=0 — market hasn't actually
        // resolved. Leave as voided; the fix-forward path will pick it up
        // if/when the cache refreshes with closed=1.
        stayed_open++;
        continue;
      }
      if (classification.status === 'voided') {
        // Classifier itself said voided (e.g., no 1.0 price → unresolved).
        // Don't overwrite the existing 'delisted' reason with the same-family
        // 'unresolved' reason; treat as a no-op.
        stayed_unresolved++;
        continue;
      }
      // status is 'won' or 'lost'
      const newPnl = realizedFor(classification.status, t.shares, t.entry_price);
      flips.push({
        id: t.id,
        slug: t.market_slug,
        outcome_label: t.outcome_label,
        from_status: 'voided',
        to_status: classification.status,
        entry_price: t.entry_price,
        shares: t.shares,
        new_realized_pnl: newPnl,
      });
    }

    // Sanity: audit file always written, even on dry-run.
    const auditDir = path.join(STORE_DIR, 'audits');
    if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const auditPath = path.join(auditDir, `backfill-voided-resolutions-${stamp}.json`);
    fs.writeFileSync(auditPath, JSON.stringify({ flips, stayed_no_cache, stayed_open, stayed_unresolved, dry_run: dryRun }, null, 2));

    if (!dryRun && flips.length > 0) {
      const upd = db.prepare(`
        UPDATE poly_paper_trades
           SET status = ?, realized_pnl = ?, voided_reason = NULL
         WHERE id = ? AND status = 'voided' AND voided_reason = 'delisted'
      `);
      const tx = db.transaction((rows: FlipRecord[]): number => {
        let n = 0;
        for (const r of rows) {
          const info = upd.run(r.to_status, r.new_realized_pnl, r.id);
          if (info.changes === 1) n++;
        }
        return n;
      });
      const written = tx(flips);
      if (written !== flips.length) {
        console.error(`[backfill] SANITY FAIL: expected ${flips.length} writes, got ${written}. Rows may have changed concurrently.`);
        process.exit(1);
      }
    }

    const flipsWon = flips.filter(f => f.to_status === 'won').length;
    const flipsLost = flips.filter(f => f.to_status === 'lost').length;
    const netDelta = flips.reduce((s, f) => s + f.new_realized_pnl, 0);

    const summary: Summary = {
      total_candidates: candidates.length,
      flipped_to_won: flipsWon,
      flipped_to_lost: flipsLost,
      stayed_voided_no_cache: stayed_no_cache,
      stayed_voided_cache_open: stayed_open,
      stayed_voided_cache_unresolved: stayed_unresolved,
      net_pnl_delta_usd: Math.round(netDelta * 100) / 100,
      dry_run: dryRun,
      audit_file: auditPath,
    };

    console.log(`[backfill] ${dryRun ? 'DRY RUN — no writes' : 'APPLIED'}`);
    console.log(JSON.stringify(summary, null, 2));

    process.exit(0);
  } catch (err) {
    console.error(`[backfill] FATAL: ${String(err).slice(0, 500)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
