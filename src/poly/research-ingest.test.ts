import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  parseFeed, persistItem, isNewUrl, latestItems,
  validateFeedConfig, composeNoteContent,
  type RawItem, type FeedConfig,
} from './research-ingest.js';

function bootDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE research_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      published_at INTEGER, fetched_at INTEGER NOT NULL, tier INTEGER NOT NULL,
      notebook TEXT, snippet TEXT, upload_status TEXT NOT NULL DEFAULT 'pending');
  `);
  return db;
}

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Example Feed</title>
  <item>
    <title>First Post</title>
    <link>https://example.com/a</link>
    <pubDate>Mon, 13 Apr 2026 12:00:00 GMT</pubDate>
    <description><![CDATA[Some <b>html</b> description.]]></description>
  </item>
  <item>
    <title><![CDATA[Second &amp; Post]]></title>
    <link>https://example.com/b</link>
    <pubDate>Sun, 12 Apr 2026 09:30:00 GMT</pubDate>
    <description>Plain text summary.</description>
  </item>
</channel></rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom One</title>
    <link href="https://example.org/1"/>
    <published>2026-04-10T08:00:00Z</published>
    <summary>Atom summary.</summary>
  </entry>
  <entry>
    <title>Atom Two</title>
    <link href="https://example.org/2" rel="alternate"/>
    <updated>2026-04-09T08:00:00Z</updated>
    <summary>Second summary.</summary>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('parses RSS 2.0 items with title/link/pubDate/description', () => {
    const items = parseFeed(RSS_SAMPLE);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'First Post',
      url: 'https://example.com/a',
    });
    expect(items[0]!.publishedAt).toBeGreaterThan(1_700_000_000);
    expect(items[0]!.snippet).toContain('description');
  });

  it('decodes CDATA and XML entities in titles', () => {
    const items = parseFeed(RSS_SAMPLE);
    expect(items[1]!.title).toBe('Second & Post');
  });

  it('parses Atom entries including rel=alternate and <updated> fallback', () => {
    const items = parseFeed(ATOM_SAMPLE);
    expect(items).toHaveLength(2);
    expect(items.map(i => i.url)).toEqual(['https://example.org/1', 'https://example.org/2']);
    expect(items[1]!.publishedAt).toBeGreaterThan(0);
  });

  it('returns empty array for non-feed XML', () => {
    expect(parseFeed('<html><body>not a feed</body></html>')).toEqual([]);
  });

  it('strips HTML from snippet and truncates long content', () => {
    const xml = `<rss><channel><item><title>T</title><link>https://x/1</link><description><![CDATA[<p>${'abc '.repeat(300)}</p>]]></description></item></channel></rss>`;
    const items = parseFeed(xml);
    expect(items[0]!.snippet).not.toContain('<p>');
    expect(items[0]!.snippet!.length).toBeLessThanOrEqual(500);
  });
});

describe('persistItem + isNewUrl + latestItems', () => {
  const baseItem: RawItem = {
    title: 'Post', url: 'https://ex.com/1', publishedAt: 100, snippet: 's',
  };

  it('persist then isNewUrl returns false for same url', () => {
    const db = bootDb();
    expect(isNewUrl(db, baseItem.url)).toBe(true);
    persistItem(db, { item: baseItem, source: 'aqr', tier: 1, notebook: null, fetchedAt: 1000 });
    expect(isNewUrl(db, baseItem.url)).toBe(false);
  });

  it('persistItem is a no-op on duplicate url (UNIQUE violation caught)', () => {
    const db = bootDb();
    const args = { item: baseItem, source: 'aqr', tier: 1, notebook: null, fetchedAt: 1000 };
    persistItem(db, args);
    persistItem(db, args);
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM research_items`).get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it('latestItems returns newest first with source/title/fetchedAt', () => {
    const db = bootDb();
    persistItem(db, { item: { ...baseItem, url: 'https://ex.com/a' }, source: 'aqr', tier: 1, notebook: null, fetchedAt: 1000 });
    persistItem(db, { item: { ...baseItem, url: 'https://ex.com/b' }, source: 'domer', tier: 1, notebook: null, fetchedAt: 2000 });
    const items = latestItems(db, 10);
    expect(items).toHaveLength(2);
    expect(items[0]!.source).toBe('domer');
    expect(items[1]!.source).toBe('aqr');
  });

  it('respects the limit parameter', () => {
    const db = bootDb();
    for (let i = 0; i < 5; i++) {
      persistItem(db, { item: { ...baseItem, url: `https://ex.com/${i}` }, source: 's', tier: 1, notebook: null, fetchedAt: 1000 + i });
    }
    expect(latestItems(db, 3)).toHaveLength(3);
  });
});

describe('validateFeedConfig', () => {
  it('accepts a minimal valid config', () => {
    const cfg: FeedConfig[] = [{ name: 'AQR', url: 'https://aqr.com/feed', tier: 1 }];
    expect(() => validateFeedConfig(cfg)).not.toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => validateFeedConfig([{ name: 'AQR' }] as unknown as FeedConfig[])).toThrow();
    expect(() => validateFeedConfig([{ url: 'https://x' }] as unknown as FeedConfig[])).toThrow();
  });

  it('rejects malformed urls', () => {
    expect(() => validateFeedConfig([{ name: 'X', url: 'not a url', tier: 1 }])).toThrow();
  });

  it('rejects out-of-range tier values', () => {
    expect(() => validateFeedConfig([{ name: 'X', url: 'https://x', tier: 0 }])).toThrow();
    expect(() => validateFeedConfig([{ name: 'X', url: 'https://x', tier: 4 }])).toThrow();
  });
});

describe('composeNoteContent', () => {
  it('includes source, title, url, published date, and snippet', () => {
    const out = composeNoteContent({
      source: 'AQR', title: 'Value Factor', url: 'https://aqr.com/x',
      publishedAt: 1_700_000_000, snippet: 'A summary.',
    });
    expect(out).toContain('AQR');
    expect(out).toContain('Value Factor');
    expect(out).toContain('https://aqr.com/x');
    expect(out).toContain('A summary.');
  });

  it('omits date line when publishedAt is null', () => {
    const out = composeNoteContent({
      source: 'X', title: 'T', url: 'https://x', publishedAt: null, snippet: 's',
    });
    expect(out).not.toMatch(/published.*\d{4}/i);
  });
});
