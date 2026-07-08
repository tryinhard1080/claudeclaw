#!/usr/bin/env tsx
/**
 * Read-only impact preview for the next Polymarket paper settlement window.
 *
 * It does not settle trades, mutate P&L, place orders, lift halts, or change
 * risk settings. It only explains how much Box 2 sample count and realized P&L
 * can move when due open paper trades resolve.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { STORE_DIR } from '../src/config.js';
import {
  collectSettlementImpact,
  formatSettlementImpactReport,
  type SettlementImpactOptions,
} from '../src/readiness/poly-settlement-impact.js';

interface Args extends SettlementImpactOptions {
  dbPath: string;
}

function parsePositiveNumber(name: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} requires a positive number, got: ${value ?? '<missing>'}`);
  }
  return parsed;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    dbPath: path.join(STORE_DIR, 'claudeclaw.db'),
    horizonDays: 7,
    maxItems: 12,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') {
      args.dbPath = argv[++i] ?? '';
      if (!args.dbPath) throw new Error('--db requires a path');
      continue;
    }
    if (arg === '--days') {
      args.horizonDays = parsePositiveNumber('--days', argv[++i]);
      continue;
    }
    if (arg === '--max-items') {
      args.maxItems = Math.floor(parsePositiveNumber('--max-items', argv[++i]));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export function main(argv = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  const db = new Database(args.dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const summary = collectSettlementImpact(db, args);
    process.stdout.write(formatSettlementImpactReport(summary));
    return 0;
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error('Polymarket settlement impact failed:', error);
    process.exitCode = 1;
  }
}
