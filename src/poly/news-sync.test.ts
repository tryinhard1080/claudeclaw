import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  hashPrompt, extractSummary, insertNewsItem, writeHeartbeat, readHeartbeat,
  runNewsSync, NEWS_SYNC_PROMPT,
  type PerplexityResponse, type PerplexityFetcher,
} from './news-sync.js';

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
    CREATE INDEX idx_news_items_fetched ON news_items(fetched_at DESC);
    CREATE INDEX idx_news_items_hash ON news_items(prompt_hash);
    CREATE TABLE poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

function mockResponse(content: string, over: Partial<PerplexityResponse> = {}): PerplexityResponse {
  return {
    id: 'cmpl-mock',
    model: 'sonar',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 50, completion_tokens: 100 },
    ...over,
  };
}

describe('hashPrompt', () => {
  it('returns 16-char hex slice deterministically', () => {
    const h1 = hashPrompt('hello');
    const h2 = hashPrompt('hello');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });
  it('different prompts produce different hashes', () => {
    expect(hashPrompt('a')).not.toBe(hashPrompt('b'));
  });
});

describe('extractSummary', () => {
  it('returns trimmed content from first choice', () => {
    expect(extractSummary(mockResponse('  hello  '))).toBe('hello');
  });
  it('throws on missing content', () => {
    expect(() => extractSummary({ choices: [{ message: {} }] })).toThrow(/missing/);
  });
  it('throws on missing choices array', () => {
    expect(() => extractSummary({})).toThrow(/missing/);
  });
  it('throws on empty content', () => {
    expect(() => extractSummary(mockResponse('   '))).toThrow(/missing/);
  });
});

describe('insertNewsItem', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('inserts a fresh row and reports deduped=false', () => {
    const r = insertNewsItem(db, {
      summary: 's1', promptHash: 'h1', model: 'sonar', rawJson: '{}',
      nowSec: 1_000_000,
    });
    expect(r.deduped).toBe(false);
    expect(r.id).toBeGreaterThan(0);
    const row = db.prepare(`SELECT * FROM news_items WHERE id=?`).get(r.id) as any;
    expect(row.summary).toBe('s1');
    expect(row.fetched_at).toBe(1_000_000);
    expect(row.status).toBe('ok');
  });

  it('dedupes when same prompt_hash + same summary within window', () => {
    insertNewsItem(db, { summary: 's1', promptHash: 'h1', model: null, rawJson: null, nowSec: 1_000_000 });
    const r = insertNewsItem(db, { summary: 's1', promptHash: 'h1', model: null, rawJson: null, nowSec: 1_000_300 });
    expect(r.deduped).toBe(true);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM news_items`).get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('does NOT dedupe when summary differs (real news change)', () => {
    insertNewsItem(db, { summary: 's1', promptHash: 'h1', model: null, rawJson: null, nowSec: 1_000_000 });
    const r = insertNewsItem(db, { summary: 's2', promptHash: 'h1', model: null, rawJson: null, nowSec: 1_000_300 });
    expect(r.deduped).toBe(false);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM news_items`).get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('does NOT dedupe when older than the dedupe window', () => {
    insertNewsItem(db, { summary: 's1', promptHash: 'h1', model: null, rawJson: null, nowSec: 1_000_000 });
    // 90 min = 5400s. 5500s gap exceeds window.
    const r = insertNewsItem(db, { summary: 's1', promptHash: 'h1', model: null, rawJson: null, nowSec: 1_000_000 + 5500 });
    expect(r.deduped).toBe(false);
  });

  it('does NOT dedupe across different prompts even with same summary', () => {
    insertNewsItem(db, { summary: 's1', promptHash: 'hA', model: null, rawJson: null, nowSec: 1_000_000 });
    const r = insertNewsItem(db, { summary: 's1', promptHash: 'hB', model: null, rawJson: null, nowSec: 1_000_300 });
    expect(r.deduped).toBe(false);
  });

  it('preserves raw_json when provided', () => {
    const raw = JSON.stringify({ id: 'x', model: 'sonar' });
    const r = insertNewsItem(db, { summary: 's', promptHash: 'h', model: 'sonar', rawJson: raw, nowSec: 1 });
    const row = db.prepare(`SELECT raw_json FROM news_items WHERE id=?`).get(r.id) as { raw_json: string };
    expect(row.raw_json).toBe(raw);
  });
});

