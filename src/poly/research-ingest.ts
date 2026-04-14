import type Database from 'better-sqlite3';

/**
 * Sprint 4 — research ingestion.
 *
 * Pulls RSS/Atom feeds listed in docs/research/feeds.json, dedupes by URL
 * against the research_items table, and persists a short snippet.
 * Optional upload to NotebookLM via nlm CLI if POLY_RESEARCH_NOTEBOOK_ID
 * is set. The goal per EVOLUTION.md §3.6 is durable knowledge — every
 * useful article the bot sees becomes queryable later.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface RawItem {
  title: string;
  url: string;
  publishedAt: number | null;  // unix sec
  snippet: string | null;
}

export interface FeedConfig {
  name: string;
  url: string;
  tier: 1 | 2 | 3;
  notebook?: string | null;  // NotebookLM notebook key or id
}

export interface PersistArgs {
  item: RawItem;
  source: string;
  tier: number;
  notebook: string | null;
  fetchedAt: number;
}

// ── Parsing ──────────────────────────────────────────────────────────

const SNIPPET_MAX = 480;

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(s: string, n = SNIPPET_MAX): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function parseDate(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function extractTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(m[1]!).trim() : null;
}

/**
 * Parse RSS 2.0 or Atom 1.0. Tolerant regex parser — real feeds vary
 * enough that xml2js-level strictness hurts more than it helps.
 * Returns [] for anything that doesn't match either shape, so callers
 * can distinguish "empty feed" (still [] but from the right shape)
 * only by checking upstream HTTP success.
 */
export function parseFeed(xml: string): RawItem[] {
  const out: RawItem[] = [];

  // RSS 2.0 — <item> blocks
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pub = extractTag(block, 'pubDate');
    const desc = extractTag(block, 'description') ?? extractTag(block, 'content:encoded');
    if (!title || !link) continue;
    out.push({
      title,
      url: link,
      publishedAt: parseDate(pub),
      snippet: desc ? truncate(stripHtml(desc)) : null,
    });
  }

  // Atom 1.0 — <entry> blocks
  const entryBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of entryBlocks) {
    const title = extractTag(block, 'title');
    // Atom link is <link href="..."/> — need the href attribute specifically.
    const linkMatch = block.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*(?:\/>|>)/i);
    const link = linkMatch ? linkMatch[1]! : null;
    const published = extractTag(block, 'published') ?? extractTag(block, 'updated');
    const summary = extractTag(block, 'summary') ?? extractTag(block, 'content');
    if (!title || !link) continue;
    out.push({
      title,
      url: link,
      publishedAt: parseDate(published),
      snippet: summary ? truncate(stripHtml(summary)) : null,
    });
  }

  return out;
}

// ── Persistence ──────────────────────────────────────────────────────

export function isNewUrl(db: Database.Database, url: string): boolean {
  const row = db.prepare(`SELECT 1 AS x FROM research_items WHERE url = ?`).get(url);
  return row === undefined;
}

/**
 * INSERT OR IGNORE on the UNIQUE(url) constraint — dedup is enforced at
 * the schema level so concurrent ingest runs (shouldn't happen but is
 * theoretically possible if the weekly cron overlaps a manual run)
 * cannot create dupes.
 */
export function persistItem(db: Database.Database, args: PersistArgs): number | null {
  const info = db.prepare(`
    INSERT OR IGNORE INTO research_items
      (source, url, title, published_at, fetched_at, tier, notebook, snippet)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    args.source, args.item.url, args.item.title,
    args.item.publishedAt, args.fetchedAt, args.tier,
    args.notebook, args.item.snippet,
  );
  return info.changes === 0 ? null : Number(info.lastInsertRowid);
}

export interface StoredItem {
  id: number;
  source: string;
  url: string;
  title: string;
  publishedAt: number | null;
  fetchedAt: number;
  tier: number;
  notebook: string | null;
  snippet: string | null;
  uploadStatus: string;
}

interface StoredItemRow {
  id: number; source: string; url: string; title: string;
  published_at: number | null; fetched_at: number; tier: number;
  notebook: string | null; snippet: string | null; upload_status: string;
}

export function latestItems(db: Database.Database, limit: number): StoredItem[] {
  const rows = db.prepare(`
    SELECT id, source, url, title, published_at, fetched_at, tier, notebook, snippet, upload_status
      FROM research_items
     ORDER BY fetched_at DESC, id DESC
     LIMIT ?
  `).all(limit) as StoredItemRow[];
  return rows.map(r => ({
    id: r.id, source: r.source, url: r.url, title: r.title,
    publishedAt: r.published_at, fetchedAt: r.fetched_at, tier: r.tier,
    notebook: r.notebook, snippet: r.snippet, uploadStatus: r.upload_status,
  }));
}

export function markUploaded(db: Database.Database, id: number, ok: boolean): void {
  db.prepare(`UPDATE research_items SET upload_status = ? WHERE id = ?`)
    .run(ok ? 'uploaded' : 'failed', id);
}

// ── Feed config validation ───────────────────────────────────────────

export function validateFeedConfig(cfg: unknown): asserts cfg is FeedConfig[] {
  if (!Array.isArray(cfg)) throw new Error('feed config must be an array');
  for (const [i, item] of cfg.entries()) {
    const c = item as FeedConfig;
    if (!c.name || typeof c.name !== 'string') throw new Error(`feed[${i}].name missing`);
    if (!c.url || typeof c.url !== 'string') throw new Error(`feed[${i}].url missing`);
    try { new URL(c.url); } catch { throw new Error(`feed[${i}].url is malformed: ${c.url}`); }
    if (![1, 2, 3].includes(c.tier)) throw new Error(`feed[${i}].tier must be 1, 2, or 3`);
  }
}

// ── Note composition (for NotebookLM or local markdown) ──────────────

export interface NoteArgs {
  source: string;
  title: string;
  url: string;
  publishedAt: number | null;
  snippet: string | null;
}

export function composeNoteContent(n: NoteArgs): string {
  const lines: string[] = [`# ${n.title}`, '', `**Source**: ${n.source}`, `**URL**: ${n.url}`];
  if (n.publishedAt !== null) {
    lines.push(`**Published**: ${new Date(n.publishedAt * 1000).toISOString().slice(0, 10)}`);
  }
  if (n.snippet) {
    lines.push('', n.snippet);
  }
  return lines.join('\n');
}

// ── Orchestration: fetch + dedupe + persist ──────────────────────────

export type HttpTextFn = (url: string) => Promise<string>;

export async function defaultHttpText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
      'user-agent': 'claudeclaw-research/1.0',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

export interface IngestReport {
  source: string;
  fetched: number;
  newItems: number;
  skipped: number;
  error?: string;
}

export async function ingestFeed(
  db: Database.Database,
  feed: FeedConfig,
  http: HttpTextFn,
  nowSec: number,
): Promise<IngestReport> {
  let xml: string;
  try {
    xml = await http(feed.url);
  } catch (err) {
    return { source: feed.name, fetched: 0, newItems: 0, skipped: 0, error: String(err) };
  }
  const items = parseFeed(xml);
  let newItems = 0;
  let skipped = 0;
  for (const item of items) {
    const id = persistItem(db, {
      item, source: feed.name, tier: feed.tier,
      notebook: feed.notebook ?? null, fetchedAt: nowSec,
    });
    if (id === null) skipped++; else newItems++;
  }
  return { source: feed.name, fetched: items.length, newItems, skipped };
}
