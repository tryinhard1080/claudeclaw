import type Database from 'better-sqlite3';
import { logger } from '../logger.js';

/**
 * Sprint 21 — match newly-ingested news_items against open paper-trade
 * slugs and emit a one-shot Telegram alert per (news_item, position) pair.
 *
 * The matching rule is intentionally conservative: token-overlap on the
 * slug, with stopword/short-token filtering and a 2-distinct-token-hit
 * threshold plus at least one distinctive token to suppress noise. Slugs are
 * descriptive sentences ("will-jd-vance-win-the-2028..."), so distinctive
 * tokens like "vance", "alphabet", "hormuz" carry the signal.
 */

const STOPWORDS = new Set([
  'will', 'the', 'by', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'at',
  'is', 'be', 'with', 'and', 'or', 'but', 'vs', 'before', 'after',
  'until', 'from', 'this', 'that', 'these', 'those', 'who', 'whose',
  'what', 'when', 'where', 'why', 'how', 'which', 'not', 'no', 'its',
  'their', 'our', 'your', 'my', 'his', 'her', 'them', 'we', 'us',
  'you', 'i', 'me', 'won', 'win', 'wins', 'winning', 'lose', 'loses',
  'losing', 'are', 'was', 'were', 'has', 'have', 'had', 'do', 'does',
  'did', 'over', 'under', 'into', 'than', 'then', 'such', 'only',
  'also', 'just', 'next', 'last', 'first', 'most', 'more',
]);

const MIN_TOKEN_LEN = 4;

const WEAK_INTERSECTION_TOKENS = new Set([
  'company', 'companies', 'market', 'markets', 'largest', 'world', 'cap',
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'normal', 'returns', 'traffic', 'peace', 'deal', 'permanent', 'temporary',
]);

function hasDistinctiveMatch(tokens: string[]): boolean {
  return tokens.some(tok => !WEAK_INTERSECTION_TOKENS.has(tok));
}

/**
 * Idempotent table bootstrap. Called once on first runtime use so a
 * deploy that lands before `npm run migrate` doesn't throw on missing
 * table. Mirrors migrations/v1.14.0/v1.14.0-news-position-alerts.ts.
 */
