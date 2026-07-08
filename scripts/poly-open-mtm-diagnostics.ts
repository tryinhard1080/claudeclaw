#!/usr/bin/env tsx
/**
 * Read-only open-position mark-to-market diagnostic for Polymarket paper trades.
 *
 * It does not settle trades, mutate P&L, place orders, lift halts, or change
 * risk settings. It only explains where the open paper drawdown is concentrated.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { STORE_DIR } from '../src/config.js';
import {
  collectOpenMtmDiagnostics,
  formatOpenMtmDiagnosticsReport,
  type OpenMtmDiagnosticsOptions,
} from '../src/readiness/poly-open-mtm-diagnostics.js';

interface Args extends OpenMtmDiagnosticsOptions {
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
    maxItems: 8,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') {
      args.dbPath = argv[++i] ?? '';
      if (!args.dbPath) throw new Error('--db requires a path');
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
    const summary = collectOpenMtmDiagnostics(db, args);
    process.stdout.write(formatOpenMtmDiagnosticsReport(summary));
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
    console.error('Polymarket open MTM diagnostics failed:', error);
    process.exitCode = 1;
  }
}