describe('writeHeartbeat / readHeartbeat', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('write then read returns the same value', () => {
    writeHeartbeat(db, 123456);
    expect(readHeartbeat(db)).toBe(123456);
  });
  it('returns null when no heartbeat written', () => {
    expect(readHeartbeat(db)).toBeNull();
  });
  it('overwrites prior heartbeat', () => {
    writeHeartbeat(db, 100);
    writeHeartbeat(db, 200);
    expect(readHeartbeat(db)).toBe(200);
  });
});

describe('runNewsSync', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('returns ok=false when apiKey missing — does NOT call fetcher', async () => {
    let called = false;
    const fetcher: PerplexityFetcher = async () => { called = true; return mockResponse('x'); };
    const r = await runNewsSync(db, { apiKey: '', baseUrl: 'http://x', model: 'sonar', fetcher });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/PPLX_API_KEY/);
    expect(called).toBe(false);
  });

  it('happy path: fetches, stores, writes heartbeat', async () => {
    const fetcher: PerplexityFetcher = async () => mockResponse('- Headline 1\n- Headline 2');
    const r = await runNewsSync(db, {
      apiKey: 'key', baseUrl: 'http://x', model: 'sonar', fetcher, nowSec: 1_500_000,
    });
    expect(r.ok).toBe(true);
    expect(r.inserted!.summary).toContain('Headline 1');
    expect(r.inserted!.deduped).toBe(false);
    expect(readHeartbeat(db)).toBe(1_500_000);
  });

  it('reports fetch failure cleanly', async () => {
    const fetcher: PerplexityFetcher = async () => { throw new Error('rate limit'); };
    const r = await runNewsSync(db, { apiKey: 'k', baseUrl: 'http://x', model: 'sonar', fetcher });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/fetch failed/);
    expect(r.reason).toMatch(/rate limit/);
    expect(readHeartbeat(db)).toBeNull();
  });

  it('reports parse failure cleanly', async () => {
    const fetcher: PerplexityFetcher = async () => ({ choices: [{ message: {} }] });
    const r = await runNewsSync(db, { apiKey: 'k', baseUrl: 'http://x', model: 'sonar', fetcher });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/parse failed/);
    expect(readHeartbeat(db)).toBeNull();
  });

  it('uses default prompt when no prompt override provided', async () => {
    let receivedPrompt = '';
    const fetcher: PerplexityFetcher = async ({ prompt }) => { receivedPrompt = prompt; return mockResponse('x'); };
    await runNewsSync(db, { apiKey: 'k', baseUrl: 'http://x', model: 'sonar', fetcher });
    expect(receivedPrompt).toBe(NEWS_SYNC_PROMPT);
  });

  it('respects custom prompt override', async () => {
    let receivedPrompt = '';
    const fetcher: PerplexityFetcher = async ({ prompt }) => { receivedPrompt = prompt; return mockResponse('x'); };
    await runNewsSync(db, {
      apiKey: 'k', baseUrl: 'http://x', model: 'sonar', fetcher, prompt: 'custom prompt',
    });
    expect(receivedPrompt).toBe('custom prompt');
  });

  it('two consecutive runs with same content dedupe (no heartbeat skew)', async () => {
    const fetcher: PerplexityFetcher = async () => mockResponse('same content');
    const r1 = await runNewsSync(db, { apiKey: 'k', baseUrl: 'http://x', model: 'sonar', fetcher, nowSec: 1_000_000 });
    const r2 = await runNewsSync(db, { apiKey: 'k', baseUrl: 'http://x', model: 'sonar', fetcher, nowSec: 1_000_500 });
    expect(r1.inserted!.deduped).toBe(false);
    expect(r2.inserted!.deduped).toBe(true);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM news_items`).get() as { c: number };
    expect(count.c).toBe(1);
    // Heartbeat advances even on dedupe (so monitoring sees the cron fired).
    expect(readHeartbeat(db)).toBe(1_000_500);
  });
});