export function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS poly_news_position_alerts (
      news_item_id   INTEGER NOT NULL,
      paper_trade_id INTEGER NOT NULL,
      matched_tokens TEXT NOT NULL,
      emitted_at     INTEGER NOT NULL,
      PRIMARY KEY (news_item_id, paper_trade_id)
    );
    CREATE INDEX IF NOT EXISTS idx_news_alerts_emitted
      ON poly_news_position_alerts(emitted_at DESC);
  `);
}

/**
 * Tokenize a Polymarket slug for intersection matching. Drops stopwords,
 * short tokens (< MIN_TOKEN_LEN), and trailing numeric disambiguators
 * like the `-396` suffix Polymarket appends to duplicate questions.
 */
export function tokenizeSlug(slug: string): string[] {
  const parts = slug.toLowerCase().split('-').filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (/^\d+$/.test(p)) continue;       // trailing/embedded numerics
    if (STOPWORDS.has(p)) continue;
    if (p.length < MIN_TOKEN_LEN) continue;
    out.push(p);
  }
  // De-dup while preserving first occurrence order.
  return [...new Set(out)];
}

/**
 * Whole-word substring match. Case-insensitive on the haystack (caller
 * passes lowercased text). Avoids false positives from `iran` matching
 * inside `iranian` or `alphabet` matching inside `alphabetical`.
 */
function wholeWordMatch(needle: string, lowercasedHaystack: string): boolean {
  // Escape any regex meta chars in the slug-derived needle.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(lowercasedHaystack);
}

export interface IntersectionMatch {
  news_item_id: number;
  paper_trade_id: number;
  market_slug: string;
  outcome_label: string;
  matched_tokens: string[];
  news_summary: string;
}

export interface FindOpts {
  sinceSec: number;
  minTokenMatches?: number;
  nowSec?: number;
}

interface NewsRow { id: number; summary: string }
interface OpenTradeRow { id: number; market_slug: string; outcome_label: string }

/**
 * Cross-product news_items (recent) x open paper_trades, returning the
 * pairs that hit the threshold. Deterministic order: by news_item_id desc,
 * then paper_trade_id asc.
 */
export function findIntersections(db: Database.Database, opts: FindOpts): IntersectionMatch[] {
  ensureTable(db);
  const minMatches = opts.minTokenMatches ?? 2;

  const news = db.prepare(`
    SELECT id, summary FROM news_items
    WHERE fetched_at >= ?
    ORDER BY id DESC
  `).all(opts.sinceSec) as NewsRow[];

  if (news.length === 0) return [];

  const trades = db.prepare(`
    SELECT id, market_slug, outcome_label
    FROM poly_paper_trades
    WHERE status = 'open'
  `).all() as OpenTradeRow[];

  if (trades.length === 0) return [];

  const out: IntersectionMatch[] = [];
  for (const n of news) {
    const summaryLc = n.summary.toLowerCase();
    for (const t of trades) {
      const tokens = tokenizeSlug(t.market_slug);
      if (tokens.length < minMatches) continue;
      const matched = tokens.filter(tok => wholeWordMatch(tok, summaryLc));
      if (matched.length >= minMatches && hasDistinctiveMatch(matched)) {
        out.push({
          news_item_id: n.id,
          paper_trade_id: t.id,
          market_slug: t.market_slug,
          outcome_label: t.outcome_label,
          matched_tokens: matched,
          news_summary: n.summary,
        });
      }
    }
  }
  return out;
}

export type Sender = (text: string) => Promise<void>;

export interface RecordAndEmitResult {
  emitted: number;
  suppressed: number;
}

export function defaultFormat(m: IntersectionMatch): string {
  const preview = m.news_summary.length > 220
    ? m.news_summary.slice(0, 217) + '...'
    : m.news_summary;
  return [
    `News intersection: ${m.market_slug} (${m.outcome_label})`,
    `Matched tokens: ${m.matched_tokens.join(', ')}`,
    '',
    preview,
  ].join('\n');
}

/**
 * Insert each match with INSERT OR IGNORE; only call sender for rows
 * that actually inserted (db.changes() === 1). Suppressed = duplicate
 * emission attempts.
 */
export async function recordAndEmitAlerts(
  db: Database.Database,
  matches: IntersectionMatch[],
  sender: Sender,
  format: (m: IntersectionMatch) => string = defaultFormat,
  nowSec?: number,
): Promise<RecordAndEmitResult> {
  ensureTable(db);
  const ts = nowSec ?? Math.floor(Date.now() / 1000);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO poly_news_position_alerts
      (news_item_id, paper_trade_id, matched_tokens, emitted_at)
    VALUES (?, ?, ?, ?)
  `);

  let emitted = 0;
  let suppressed = 0;
  for (const m of matches) {
    const result = insert.run(
      m.news_item_id, m.paper_trade_id, m.matched_tokens.join(','), ts,
    );
    if (result.changes === 1) {
      emitted++;
      try {
        await sender(format(m));
      } catch (err) {
        logger.warn({ err: String(err), news_item_id: m.news_item_id, paper_trade_id: m.paper_trade_id },
          'news-intersection sender failed');
      }
    } else {
      suppressed++;
    }
  }
  return { emitted, suppressed };
}

export interface PassOpts {
  lookbackSec?: number;
  minTokenMatches?: number;
  nowSec?: number;
}

/**
 * Single entry-point. Defaults: 1h lookback (well within the 2h
 * news-sync cycle), 2-token-match threshold.
 */
export async function runNewsIntersectionPass(
  db: Database.Database,
  sender: Sender,
  opts: PassOpts = {},
): Promise<RecordAndEmitResult & { matched: number }> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const sinceSec = nowSec - (opts.lookbackSec ?? 3600);

  const matches = findIntersections(db, {
    sinceSec,
    minTokenMatches: opts.minTokenMatches,
    nowSec,
  });

  if (matches.length === 0) {
    return { emitted: 0, suppressed: 0, matched: 0 };
  }

  const result = await recordAndEmitAlerts(db, matches, sender, defaultFormat, nowSec);
  logger.info(
    { matched: matches.length, emitted: result.emitted, suppressed: result.suppressed },
    'news-intersection pass complete',
  );
  return { ...result, matched: matches.length };
}
