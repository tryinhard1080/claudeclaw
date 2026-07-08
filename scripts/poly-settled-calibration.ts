#!/usr/bin/env tsx
/**
 * Read-only settled-trade calibration report for Polymarket paper trades.
 *
 * It does not settle trades, mutate P&L, place orders, lift halts, or change
 * risk settings. It only reports whether Box 2 has real settled evidence.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { STORE_DIR } from '../src/config.js';
import {
  collectSettledCalibration,
  formatSettledCalibrationReport,
  type SettledCalibrationOptions,
} from '../src/readiness/poly-settled-calibration.js';

interface Args extends SettledCalibrationOptions {
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
    lookbackDays: null,
    maxBuckets: 10,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') {
      args.dbPath = argv[++i] ?? '';
      if (!args.dbPath) throw new Error('--db requires a path');
      continue;
    }
    if (arg === '--days') {
      args.lookbackDays = parsePositiveNumber('--days', argv[++i]);
      continue;
    }
    if (arg === '--max-buckets') {
      args.maxBuckets = Math.floor(parsePositiveNumber('--max-buckets', argv[++i]));
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
    const summary = collectSettledCalibration(db, args);
    process.stdout.write(formatSettledCalibrationReport(summary));
    return summary.status === 'fail' ? 1 : 0;
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error('Polymarket settled calibration failed:', error);
    process.exitCode = 1;
  }
}
