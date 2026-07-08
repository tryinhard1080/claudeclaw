import type Database from 'better-sqlite3';
import crypto from 'crypto';
import { spawn } from 'child_process';

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

export interface RssNewsItem {
  title: string;
  link: string;
  source: string;
  pubDate: number | null;
  description: string;
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
 * Detects when the model returns a refusal instead of actual news.
 * sonar on intent=quick sometimes refuses real-time queries rather than
 * searching. We treat these as skippable (not errors) so we don't pollute
 * the DB with garbage rows or fire false alarms.
 */
export function isRefusalResponse(text: string): boolean {
  const lower = text.toLowerCase().replace(/\u2018|\u2019/g, "'");
  const patterns = [
    "don't have real-time",
    "do not have real-time",
    "don't have access to real-time",
    "don't have live",
    "do not have live",
    "don't currently have live",
    "do not currently have live",
    "don't have access to live",
    "don't currently have access to live",
    "do not currently have access to live",
    "no access to real-time",
    "no live tool access",
    "live tool access to pull",
    "no live trading-news access",
    "pull the very latest",
    "can't pull the last",
    "cannot pull the last",
    "can't provide real-time",
    "cannot provide real-time",
    "i don't have the ability to browse",
    "i cannot browse",
    "my training data",
    "i'm unable to access current",
    "unable to access real-time",
  ];
  return patterns.some((p) => lower.includes(p));
}

/**
 * Detects tool or MCP wrapper failures that arrive as normal text answers.
 * These are not news and must not refresh source-freshness evidence.
 */
export function isToolErrorResponse(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns = [
    'responseparsingerror',
    'failed to parse api response',
    "missing 'text' field",
    'missing "text" field',
  ];
  return patterns.some((p) => lower.includes(p));
}

function decodeNumericEntity(raw: string, code: string, radix: number): string {
  const n = Number.parseInt(code, radix);
  return Number.isFinite(n) && n >= 0 && n <= 0x10ffff
    ? String.fromCodePoint(n)
    : raw;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (raw, code: string) => decodeNumericEntity(raw, code, 16))
    .replace(/&#(\d+);/g, (raw, code: string) => decodeNumericEntity(raw, code, 10));
}

function stripTags(value: string): string {
  return decodeXmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? stripTags(match[1] ?? '') : '';
}

export function parseRssItems(xml: string, source: string): RssNewsItem[] {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((match) => {
      const itemXml = match[0];
      const title = tagValue(itemXml, 'title');
      const link = tagValue(itemXml, 'link');
      const description = tagValue(itemXml, 'description');
      const pubRaw = tagValue(itemXml, 'pubDate');
      const pubMs = pubRaw ? Date.parse(pubRaw) : NaN;
      return {
        title,
        link,
        source,
        pubDate: Number.isFinite(pubMs) ? Math.floor(pubMs / 1000) : null,
        description,
      };
    })
    .filter(item => item.title.length > 0);
}

const RSS_FALLBACK_FEEDS = [
  { source: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { source: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/' },
  { source: 'Yahoo Finance SPY', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY&region=US&lang=en-US' },
] as const;

const TRADING_RELEVANCE_PATTERNS = [
  /\bfed\b/, /\bfomc\b/, /\bpowell\b/, /\brates?\b/, /\binflation\b/,
  /\bcpi\b/, /\bpce\b/, /\bjobs report\b/, /\bpayrolls?\b/,
  /\btreasur(?:y|ies)\b/, /\byields?\b/,
  /\bstocks?\b/, /\bstock market\b/, /\bwall street\b/,
  /\bmarket(?:s)?\s+(?:rall(?:y|ies)|rise|fall|drop|slump|sell|gain|slide)/,
  /\bfutures\b/, /\bs&p\b/, /\bspx\b/, /\bspy\b/, /\bnasdaq\b/, /\bdow\b/,
  /\bearnings?\b/, /\boil\b/, /\bopec\b/,
  /\btariffs?\b/, /\bsanctions?\b/, /\bsec\b/, /\bregulat(?:ion|or|ory)\b/,
  /\bcrypto\b/, /\bbitcoin\b/, /\bethereum\b/,
  /\belection\b/, /\bcongress\b/, /\bsupreme court\b/,
  /\btrump\b/, /\bbiden\b/,
  /\biran\b/, /\bisrael\b/, /\bhezbollah\b/, /\bhormuz\b/,
  /\brussia\b/, /\bukraine\b/, /\bchina\b/, /\btaiwan\b/,
  /\bnvidia\b/, /\balphabet\b/, /\bgoogle\b/, /\bapple\b/,
  /\bmicrosoft\b/, /\btesla\b/, /\bmeta\b/, /\bamazon\b/,
];

const PERSONAL_FINANCE_NOISE_PATTERNS = [
  /\bi(?:'|’)?m\b/, /\bi am\b/,
  /\bmy\s+(?:husband|wife|spouse|partner|kids?|parents?|family)\b/,
  /\blong-term care\b/, /\bsocial security\b/, /\bmedicare\b/,
  /\bestate planning\b/, /\bretire(?:d|ment)?\b/, /\b401\(k\)\b/,
  /\bmortgage\b/, /\bcredit cards?\b/, /\bstudent loans?\b/,
  /\bhome buyer\b/, /\badvice\b/,
];

const PERSONAL_FINANCE_STRONG_OVERRIDE_PATTERNS = [
  /\bfed\b/, /\bfomc\b/, /\bstocks?\b/, /\bstock market\b/,
  /\bs&p\b/, /\bspx\b/, /\bspy\b/, /\bnasdaq\b/, /\bdow\b/,
  /\bfutures\b/, /\binflation\b/, /\bcpi\b/, /\bpce\b/,
  /\btariffs?\b/, /\bsanctions?\b/, /\boil\b/, /\bcrypto\b/,
  /\bbitcoin\b/, /\bearnings?\b/,
];

export function isTradingRelevantRssItem(item: RssNewsItem): boolean {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const hasTradingSignal = TRADING_RELEVANCE_PATTERNS.some(pattern => pattern.test(haystack));
  if (!hasTradingSignal) return false;

  const looksLikePersonalFinance = PERSONAL_FINANCE_NOISE_PATTERNS.some(pattern => pattern.test(haystack));
  if (!looksLikePersonalFinance) return true;

  return PERSONAL_FINANCE_STRONG_OVERRIDE_PATTERNS.some(pattern => pattern.test(haystack));
}

export function selectTradingRelevantRssItems(items: RssNewsItem[], limit = 12): RssNewsItem[] {
  return [...items]
    .filter(isTradingRelevantRssItem)
    .sort((a, b) => (b.pubDate ?? 0) - (a.pubDate ?? 0))
    .slice(0, limit);
}

async function fetchTextWithTimeout(url: string, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function formatRssFallbackSummary(items: RssNewsItem[], nowSec: number = Math.floor(Date.now() / 1000)): string {
  const latest = selectTradingRelevantRssItems(items);
  if (latest.length === 0) throw new Error('RSS fallback found no trading-relevant items');

  return [
    'RSS fallback latest available headlines:',
    ...latest.map((item) => {
      const age = item.pubDate ? `${Math.max(0, Math.round((nowSec - item.pubDate) / 3600))}h old` : 'age unknown';
      const desc = item.description ? ` — ${item.description.slice(0, 140)}` : '';
      return `- ${item.title} (${item.source}, ${age})${desc}`;
    }),
  ].join('\n');
}

export const rssFallbackFetcher: PerplexityFetcher = async () => {
  const settled = await Promise.allSettled(
    RSS_FALLBACK_FEEDS.map(async feed => ({
      feed,
      xml: await fetchTextWithTimeout(feed.url),
    })),
  );
  const items = settled.flatMap((result) => (
    result.status === 'fulfilled'
      ? parseRssItems(result.value.xml, result.value.feed.source)
      : []
  ));
  const selected = selectTradingRelevantRssItems(items);
  const summary = formatRssFallbackSummary(selected);
  const citations = [...new Set(selected.map(item => item.link).filter(Boolean))].slice(0, 12);
  return {
    model: 'rss-fallback',
    choices: [{ message: { role: 'assistant', content: summary }, finish_reason: 'stop' }],
    citations,
  };
};

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

/**
 * Sprint 18 REST implementation. Kept exported for backward compatibility
 * and tests that explicitly want the HTTP path; not the default any more.
 */
export const restFetcher: PerplexityFetcher = async ({ prompt, apiKey, baseUrl, model }) => {
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

/**
 * Spawn boundary for the pwm CLI. Exported so tests can override with a
 * fake without monkeypatching child_process. In production this is the
 * real `child_process.spawn` thinly wrapped to capture stdout/stderr/code.
 */
export type PwmRunner = (args: string[], env: NodeJS.ProcessEnv) => Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}>;

export const realPwmRunner: PwmRunner = (args, env) => new Promise((resolve, reject) => {
  const bin = process.env.PWM_BIN ?? 'pwm';
  const child = spawn(bin, args, { env, shell: false });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += String(d); });
  child.stderr.on('data', (d) => { stderr += String(d); });
  child.on('error', (err) => reject(new Error(`pwm spawn failed: ${err.message}`)));
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

interface PwmAskJsonOutput {
  answer?: string;
  citations?: string[];
  model?: string;
  source?: string;
}

/**
 * Sprint 26 — replaces the REST path. Routes through the locally-installed
 * `pwm` CLI (perplexity-web-mcp-cli). Auth is managed by `pwm login` on
 * the host, NOT by PPLX_API_KEY in .env. The `apiKey` arg is preserved on
 * the PerplexityFetcher contract for backward compatibility but is unused
 * here; runNewsSync still gates the call on its truthiness as the on/off
 * switch (set PPLX_API_KEY=pwm or any truthy value to enable).
 */
export function makePwmCliFetcher(runner: PwmRunner = realPwmRunner): PerplexityFetcher {
  return async ({ prompt }) => {
    const args = [
      'ask-cmd', prompt,
      '--json',
      '--intent', 'quick',     // free Sonar tier; preserves Pro/Deep quotas
      '--source', 'web',
    ];
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };

    const result = await runner(args, env);
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      throw new Error(`pwm exit ${result.code}: ${detail.slice(0, 300)}`);
    }

    let parsed: PwmAskJsonOutput;
    try {
      parsed = JSON.parse(result.stdout) as PwmAskJsonOutput;
    } catch (err) {
      throw new Error(
        `pwm JSON parse failed: ${(err as Error).message}; stdout head: ${result.stdout.slice(0, 200)}`,
      );
    }

    if (!parsed.answer || typeof parsed.answer !== 'string') {
      throw new Error(`pwm response missing answer field: ${result.stdout.slice(0, 200)}`);
    }

    return {
      model: parsed.model ?? 'sonar',
      choices: [{
        message: { role: 'assistant', content: parsed.answer },
        finish_reason: 'stop',
      }],
      citations: parsed.citations,
    };
  };
}

export const pwmCliFetcher: PerplexityFetcher = makePwmCliFetcher();

/**
 * Default fetcher used when the caller does not inject one. Sprint 26:
 * pwm CLI subprocess, replacing the Sprint 18 REST implementation.
 */
export const defaultPerplexityFetcher: PerplexityFetcher = pwmCliFetcher;

export interface RunNewsSyncResult {
  ok: boolean;
  reason?: string;
  inserted?: InsertedNewsItem;
}

/**
 * High-level orchestration. Skips cleanly (returns ok: false with reason)
 * when the apiKey/sentinel is absent — caller maps that to exit code 0
 * (intentional skip, not failure). Sprint 26: the apiKey value is no
 * longer an HTTP credential; it's the on/off switch for the pwm CLI path.
 * Set PPLX_API_KEY=pwm (or any truthy placeholder) to enable.
 */
export async function runNewsSync(
  db: Database.Database,
  config: {
    apiKey: string;
    baseUrl: string;
    model: string;
    prompt?: string;
    fetcher?: PerplexityFetcher;
    fallbackFetcher?: PerplexityFetcher | null;
    nowSec?: number;
  },
): Promise<RunNewsSyncResult> {
  if (!config.apiKey) {
    return { ok: false, reason: 'PPLX_API_KEY (pwm enable-flag) not set — news-sync skipped' };
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

  const unusableReason = isRefusalResponse(summary)
    ? 'sonar-refusal'
    : isToolErrorResponse(summary)
      ? 'tool-error'
      : null;

  if (unusableReason) {
    const fallbackFetcher = config.fallbackFetcher === undefined
      ? (config.fetcher ? null : rssFallbackFetcher)
      : config.fallbackFetcher;
    if (!fallbackFetcher) {
      return { ok: false, reason: `${unusableReason}: live-search output unusable (not inserted)` };
    }

    try {
      raw = await fallbackFetcher({ prompt, apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model });
      summary = extractSummary(raw);
      if (isRefusalResponse(summary) || isToolErrorResponse(summary)) {
        return { ok: false, reason: `${unusableReason}: fallback also returned unusable output (not inserted)` };
      }
    } catch (err) {
      return { ok: false, reason: `${unusableReason}: RSS fallback failed: ${String(err).slice(0, 160)}` };
    }
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
