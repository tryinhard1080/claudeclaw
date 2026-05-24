#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { STORE_DIR } from '../src/config.js';
import { collectGateProgress, type GateProgressCheck, type ReadinessStatus } from '../src/readiness/gate-progress.js';
import { readSourceFreshnessChecks, type SourceFreshnessCheck } from '../src/readiness/source-freshness.js';

function fmt(status: ReadinessStatus): string {
  return status.toUpperCase().padEnd(4);
}

function printGateChecks(checks: GateProgressCheck[]): void {
  console.log('Real-Money Gate Progress');
  console.log('------------------------');
  for (const check of checks) {
    const progress = check.current !== undefined && check.target !== undefined
      ? ` ${check.current}/${check.target}`
      : '';
    console.log(`${fmt(check.status)}  Box ${check.box}  ${check.name.padEnd(31)} ${check.state.padEnd(24)} ${check.detail}${progress}`);
  }
}

function printSourceChecks(checks: SourceFreshnessCheck[]): void {
  console.log();
  console.log('Source Freshness');
  console.log('----------------');
  for (const check of checks) {
    console.log(`${fmt(check.status)}  ${check.name.padEnd(31)} ${check.state.padEnd(24)} ${check.detail}`);
  }
}

export function main(): number {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    printGateChecks(collectGateProgress(db));
    printSourceChecks(readSourceFreshnessChecks(db, Math.floor(Date.now() / 1000)));
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
    console.error('Gate progress failed:', error);
    process.exitCode = 1;
  }
}

