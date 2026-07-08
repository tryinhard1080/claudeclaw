#!/usr/bin/env tsx
/**
 * Read-only overnight trading-agent run.
 *
 * Collects the current operational evidence, grades it, and writes Markdown
 * plus JSON artifacts under STORE_DIR. It does not place trades or change any
 * runtime setting.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../src/config.js';
import {
  collectOperationalEvidence,
  readOperationalEvidenceHistory,
} from '../src/readiness/evidence.js';
import {
  buildOvernightTradingAgentReport,
  formatOvernightTradingAgentMarkdown,
  formatOvernightTradingAgentSummary,
} from '../src/readiness/overnight-agent.js';
import { collectOpenMtmDiagnostics } from '../src/readiness/poly-open-mtm-diagnostics.js';
import { collectPnlHeartbeat } from '../src/readiness/poly-pnl-heartbeat.js';
import { collectResolutionWatch } from '../src/readiness/poly-resolution-watch.js';
import { collectSettledCalibration } from '../src/readiness/poly-settled-calibration.js';
import { collectSettlementImpact } from '../src/readiness/poly-settlement-impact.js';
import {
  summarizeTradingSchedulerCadence,
  type ScheduledTaskStatus,
} from '../src/readiness/scheduler-status.js';

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}

function historyLimit(): number {
  const raw = argValue('--history');
  if (!raw) return 14;
  return Math.max(1, Math.min(90, Number(raw) || 14));
}

function outDir(): string {
  const raw = argValue('--out-dir');
  return raw ? path.resolve(raw) : path.join(STORE_DIR, 'reports', 'overnight-trading-agent');
}

function stamp(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().replace(/[:.]/g, '-');
}

function main(): number {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const generatedAt = Math.floor(Date.now() / 1000);
    const evidence = collectOperationalEvidence(db, generatedAt, {
      collectEquitySync: true,
      collectEquityBenchmark: true,
    });
    const settlementImpact = collectSettlementImpact(db, { nowSec: generatedAt });
    const openMtmDiagnostics = collectOpenMtmDiagnostics(db, { nowSec: generatedAt });
    const settledCalibration = collectSettledCalibration(db, { nowSec: generatedAt });
    const resolutionWatch = collectResolutionWatch(db, { nowSec: generatedAt });
    const pnlHeartbeat = collectPnlHeartbeat(db, { nowSec: generatedAt });
    const scheduledTasks = db
      .prepare(`SELECT * FROM scheduled_tasks ORDER BY next_run ASC`)
      .all() as ScheduledTaskStatus[];
    const scheduler = summarizeTradingSchedulerCadence(scheduledTasks, generatedAt);
    const history = readOperationalEvidenceHistory(db, historyLimit());
    const report = buildOvernightTradingAgentReport(
      evidence,
      history,
      settlementImpact,
      openMtmDiagnostics,
      settledCalibration,
      resolutionWatch,
      scheduler,
      pnlHeartbeat,
    );
    const dir = outDir();
    fs.mkdirSync(dir, { recursive: true });

    const baseName = `overnight-trading-agent-${stamp(report.generatedAt)}`;
    const markdownPath = path.join(dir, `${baseName}.md`);
    const jsonPath = path.join(dir, `${baseName}.json`);
    const latestMarkdownPath = path.join(dir, 'latest.md');
    const latestJsonPath = path.join(dir, 'latest.json');

    const markdown = formatOvernightTradingAgentMarkdown(report);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    fs.writeFileSync(markdownPath, markdown, 'utf8');
    fs.writeFileSync(jsonPath, json, 'utf8');
    fs.writeFileSync(latestMarkdownPath, markdown, 'utf8');
    fs.writeFileSync(latestJsonPath, json, 'utf8');

    console.log(formatOvernightTradingAgentSummary(report));
    console.log();
    console.log(`Markdown: ${markdownPath}`);
    console.log(`JSON: ${jsonPath}`);
    console.log(`Latest: ${latestMarkdownPath}`);
    return report.status === 'fail' ? 1 : 0;
  } finally {
    db.close();
  }
}

try {
  process.exitCode = main();
} catch (error) {
  console.error('Overnight trading agent failed:', error);
  process.exitCode = 1;
}
