#!/usr/bin/env tsx
/**
 * Sprint 4 research ingestion runner.
 *
 * Usage:
 *   npx tsx scripts/research-ingest.ts              # tier 1 only (default)
 *   npx tsx scripts/research-ingest.ts --all-tiers  # all tiers
 *   npx tsx scripts/research-ingest.ts --tier 2     # specific tier
 *
 * Reads docs/research/feeds.json, ingests new items into research_items,
 * optionally pushes to NotebookLM if POLY_RESEARCH_NOTEBOOK_ID is set.
 * Writes a run summary to docs/research/ingestions/YYYY-MM-DD.md.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { STORE_DIR, PROJECT_ROOT } from '../src/config.js';
import {
  ingestFeed, validateFeedConfig, defaultHttpText,
  latestItems, markUploaded, composeNoteContent,
  type FeedConfig, type IngestReport,
} from '../src/poly/research-ingest.js';

const execFileAsync = promisify(execFile);

function parseArgs(argv: string[]): { tiers: Set<number> } {
  const tiers = new Set<number>();
  if (argv.includes('--all-tiers')) {
    return { tiers: new Set([1, 2, 3]) };
  }
  const tierIdx = argv.indexOf('--tier');
  if (tierIdx >= 0 && argv[tierIdx + 1]) {
    const n = Number(argv[tierIdx + 1]);
    if ([1, 2, 3].includes(n)) tiers.add(n);
  }
  if (tiers.size === 0) tiers.add(1);
  return { tiers };
}

function loadFeeds(): FeedConfig[] {
  const cfgPath = path.join(PROJECT_ROOT, 'docs', 'research', 'feeds.json');
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as unknown;
  validateFeedConfig(raw);
  return raw;
}

async function uploadToNotebookLM(notebookId: string, title: string, content: string): Promise<boolean> {
  try {
    await execFileAsync('nlm', ['note', 'create', notebookId, '-t', title, '-c', content], {
      windowsHide: true, timeout: 30_000,
    });
    return true;
  } catch (err) {
    console.warn(`  [nlm upload failed] ${String(err).slice(0, 200)}`);
    return false;
  }
}

function writeRunSummary(reports: IngestReport[], startTime: Date): void {
  const dir = path.join(PROJECT_ROOT, 'docs', 'research', 'ingestions');
  fs.mkdirSync(dir, { recursive: true });
  const ymd = startTime.toISOString().slice(0, 10);
  const file = path.join(dir, `${ymd}.md`);
  const lines = [
    `# Research ingestion — ${ymd}`,
    '',
    `Run at ${startTime.toISOString()}`,
    '',
    '| Source | Fetched | New | Skipped | Error |',
    '|---|---|---|---|---|',
    ...reports.map(r =>
      `| ${r.source} | ${r.fetched} | ${r.newItems} | ${r.skipped} | ${r.error ?? ''} |`,
    ),
  ];
  fs.writeFileSync(file, lines.join('\n'));
  console.log(`Run summary written to ${path.relative(PROJECT_ROOT, file)}`);
}

async function main(): Promise<void> {
  const { tiers } = parseArgs(process.argv.slice(2));
  const feeds = loadFeeds().filter(f => tiers.has(f.tier));
  if (feeds.length === 0) {
    console.log('No feeds match the requested tiers.');
    return;
  }

  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
  db.pragma('journal_mode = WAL');
  const nowSec = Math.floor(Date.now() / 1000);
  const startTime = new Date();

  console.log(`Ingesting ${feeds.length} feed(s) [tiers: ${[...tiers].sort().join(',')}]`);

  const reports: IngestReport[] = [];
  for (const feed of feeds) {
    process.stdout.write(`  ${feed.name}... `);
    const report = await ingestFeed(db, feed, defaultHttpText, nowSec);
    reports.push(report);
    if (report.error) {
      console.log(`ERROR: ${report.error.slice(0, 120)}`);
    } else {
      console.log(`fetched=${report.fetched} new=${report.newItems} skipped=${report.skipped}`);
    }
  }

  // Optional NotebookLM upload — gated by env var. Only uploads items
  // that were inserted fresh this run (upload_status='pending' + fetchedAt=nowSec).
  const notebookId = process.env.POLY_RESEARCH_NOTEBOOK_ID;
  if (notebookId) {
    console.log(`Uploading pending items to NotebookLM ${notebookId}...`);
    const pending = latestItems(db, 50).filter(i => i.uploadStatus === 'pending' && i.fetchedAt === nowSec);
    for (const item of pending) {
      const content = composeNoteContent({
        source: item.source, title: item.title, url: item.url,
        publishedAt: item.publishedAt, snippet: item.snippet,
      });
      const title = `${item.source}: ${item.title}`.slice(0, 120);
      const ok = await uploadToNotebookLM(notebookId, title, content);
      markUploaded(db, item.id, ok);
    }
  } else {
    console.log('POLY_RESEARCH_NOTEBOOK_ID not set — items persisted locally only.');
  }

  writeRunSummary(reports, startTime);

  const total = reports.reduce((s, r) => s + r.newItems, 0);
  console.log(`\nTotal new items: ${total}`);
  db.close();
}

main().catch(err => {
  console.error('research-ingest failed:', err);
  process.exit(1);
});
