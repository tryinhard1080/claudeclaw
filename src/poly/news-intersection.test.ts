import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  tokenizeSlug,
  ensureTable,
  findIntersections,
  recordAndEmitAlerts,
  runNewsIntersectionPass,
  type IntersectionMatch,
} from './news-intersection.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE news_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fetched_at    INTEGER NOT NULL,
      prompt_hash   TEXT NOT NULL,
      summary       TEXT NOT NULL,
      raw_json      TEXT,
      model         TEXT,
      status        TEXT NOT NULL DEFAULT 'ok'
    );
    CREATE TABLE poly_paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      market_slug TEXT NOT NULL,
      outcome_token_id TEXT NOT NULL,
      outcome_label TEXT NOT NULL,
      side TEXT NOT NULL,
      entry_price REAL NOT NULL,
      size_usd REAL NOT NULL,
      shares REAL NOT NULL,
      kelly_fraction REAL NOT NULL,
      strategy TEXT NOT NULL,
      status TEXT NOT NULL,
      resolved_at INTEGER,
      realized_pnl REAL,
      voided_reason TEXT
    );
  `);
  return db;
}

function insertNews(db: Database.Database, summary: string, fetchedAt = 1_000_000): number {
  const r = db.prepare(`
    INSERT INTO news_items (fetched_at, prompt_hash, summary)
    VALUES (?, ?, ?)
  `).run(fetchedAt, 'h', summary);
  return Number(r.lastInsertRowid);
}

function insertTrade(db: Database.Database, slug: string, label = 'Yes', status = 'open'): number {
  const r = db.prepare(`
    INSERT INTO poly_paper_trades
      (created_at, market_slug, outcome_token_id, outcome_label, side,
       entry_price, size_usd, shares, kelly_fraction, strategy, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(1_000_000, slug, 't1', label, 'YES', 0.5, 10, 20, 0.1, 'ai-probability', status);
  return Number(r.lastInsertRowid);
}

describe('tokenizeSlug', () => {
  it('drops stopwords and short tokens', () => {
    const tokens = tokenizeSlug('will-jd-vance-win-the-2028-republican-presidential-nomination');
    expect(tokens).not.toContain('will');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('win');
    expect(tokens).not.toContain('jd');         // length < 4
    expect(tokens).toContain('vance');
    expect(tokens).toContain('republican');
    expect(tokens).toContain('presidential');
    expect(tokens).toContain('nomination');
  });

  it('strips numeric tokens including trailing disambiguators', () => {
    const tokens = tokenizeSlug('us-obtains-iranian-enriched-uranium-by-may-31-396');
    expect(tokens).not.toContain('31');
    expect(tokens).not.toContain('396');
    expect(tokens).toContain('obtains');
    expect(tokens).toContain('iranian');
    expect(tokens).toContain('enriched');
    expect(tokens).toContain('uranium');
  });

  it('lowercases and dedupes', () => {
    const tokens = tokenizeSlug('alphabet-Alphabet-largest');
    expect(tokens.filter(t => t === 'alphabet')).toHaveLength(1);
    expect(tokens).toContain('largest');
  });

  it('returns empty for an all-stopword/all-short slug', () => {
    expect(tokenizeSlug('will-the-be-of')).toEqual([]);
  });
});

describe('ensureTable', () => {
  it('creates the alerts table idempotently', () => {
    const db = freshDb();
    ensureTable(db);
    ensureTable(db); // second call must not throw
    const count = db.prepare(
      "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='poly_news_position_alerts'",
    ).get() as { c: number };
    expect(count.c).toBe(1);
    db.close();
  });
});

