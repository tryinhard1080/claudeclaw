#!/usr/bin/env tsx
/**
 * Sprint 18 / plan cheerful-rossum B8 — news-sync revival as kind=shell.
 *
 * Replaces the legacy kind=claude-agent task (id 3d623e0e) which required
 * Perplexity MCP access that headless Node lacks. Calls Perplexity REST
 * API directly with PPLX_API_KEY.
 *
 * Cron: every 2 hours (`0 * /2 * * *` after the SQL UPDATE).
 *
 * Exit codes:
 *   0 = success (row inserted) OR intentional skip (no API key — operator
 *       hasn't provisioned yet, alert would be noise)
 *   1 = real failure (fetch failed, parse failed, DB write failed)
 *
 * Usage:
 *   npx tsx scripts/news-sync.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR, PPLX_API_KEY, PPLX_BASE_URL, PPLX_NEWS_MODEL } from '../src/config.js';
import { runNewsSync } from '../src/poly/news-sync.js';

async function main(): Promise<void> {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  try {
    const result = await runNewsSync(db, {
      apiKey: PPLX_API_KEY,
      baseUrl: PPLX_BASE_URL,
      model: PPLX_NEWS_MODEL,
    });

    if (!result.ok) {
      const noKey = result.reason?.includes('PPLX_API_KEY');
      if (noKey) {
        console.log(`[news-sync] skipped: ${result.reason}`);
        process.exit(0); // intentional skip — exit clean
      }
      console.error(`[news-sync] FAILED: ${result.reason}`);
      process.exit(1);
    }

    const i = result.inserted!;
    const tag = i.deduped ? 'deduped' : 'inserted';
    const preview = i.summary.slice(0, 200).replace(/\n/g, ' / ');
    console.log(`[news-sync] ok (${tag}) id=${i.id} fetched_at=${i.fetched_at} model=${i.model ?? '-'}`);
    console.log(`[news-sync] preview: ${preview}${i.summary.length > 200 ? '…' : ''}`);
    process.exit(0);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`[news-sync] FATAL: ${String(err).slice(0, 500)}`);
  process.exit(1);
});
