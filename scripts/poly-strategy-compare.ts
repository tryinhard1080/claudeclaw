#!/usr/bin/env tsx
/**
 * Offline strategy A/B comparison over the resolved signal overlap set.
 * Usage: npx tsx scripts/poly-strategy-compare.ts <versionA> <versionB>
 *
 * Example: npx tsx scripts/poly-strategy-compare.ts v3 v3-weather-shadow
 *
 * Reads the production SQLite DB (read-only), finds resolved markets
 * evaluated by both versions, including advisory shadow rows with no
 * paper_trade_id, computes paired Brier + t-test, and prints a human summary.
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import {
  compareStrategiesOnResolutions,
  type CompareResult,
} from '../src/poly/strategy-compare.js';
import { STORE_DIR } from '../src/config.js';
import path from 'path';

export function runStrategyComparison(
  db: Database.Database,
  versionA: string,
  versionB: string,
): CompareResult {
  return compareStrategiesOnResolutions(db, versionA, versionB);
}

export function formatStrategyComparison(r: CompareResult): string {
  const lines = [
    '',
    `=== Strategy A/B: ${r.versionA}  vs  ${r.versionB} ===`,
    '',
  ];

  if (r.nPaired === 0) {
    lines.push('  No resolved signal overlap yet.');
    lines.push('  This comparator reads poly_signals + poly_resolutions, so shadow rows with no paper_trade_id are included.');
    lines.push('  Wait for both versions to score the same resolved market, then rerun.');
    lines.push('  Exit: clean.', '');
    return lines.join('\n');
  }

  lines.push(`  n paired resolved markets: ${r.nPaired}`);
  lines.push(`  Brier(${r.versionA}): ${r.brierA!.toFixed(4)}`);
  lines.push(`  Brier(${r.versionB}): ${r.brierB!.toFixed(4)}`);
  lines.push(`  Mean delta (A - B):  ${r.tTest.meanDelta.toFixed(4)}`);
  lines.push(`  t statistic:         ${r.tTest.t.toFixed(3)}  (df=${r.tTest.n - 1})`);
  lines.push(`  two-tailed p-value:  ${r.tTest.pValue.toExponential(3)}`);
  lines.push('');

  if (r.winner === 'tie') {
    lines.push('  Verdict: TIE - no statistically significant difference (p >= 0.05).');
    if (r.nPaired < 20) lines.push('  Sample is small; re-run when n >= 20 for meaningful power.');
  } else if (r.winner === 'A') {
    lines.push(`  Verdict: ${r.versionA} wins (lower Brier, significant at p<0.05).`);
  } else {
    lines.push(`  Verdict: ${r.versionB} wins (lower Brier, significant at p<0.05).`);
  }
  lines.push('');
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2)): number {
  const [versionA, versionB] = argv;
  if (!versionA || !versionB) {
    console.error('Usage: npx tsx scripts/poly-strategy-compare.ts <versionA> <versionB>');
    return 1;
  }
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath, { readonly: true });
  const r = runStrategyComparison(db, versionA, versionB);
  db.close();

  console.log(formatStrategyComparison(r));
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
