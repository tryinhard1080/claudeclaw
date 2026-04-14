#!/usr/bin/env tsx
/**
 * Sprint 5 — backtest runner.
 *
 * Replays historical signals against cached resolutions. Prints a
 * min-edge sweep by default (4/6/8/10/12/15) so the operator can see
 * the trade count / win rate / P&L curve across gate thresholds.
 *
 * Usage:
 *   npx tsx scripts/backtest.ts
 *   npx tsx scripts/backtest.ts --from 2026-04-01 --to 2026-04-14
 *   npx tsx scripts/backtest.ts --kelly 0.10 --max-trade 25
 *   npx tsx scripts/backtest.ts --thresholds 4,6,8,10,12,15,20
 */

import Database from 'better-sqlite3';
import path from 'path';
import {
  STORE_DIR, POLY_KELLY_FRACTION, POLY_MAX_TRADE_USD, POLY_PAPER_CAPITAL,
} from '../src/config.js';
import {
  loadHistoricalSignals, loadResolutions, composeMinEdgeSweep,
  type BacktestReport,
} from '../src/poly/backtest.js';

function parseArgs(argv: string[]): {
  fromSec: number; toSec: number;
  kellyFraction: number; maxTradeUsd: number; paperCapital: number;
  thresholds: number[];
} {
  const getFlag = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : null;
  };
  const fromStr = getFlag('--from');
  const toStr = getFlag('--to');
  const thresholdsStr = getFlag('--thresholds');
  return {
    fromSec: fromStr ? Math.floor(new Date(fromStr).getTime() / 1000) : 0,
    toSec: toStr ? Math.floor(new Date(toStr).getTime() / 1000) : Math.floor(Date.now() / 1000),
    kellyFraction: Number(getFlag('--kelly') ?? POLY_KELLY_FRACTION),
    maxTradeUsd: Number(getFlag('--max-trade') ?? POLY_MAX_TRADE_USD),
    paperCapital: Number(getFlag('--capital') ?? POLY_PAPER_CAPITAL),
    thresholds: thresholdsStr
      ? thresholdsStr.split(',').map(Number).filter(Number.isFinite)
      : [0.1, 0.5, 1, 2, 4, 8],
  };
}

function fmt(n: number, d = 2): string { return n.toFixed(d); }
function signedUsd(n: number): string { return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2); }

function printSweep(reports: BacktestReport[]): void {
  console.log('');
  console.log('Min-edge sweep:');
  console.log('');
  console.log('  edge |  approved | skip0 | resolved |  win% |    P&L    | deployed | ROI%  | Brier');
  console.log('  -----+-----------+-------+----------+-------+-----------+----------+-------+------');
  for (const r of reports) {
    const br = r.brierScore === null ? '  n/a' : fmt(r.brierScore, 3);
    console.log(
      `  ${String(r.minEdgePct).padStart(3)}pp |  ${String(r.approvedCount).padStart(8)} | ${String(r.skippedForZeroSize).padStart(5)} | ${String(r.resolvedCount).padStart(8)} | ${fmt(r.winRate * 100, 1).padStart(5)} | ${signedUsd(r.totalPnl).padStart(9)} | ${fmt(r.totalDeployed, 0).padStart(7)} | ${fmt(r.roiPct, 1).padStart(5)} | ${br}`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'), { readonly: true });

  const signals = loadHistoricalSignals(db, { fromSec: args.fromSec, toSec: args.toSec });
  const resolutions = loadResolutions(db);
  db.close();

  console.log(`Loaded ${signals.length} signals in window [${new Date(args.fromSec * 1000).toISOString().slice(0, 10)} → ${new Date(args.toSec * 1000).toISOString().slice(0, 10)}]`);
  console.log(`Cached resolutions: ${resolutions.size} markets (${[...resolutions.values()].filter(r => r.closed).length} closed)`);
  console.log(`Params: kelly=${args.kellyFraction} maxTrade=$${args.maxTradeUsd} capital=$${args.paperCapital}`);

  const reports = composeMinEdgeSweep({
    signals, resolutions,
    base: {
      kellyFraction: args.kellyFraction,
      maxTradeUsd: args.maxTradeUsd,
      paperCapital: args.paperCapital,
    },
    thresholds: args.thresholds,
  });

  printSweep(reports);

  const best = reports.reduce((a, b) => (b.totalPnl > a.totalPnl ? b : a));
  console.log('');
  console.log(`Best threshold by P&L: ${best.minEdgePct}pp → ${signedUsd(best.totalPnl)} (n=${best.resolvedCount}, win ${fmt(best.winRate * 100, 0)}%)`);
  const current = reports.find(r => r.minEdgePct === 8);
  if (current) {
    console.log(`Current production threshold (8pp) → ${signedUsd(current.totalPnl)} (n=${current.resolvedCount})`);
  }
}

main().catch(err => {
  console.error('backtest failed:', err);
  process.exit(1);
});
