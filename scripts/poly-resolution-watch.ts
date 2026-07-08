#!/usr/bin/env tsx
/**
 * Read-only watchdog for Polymarket paper trades that should be resolving.
 *
 * It does not trade, mutate the database, lift halts, or change caps. It only
 * checks whether open paper trades have passed their market end date and
 * whether the cached resolution already says closed while the trade remains
 * open.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { STORE_DIR } from '../src/config.js';
import {
  collectResolutionWatch,
  formatResolutionWatchReport,
  type ResolutionWatchOptions,
} from '../src/readiness/poly-resolution-watch.js';

interface Args extends ResolutionWatchOptions {
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
    dueSoonDays: 7,
    nearTermDays: 30,
    overdueGraceDays: 2,
    maxItems: 20,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') {
      args.dbPath = argv[++i] ?? '';
      if (!args.dbPath) throw new Error('--db requires a path');
      continue;
    }
    if (arg === '--due-days') {
      args.dueSoonDays = parsePositiveNumber('--due-days', argv[++i]);
      continue;
    }
    if (arg === '--near-term-days') {
      args.nearTermDays = parsePositiveNumber('--near-term-days', argv[++i]);
      continue;
    }
    if (arg === '--overdue-grace-days') {
      args.overdueGraceDays = parsePositiveNumber('--overdue-grace-days', argv[++i]);
      continue;
    }
    if (arg === '--max-items') {
      args.maxItems = Math.floor(parsePositiveNumber('--max-items', argv[++i]));
      continue;
    }
    if (arg === '--max-cache-age-minutes') {
      args.maxCacheAgeSec = Math.floor(parsePositiveNumber('--max-cache-age-minutes', argv[++i]) * 60);
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
    const summary = collectResolutionWatch(db, args);
    process.stdout.write(formatResolutionWatchReport(summary));
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
    console.error('Polymarket resolution watch failed:', error);
    process.exitCode = 1;
  }
}
