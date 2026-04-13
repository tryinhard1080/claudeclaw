#!/usr/bin/env tsx
/**
 * Offline strategy A/B comparison over the overlap set.
 * Usage: npx tsx scripts/poly-strategy-compare.ts <versionA> <versionB>
 *
 * Example: npx tsx scripts/poly-strategy-compare.ts v3 v4
 *
 * Reads the production SQLite DB (read-only), finds resolved markets
 * evaluated by both versions, computes paired Brier + t-test, prints
 * a human summary.
 */
import Database from 'better-sqlite3';
import { compareStrategies } from '../src/poly/strategy-compare.js';
import { STORE_DIR } from '../src/config.js';
import path from 'path';

function main(): void {
  const [versionA, versionB] = process.argv.slice(2);
  if (!versionA || !versionB) {
    console.error('Usage: npx tsx scripts/poly-strategy-compare.ts <versionA> <versionB>');
    process.exit(1);
  }
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath, { readonly: true });
  const r = compareStrategies(db, versionA, versionB);
  db.close();

  console.log(`\n=== Strategy A/B: ${r.versionA}  vs  ${r.versionB} ===\n`);
  if (r.nPaired === 0) {
    console.log('  No overlap yet. Markets have not been evaluated by BOTH versions.');
    console.log('  To produce pairable data, run dual-eval mode (Sprint 2.5+).');
    console.log('  Exit: clean.\n');
    return;
  }
  console.log(`  n paired resolved markets: ${r.nPaired}`);
  console.log(`  Brier(${r.versionA}): ${r.brierA!.toFixed(4)}`);
  console.log(`  Brier(${r.versionB}): ${r.brierB!.toFixed(4)}`);
  console.log(`  Mean delta (A - B):  ${r.tTest.meanDelta.toFixed(4)}`);
  console.log(`  t statistic:         ${r.tTest.t.toFixed(3)}  (df=${r.tTest.n - 1})`);
  console.log(`  two-tailed p-value:  ${r.tTest.pValue.toExponential(3)}`);
  console.log();
  if (r.winner === 'tie') {
    console.log('  Verdict: TIE — no statistically significant difference (p >= 0.05).');
    if (r.nPaired < 20) console.log('  Sample is small; re-run when n >= 20 for meaningful power.');
  } else if (r.winner === 'A') {
    console.log(`  Verdict: ${r.versionA} wins (lower Brier, significant at p<0.05).`);
  } else {
    console.log(`  Verdict: ${r.versionB} wins (lower Brier, significant at p<0.05).`);
  }
  console.log();
}

try {
  main();
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
