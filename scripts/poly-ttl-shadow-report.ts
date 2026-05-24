#!/usr/bin/env tsx
/**
 * Sprint S2 — TTL filter shadow comparison report.
 *
 * Reads the live `poly_ttl_shadow_ticks` table over a configurable window
 * (default last 14 days), aggregates per-tick stats, and prints a
 * human-readable summary the operator can paste into
 * `docs/research/sprint-s2-ttl-filter-comparison.md` on day 14.
 *
 * Usage:
 *   npx tsx scripts/poly-ttl-shadow-report.ts             # last 14 days
 *   npx tsx scripts/poly-ttl-shadow-report.ts --days 7    # last 7 days
 *
 * Read-only on the production DB. Does NOT change live behavior. The flag-
 * flip from shadow to active is Sprint S4 (Tier-3, operator-only).
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { STORE_DIR } from '../src/config.js';
import { summarizeTtlShadowWindow, type TtlShadowSummary } from '../src/poly/ttl-filter.js';

interface Args {
  days: number;
  outPath: string | null;
}

export function parseArgs(argv: string[]): Args {
  let days = 14;
  let outPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days' && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--days requires a positive number, got: ${argv[i + 1]}`);
      }
      days = n;
      i++;
      continue;
    }
    if (a === '--out' && i + 1 < argv.length) {
      outPath = argv[i + 1]!;
      i++;
    }
  }
  return { days, outPath };
}

export function formatTtlShadowReport(summary: TtlShadowSummary | null, days: number): string {
  const lines: string[] = ['', `=== TTL filter shadow report - last ${days} days ===`, ''];
  if (summary === null) {
    lines.push('  No shadow data in this window.');
    lines.push('  The first row lands at the next post-deploy scan tick.');
    lines.push('  Wait for poly_ttl_shadow_ticks to populate, then rerun.', '');
    return lines.join('\n');
  }
  const fmtFloat = (n: number, p = 2) => n.toFixed(p);
  const fmtFloatN = (n: number | null, p = 2) => (n === null ? 'n/a' : n.toFixed(p));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  const filteredMaxPct = summary.meanCandidatesTotal === 0
    ? 0
    : summary.meanFilteredMax / summary.meanCandidatesTotal;
  const filteredMinPct = summary.meanCandidatesTotal === 0
    ? 0
    : summary.meanFilteredMin / summary.meanCandidatesTotal;

  lines.push(`  Window:         ${new Date(summary.windowStartSec * 1000).toISOString()}`);
  lines.push(`              to  ${new Date(summary.windowEndSec * 1000).toISOString()}`);
  lines.push(`  Band (latest):  [${summary.bandMinDaysLast}, ${summary.bandMaxDaysLast}] days`);
  lines.push(`  Ticks observed: ${summary.ticksObserved}`);
  lines.push('');
  lines.push('  Per-tick averages (across the candidate set after current filters):');
  lines.push(`    candidates total:      ${fmtFloat(summary.meanCandidatesTotal)}`);
  lines.push(`    candidates pass TTL:   ${fmtFloat(summary.meanCandidatesTtlPass)}  (${pct(summary.passRate)} of total)`);
  lines.push(`    filtered (resolves <min): ${fmtFloat(summary.meanFilteredMin)}  (${pct(filteredMinPct)})`);
  lines.push(`    filtered (resolves >max): ${fmtFloat(summary.meanFilteredMax)}  (${pct(filteredMaxPct)})`);
  lines.push('');
  lines.push('  TTL distribution:');
  lines.push(`    mean TTL of pass set:     ${fmtFloatN(summary.meanAvgTtlPass)} days`);
  lines.push(`    mean TTL of filtered set: ${fmtFloatN(summary.meanAvgTtlFiltered)} days`);
  lines.push('');

  // Naive what-if approval-rate uplift estimate. Read with caution: assumes
  // approval rate is uniform across TTL, which is an unverified premise - the
  // very thing the day-14 active-mode test is meant to validate. Surfacing it
  // here as a directional signal, not a forecast.
  const wouldBeKeepShare = summary.passRate;
  const wouldBeDropShare = 1 - wouldBeKeepShare;
  lines.push('  Naive what-if (assumes uniform approval rate across TTL - unverified):');
  lines.push(`    if filter were ACTIVE, ~${pct(wouldBeKeepShare)} of candidates would survive`);
  lines.push(`    ~${pct(wouldBeDropShare)} of long-dated/short-dated candidates would be excluded`);
  lines.push(`    expected days-to-50 lift: directionally proportional to mean-TTL drop`);
  if (summary.meanAvgTtlPass !== null && summary.meanAvgTtlFiltered !== null) {
    const ratio = summary.meanAvgTtlFiltered / summary.meanAvgTtlPass;
    lines.push(`    mean-TTL ratio (filtered/pass): ${fmtFloat(ratio)}x`);
  }
  lines.push('');

  if (summary.ticksObserved < 100) {
    lines.push('  Sample is small (<100 ticks). Wait for more data before drawing conclusions.');
    lines.push('  At default 15-min scan interval, 14 days = ~1,344 ticks (96/day × 14).');
    lines.push('');
  }

  return lines.join('\n');
}

export function main(argv = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath, { readonly: true });
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = nowSec - args.days * 86400;
    const summary = summarizeTtlShadowWindow(db, startSec, nowSec);
    const report = formatTtlShadowReport(summary, args.days);
    process.stdout.write(report);
    if (args.outPath) {
      const outPath = path.resolve(args.outPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${report.trimEnd()}\n`);
      process.stdout.write(`\n  Wrote ${outPath}\n`);
    }
  } finally {
    db.close();
  }
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const code = main();
    if (code !== 0) process.exit(code);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}