describe('findIntersections', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('returns nothing when no news has matching tokens', () => {
    insertNews(db, 'Fed signals dovish stance on interest rates.');
    insertTrade(db, 'will-jd-vance-win-the-2028-republican-presidential-nomination');
    const matches = findIntersections(db, { sinceSec: 0 });
    expect(matches).toEqual([]);
  });

  it('matches when ≥2 distinct slug tokens appear in the news summary', () => {
    insertNews(db, 'JD Vance positions himself as the leading Republican contender for the 2028 presidential nomination.');
    const tradeId = insertTrade(db, 'will-jd-vance-win-the-2028-republican-presidential-nomination');
    const matches = findIntersections(db, { sinceSec: 0 });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.paper_trade_id).toBe(tradeId);
    expect(matches[0]!.matched_tokens.length).toBeGreaterThanOrEqual(2);
  });

  it('suppresses single-token matches', () => {
    insertNews(db, 'Republican governors hold their annual meeting; no other political news of note.');
    insertTrade(db, 'will-jd-vance-win-the-2028-republican-presidential-nomination');
    const matches = findIntersections(db, { sinceSec: 0 });
    expect(matches).toEqual([]);
  });

  it('matches whole words only (iran does not match iranian)', () => {
    insertNews(db, 'Iranian foreign ministry comments reference uranium enrichment programs.');
    insertTrade(db, 'will-iran-strike-saudi-arabia');
    // tokens = ['iran', 'strike', 'saudi', 'arabia']
    // summary contains 'iranian' (not 'iran' as whole word) and 'uranium' but no other slug tokens
    // So only 'iran' might match — and it doesn't because of \b boundary
    const matches = findIntersections(db, { sinceSec: 0 });
    expect(matches).toEqual([]);
  });

  it('matches with custom minTokenMatches threshold', () => {
    insertNews(db, 'Vance attended a fundraiser today.');
    insertTrade(db, 'will-jd-vance-win-the-2028-republican-presidential-nomination');
    expect(findIntersections(db, { sinceSec: 0, minTokenMatches: 2 })).toEqual([]);
    expect(findIntersections(db, { sinceSec: 0, minTokenMatches: 1 })).toHaveLength(1);
  });

  it('respects sinceSec lookback (older news is ignored)', () => {
    insertNews(db, 'Vance Republican presidential 2028 update.', 100);  // old
    insertNews(db, 'Different topic about weather.', 1_000_000);          // recent, no match
    insertTrade(db, 'will-jd-vance-win-the-2028-republican-presidential-nomination');
    expect(findIntersections(db, { sinceSec: 500_000 })).toEqual([]);
  });

  it('skips closed trades', () => {
    insertNews(db, 'Vance Republican presidential 2028 update.');
    insertTrade(db, 'will-jd-vance-win-the-2028-republican-presidential-nomination', 'Yes', 'closed');
    expect(findIntersections(db, { sinceSec: 0 })).toEqual([]);
  });
});

describe('recordAndEmitAlerts', () => {
  it('emits once per pair and suppresses duplicate emissions', async () => {
    const db = freshDb();
    ensureTable(db);
    const sent: string[] = [];
    const sender = async (t: string) => { sent.push(t); };

    const m: IntersectionMatch = {
      news_item_id: 1, paper_trade_id: 2,
      market_slug: 'foo-bar-baz', outcome_label: 'Yes',
      matched_tokens: ['foo', 'bar'],
      news_summary: 'foo bar appeared in news',
    };
    const r1 = await recordAndEmitAlerts(db, [m], sender);
    expect(r1.emitted).toBe(1);
    expect(r1.suppressed).toBe(0);
    expect(sent).toHaveLength(1);

    const r2 = await recordAndEmitAlerts(db, [m], sender);
    expect(r2.emitted).toBe(0);
    expect(r2.suppressed).toBe(1);
    expect(sent).toHaveLength(1);
    db.close();
  });

  it('persists matched_tokens and emitted_at on the row', async () => {
    const db = freshDb();
    ensureTable(db);
    const m: IntersectionMatch = {
      news_item_id: 7, paper_trade_id: 9,
      market_slug: 'foo-bar', outcome_label: 'No',
      matched_tokens: ['foo', 'bar'],
      news_summary: 'x',
    };
    await recordAndEmitAlerts(db, [m], async () => {}, undefined, 1234567);
    const row = db.prepare(`SELECT * FROM poly_news_position_alerts`).get() as
      { news_item_id: number; paper_trade_id: number; matched_tokens: string; emitted_at: number };
    expect(row.matched_tokens).toBe('foo,bar');
    expect(row.emitted_at).toBe(1234567);
    db.close();
  });
});

describe('runNewsIntersectionPass', () => {
  it('end-to-end: matches, records, sends', async () => {
    const db = freshDb();
    insertNews(db, 'JD Vance positions himself as the leading Republican contender for 2028 presidential nomination.', 1_000_000);
    insertTrade(db, 'will-jd-vance-win-the-2028-republican-presidential-nomination');
    const sent: string[] = [];

    const result = await runNewsIntersectionPass(db, async (t) => { sent.push(t); }, {
      lookbackSec: 7200,
      nowSec: 1_000_000,
    });
    expect(result.matched).toBe(1);
    expect(result.emitted).toBe(1);
    expect(sent[0]).toContain('News intersection');
    expect(sent[0]).toContain('vance');
    db.close();
  });

  it('returns zero counts when no news in lookback window', async () => {
    const db = freshDb();
    insertTrade(db, 'will-jd-vance-win-the-2028-republican-presidential-nomination');
    const result = await runNewsIntersectionPass(db, async () => {}, { nowSec: 1_000_000 });
    expect(result).toEqual({ matched: 0, emitted: 0, suppressed: 0 });
    db.close();
  });
});
