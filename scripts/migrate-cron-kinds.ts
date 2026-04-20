/**
 * One-shot data migration: route existing scheduled_tasks rows to the
 * appropriate kind after v1.11.0 ships.
 *
 * - news-sync (3d623e0e) → status='paused'. Redundant with research-ingest
 *   and requires Perplexity MCP access that a headless Node process does
 *   not have. Operator can re-enable if needed by wiring a direct
 *   Perplexity API key.
 * - research-ingest (3de52de7) → kind='shell', script_path='scripts/research-ingest.ts --all-tiers'
 * - resolution-fetch (a6e080bd) → kind='shell', script_path='scripts/fetch-resolutions.ts'
 * - adversarial-review (2c87cdca) → kept as kind='claude-agent' (default)
 *
 * Idempotent. Safe to re-run.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';

const NEWS_SYNC_ID = '3d623e0e';
const RESEARCH_INGEST_ID = '3de52de7';
const RESOLUTION_FETCH_ID = 'a6e080bd';
const ADVERSARIAL_REVIEW_ID = '2c87cdca';

function main(): void {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const updates: Array<{ id: string; action: string; sets: Record<string, unknown> }> = [
    {
      id: NEWS_SYNC_ID,
      action: 'paused (redundant with research-ingest; needs Perplexity API key for shell revival)',
      sets: { status: 'paused' },
    },
    {
      id: RESEARCH_INGEST_ID,
      action: 'kind=shell → scripts/research-ingest.ts --all-tiers',
      sets: { kind: 'shell', script_path: 'scripts/research-ingest.ts --all-tiers' },
    },
    {
      id: RESOLUTION_FETCH_ID,
      action: 'kind=shell → scripts/fetch-resolutions.ts',
      sets: { kind: 'shell', script_path: 'scripts/fetch-resolutions.ts' },
    },
    {
      id: ADVERSARIAL_REVIEW_ID,
      action: 'left as kind=claude-agent (agentic review; requires CLAUDE_CODE_OAUTH_TOKEN to fire)',
      sets: {},
    },
  ];

  for (const u of updates) {
    if (Object.keys(u.sets).length === 0) {
      console.log(`  ${u.id} — ${u.action}`);
      continue;
    }
    const setSql = Object.keys(u.sets).map(k => `${k} = @${k}`).join(', ');
    const result = db
      .prepare(`UPDATE scheduled_tasks SET ${setSql} WHERE id = @id`)
      .run({ id: u.id, ...u.sets });
    console.log(`  ${u.id} — ${u.action}${result.changes === 0 ? ' [NO-OP: task not found]' : ''}`);
  }

  // Verify: show all 4 after update.
  const rows = db
    .prepare(`SELECT id, kind, script_path, status, schedule, prompt FROM scheduled_tasks WHERE id IN (?, ?, ?, ?)`)
    .all(NEWS_SYNC_ID, RESEARCH_INGEST_ID, RESOLUTION_FETCH_ID, ADVERSARIAL_REVIEW_ID);
  console.log('\nFinal state:');
  for (const r of rows as Array<Record<string, unknown>>) {
    console.log(
      `  ${r.id} kind=${r.kind ?? '-'} script=${(r.script_path as string | null) ?? '-'} status=${r.status} schedule=${r.schedule}`,
    );
  }

  db.close();
}

main();
