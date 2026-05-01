#!/usr/bin/env tsx
/**
 * Sprint 22 — Cron prompt audit.
 *
 * Detects drift between runtime prompt strings/hashes and committed
 * snapshot files. Run on a daily cron (or manually) to surface silent
 * edits to load-bearing prompts.
 *
 * Usage:
 *   tsx scripts/check-prompt-drift.ts          # check; exit 1 on drift
 *   tsx scripts/check-prompt-drift.ts --update # rewrite snapshots from runtime
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { NEWS_SYNC_PROMPT } from '../src/poly/news-sync.js';
import { PROMPT_VERSION, PROMPT_TEMPLATE_HASH } from '../src/poly/strategies/ai-probability.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const SNAP_DIR = path.join(REPO_ROOT, 'docs', 'prompts', 'snapshots');
const NEWS_SNAP_PATH = path.join(SNAP_DIR, 'news-sync.txt');
const AIPROB_SNAP_PATH = path.join(SNAP_DIR, 'ai-probability.hash');

export interface DriftReport {
  name: string;
  drifted: boolean;
  reason: string;       // human-readable reason; empty when not drifted
  snapshotMissing: boolean;
}

/**
 * Compare an expected (snapshot) string against an actual (runtime) string.
 * Treats a missing snapshot as drift with snapshotMissing=true so the
 * caller can choose to print the full body or hint at running --update.
 */
export function compareSnapshot(name: string, expected: string | null, actual: string): DriftReport {
  if (expected === null) {
    return {
      name,
      drifted: true,
      snapshotMissing: true,
      reason: `no snapshot on disk yet — run with --update to seed`,
    };
  }
  if (expected === actual) {
    return { name, drifted: false, snapshotMissing: false, reason: '' };
  }
  return {
    name,
    drifted: true,
    snapshotMissing: false,
    reason: `runtime differs from snapshot`,
  };
}

function readFileOrNull(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** Tiny line-level unified diff. Vitest does not need this beyond eyeballing. */
export function unifiedDiff(expected: string, actual: string): string {
  const e = expected.split('\n');
  const a = actual.split('\n');
  const out: string[] = [];
  const max = Math.max(e.length, a.length);
  for (let i = 0; i < max; i++) {
    const ex = e[i];
    const ac = a[i];
    if (ex === ac) continue;
    if (ex !== undefined) out.push(`- ${ex}`);
    if (ac !== undefined) out.push(`+ ${ac}`);
  }
  return out.join('\n');
}

/** Build the ai-probability hash snapshot body. Two lines, deterministic. */
export function buildAiProbSnapshotBody(version: string, hash: string): string {
  return `version=${version}\nhash=${hash}\n`;
}

interface CheckResult {
  reports: DriftReport[];
  exitCode: number;
}

export function runCheck(opts: { update: boolean; snapDir: string }): CheckResult {
  fs.mkdirSync(opts.snapDir, { recursive: true });

  const newsSnapPath = path.join(opts.snapDir, 'news-sync.txt');
  const aiprobSnapPath = path.join(opts.snapDir, 'ai-probability.hash');

  const newsExpected = readFileOrNull(newsSnapPath);
  const aiprobExpected = readFileOrNull(aiprobSnapPath);
  const aiprobActual = buildAiProbSnapshotBody(PROMPT_VERSION, PROMPT_TEMPLATE_HASH);

  if (opts.update) {
    fs.writeFileSync(newsSnapPath, NEWS_SYNC_PROMPT, 'utf8');
    fs.writeFileSync(aiprobSnapPath, aiprobActual, 'utf8');
    return { reports: [], exitCode: 0 };
  }

  const reports = [
    compareSnapshot('news-sync', newsExpected, NEWS_SYNC_PROMPT),
    compareSnapshot('ai-probability', aiprobExpected, aiprobActual),
  ];

  const drifted = reports.filter(r => r.drifted);
  return { reports, exitCode: drifted.length > 0 ? 1 : 0 };
}

function main(): void {
  const update = process.argv.includes('--update');
  const result = runCheck({ update, snapDir: SNAP_DIR });

  if (update) {
    console.log('snapshots updated:');
    console.log(`  ${path.relative(REPO_ROOT, NEWS_SNAP_PATH)}`);
    console.log(`  ${path.relative(REPO_ROOT, AIPROB_SNAP_PATH)}`);
    return;
  }

  for (const r of result.reports) {
    if (!r.drifted) {
      console.log(`OK  ${r.name}`);
      continue;
    }
    console.log(`DRIFT  ${r.name}: ${r.reason}`);
    if (r.name === 'news-sync' && !r.snapshotMissing) {
      const expected = readFileOrNull(NEWS_SNAP_PATH) ?? '';
      console.log(unifiedDiff(expected, NEWS_SYNC_PROMPT));
    }
    if (r.name === 'ai-probability') {
      const expected = readFileOrNull(AIPROB_SNAP_PATH) ?? '';
      console.log(`expected:\n${expected}`);
      console.log(`actual:\n${buildAiProbSnapshotBody(PROMPT_VERSION, PROMPT_TEMPLATE_HASH)}`);
    }
  }

  if (result.exitCode !== 0) {
    console.log('\nrun `tsx scripts/check-prompt-drift.ts --update` to refresh snapshots after intentional edits');
  }
  process.exit(result.exitCode);
}

// Node entry-point detection for ESM. Skipped when imported by tests.
const isEntry = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntry) {
  main();
}
