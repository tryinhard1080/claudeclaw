import type Database from 'better-sqlite3';
import crypto from 'crypto';

export interface PerplexityResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  citations?: string[];
}

export interface InsertedNewsItem {
  id: number;
  fetched_at: number;
  prompt_hash: string;
  summary: string;
  model: string | null;
  status: string;
  deduped: boolean;
}

export const NEWS_SYNC_PROMPT =
  `Execute the 2-hour trading-news sync. Identify (1) major market-moving headlines in the last 2 hours (Fed/regulatory/macro), and (2) breaking news likely to affect Polymarket-style prediction-market categories: US politics, geopolitics (Iran/Russia/China), tech regulation, crypto, sports outcomes resolving in the next 7 days. Return a tight bullet summary (max 12 bullets, each one line). Skip filler and AI commentary; just the headlines + 1-line significance per item.`;

const NEWS_SYNC_HEARTBEAT_KEY = 'news_sync.last_success_at';
const DEDUPE_WINDOW_SEC = 90 * 60; // 90 min — slightly less than the 2h cron cadence so consecutive runs dedupe but daily history accumulates

export function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

export function extractSummary(resp: PerplexityResponse): string {
  const content = resp?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Perplexity response missing choices[0].message.content');
  }
  return content.trim();
}

/**
 * Insert a news item, deduping against any row written within the last
 * DEDUPE_WINDOW_SEC seconds with the same prompt_hash AND identical summary.
 * Same prompt + same summary in a tight window means Perplexity returned
 * substantively the same content (likely) — skip the write to avoid
 * inflating row count.
 *
 * Returns the inserted row's id + a `deduped: true` flag when a write
 * was skipped (in which case `id` references the existing recent row).
 */
export function insertNewsItem(
  db: Database.Database,
  args: {
    summary: string;
    promptHash: string;
    model: string | null;
    rawJson: string | null;
    status?: string;
    nowSec?: number;
  },
): InsertedNewsItem {
  const fetched_at = args.nowSec ?? Math.floor(Date.now() / 1000);
  const status = args.status ?? 'ok';

  const recent = db.prepare(`
    SELECT id, fetched_at, summary, model, status FROM news_items
    WHERE prompt_hash = ? AND fetched_at >= ?
    ORDER BY id DESC LIMIT 1
  `).get(args.promptHash, fetched_at - DEDUPE_WINDOW_SEC) as
    | { id: number; fetched_at: number; summary: string; model: string | null; status: string }
    | undefined;

  if (recent && recent.summary === args.summary) {
    return {
      id: recent.id, fetched_at: recent.fetched_at,
      prompt_hash: args.promptHash, summary: recent.summary,
      model: recent.model, status: recent.status, deduped: true,
    };
  }

  const info = db.prepare(`
    INSERT INTO news_items (fetched_at, prompt_hash, summary, raw_json, model, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(fetched_at, args.promptHash, args.summary, args.rawJson, args.model, status);

  return {
    id: Number(info.lastInsertRowid), fetched_at,
    prompt_hash: args.promptHash, summary: args.summary,
    model: args.model, status, deduped: false,
  };
}

export function writeHeartbeat(db: Database.Database, nowSec?: number): void {
  const ts = String(nowSec ?? Math.floor(Date.now() / 1000));
  db.prepare(`
    INSERT INTO poly_kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(NEWS_SYNC_HEARTBEAT_KEY, ts);
}

export function readHeartbeat(db: Database.Database): number | null {
  const row = db.prepare(`SELECT value FROM poly_kv WHERE key = ?`).get(NEWS_SYNC_HEARTBEAT_KEY) as
    | { value: string } | undefined;
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

export interface PerplexityFetcher {
  (args: { prompt: string; apiKey: string; baseUrl: string; model: string }): Promise<PerplexityResponse>;
}

export const defaultPerplexityFetcher: PerplexityFetcher = async ({ prompt, apiKey, baseUrl, model }) => {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Perplexity API ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json() as PerplexityResponse;
};

export interface RunNewsSyncResult {
  ok: boolean;
  reason?: string;
  inserted?: InsertedNewsItem;
}

/**
 * High-level orchestration. Skips cleanly (returns ok: false with reason)
 * when API key absent — caller maps that to exit code 0 (intentional skip,
 * not failure) so a missing key during operator setup doesn't spam alerts.
 */
export async function runNewsSync(
  db: Database.Database,
  config: {
    apiKey: string;
    baseUrl: string;
    model: string;
    prompt?: string;
    fetcher?: PerplexityFetcher;
    nowSec?: number;
  },
): Promise<RunNewsSyncResult> {
  if (!config.apiKey) {
    return { ok: false, reason: 'PPLX_API_KEY not set — news-sync skipped' };
  }
  const prompt = config.prompt ?? NEWS_SYNC_PROMPT;
  const fetcher = config.fetcher ?? defaultPerplexityFetcher;

  let raw: PerplexityResponse;
  try {
    raw = await fetcher({ prompt, apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model });
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${String(err).slice(0, 200)}` };
  }

  let summary: string;
  try {
    summary = extractSummary(raw);
  } catch (err) {
    return { ok: false, reason: `parse failed: ${String(err).slice(0, 200)}` };
  }

  const inserted = insertNewsItem(db, {
    summary,
    promptHash: hashPrompt(prompt),
    model: raw.model ?? config.model,
    rawJson: JSON.stringify(raw),
    nowSec: config.nowSec,
  });

  writeHeartbeat(db, config.nowSec);

  return { ok: true, inserted };
}
