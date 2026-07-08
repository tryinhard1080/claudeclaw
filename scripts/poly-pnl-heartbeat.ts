#!/usr/bin/env tsx
/**
 * Read-only P&L reconciliation heartbeat for Polymarket paper trades.
 *
 * It checks whether open paper positions have recent mark-to-market updates.
 * It does not run reconciliation, settle trades, place orders, or change risk.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { STORE_DIR } from '../src/config.js';
import {
  collectPnlHeartbeat,
  formatPnlHeartbeatReport,
  type PnlHeartbeatOptions,
} from '../src/readiness/poly-pnl-heartbeat.js';

interface Args extends PnlHeartbeatOptions {
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
    maxAgeSec: 2 * 60 * 60,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') {
      args.dbPath = argv[++i] ?? '';
      if (!args.dbPath) throw new Error('--db requires a path');
      continue;
    }
    if (arg === '--max-age-min') {
      args.maxAgeSec = Math.floor(parsePositiveNumber('--max-age-min', argv[++i]) * 60);
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
    const summary = collectPnlHeartbeat(db, args);
    process.stdout.write(formatPnlHeartbeatReport(summary));
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
    console.error('Polymarket P&L heartbeat failed:', error);
    process.exitCode = 1;
  }
}
