#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { STORE_DIR } from '../src/config.js';
import { collectGateAudit, type GateAuditCategory, type GateAuditItem } from '../src/readiness/gate-audit.js';
import { collectGateProgress, type ReadinessStatus } from '../src/readiness/gate-progress.js';

function fmtStatus(status: ReadinessStatus): string {
  return status.toUpperCase().padEnd(4);
}

function fmtCategory(category: GateAuditCategory): string {
  return category.replace(/_/g, ' ').toUpperCase().padEnd(15);
}

function fmtProgress(item: GateAuditItem): string {
  return item.current !== undefined && item.target !== undefined
    ? ` ${item.current}/${item.target}`
    : '';
}

function printItems(title: string, items: GateAuditItem[]): void {
  console.log();
  console.log(title);
  console.log('-'.repeat(title.length));
  if (items.length === 0) {
    console.log('None');
    return;
  }

  for (const item of items) {
    console.log(
      `${fmtStatus(item.status)}  Box ${item.box}  ${fmtCategory(item.category)} ` +
      `${item.name} - ${item.state}${fmtProgress(item)}`,
    );
    console.log(`      ${item.detail}`);
    console.log(`      Action: ${item.action}`);
  }
}

export function main(): number {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const payload = collectGateAudit(collectGateProgress(db));
    const complete = payload.items.filter(item => item.category === 'complete');
    const operator = payload.items.filter(item => item.category === 'operator_action');
    const sample = payload.items.filter(item => item.category === 'sample_or_time');
    const system = payload.items.filter(item => item.category === 'system_blocker');

    console.log('Real-Money Gate Audit');
    console.log('---------------------');
    console.log(`${fmtStatus(payload.status)}  Overall gate audit`);
    console.log(`Complete boxes        ${payload.completeCount}/${payload.totalCount}`);
    console.log(`Operator actions      ${payload.operatorActionCount}`);
    console.log(`Sample/time blockers  ${payload.sampleOrTimeCount}`);
    console.log(`System blockers       ${payload.systemBlockerCount}`);
    console.log(`Live-money ready      ${payload.liveMoneyReady ? 'YES' : 'NO'}`);

    printItems('Operator Actions', operator);
    printItems('Sample Or Time Blockers', sample);
    printItems('System Blockers', system);
    printItems('Complete Boxes', complete);

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
    console.error('Gate audit failed:', error);
    process.exitCode = 1;
  }
}
