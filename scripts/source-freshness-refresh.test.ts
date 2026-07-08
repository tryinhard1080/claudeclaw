import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { refreshNewsSync } from './source-freshness-refresh.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE news_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fetched_at    INTEGER NOT NULL,
      prompt_hash   TEXT NOT NULL DEFAULT 'h',
      summary       TEXT NOT NULL,
      raw_json      TEXT,
      model         TEXT,
      status        TEXT NOT NULL DEFAULT 'ok'
    );
  `);
  return db;
}

function freshnessRow(db: Database.Database): {
  source_name: string;
  last_fetch_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
} {
  return db.prepare(`
    SELECT source_name, last_fetch_at, last_success_at, last_error
      FROM source_freshness
     WHERE source_name = 'news-sync'
  `).get() as {
    source_name: string;
    last_fetch_at: number | null;
    last_success_at: number | null;
    last_error: string | null;
  };
}

describe('refreshNewsSync', () => {
  it('marks a usable ok news row fresh', () => {
    const db = freshDb();
    db.prepare(`
      INSERT INTO news_items (fetched_at, summary, model, status)
      VALUES (?, ?, ?, ?)
    `).run(1_000, 'RSS fallback latest available headlines:\n- SPY rises after Fed headline', 'rss-fallback', 'ok');

    refreshNewsSync(db, 2_000);

    expect(freshnessRow(db)).toMatchObject({
      source_name: 'news-sync',
      last_fetch_at: 1_000,
      last_success_at: 1_000,
      last_error: null,
    });
  });

  it('does not mark a tool-error summary fresh even when status is ok', () => {
    const db = freshDb();
    db.prepare(`
      INSERT INTO news_items (fetched_at, summary, model, status)
      VALUES (?, ?, ?, ?)
    `).run(
      1_000,
      "Error (ResponseParsingError): Failed to parse API response: Missing 'text' field in data",
      'sonar',
      'ok',
    );

    refreshNewsSync(db, 2_000);

    expect(freshnessRow(db)).toMatchObject({
      source_name: 'news-sync',
      last_fetch_at: 1_000,
      last_success_at: null,
      last_error: 'latest news row unusable=tool-error',
    });
  });

  it('preserves previous success when a later ok row contains unusable text', () => {
    const db = freshDb();
    db.prepare(`
      INSERT INTO news_items (fetched_at, summary, model, status)
      VALUES (?, ?, ?, ?)
    `).run(1_000, '- Fed headline', 'sonar', 'ok');
    refreshNewsSync(db, 1_100);

    db.prepare(`
      INSERT INTO news_items (fetched_at, summary, model, status)
      VALUES (?, ?, ?, ?)
    `).run(2_000, 'Failed to parse API response', 'sonar', 'ok');
    refreshNewsSync(db, 2_100);

    expect(freshnessRow(db)).toMatchObject({
      source_name: 'news-sync',
      last_fetch_at: 2_000,
      last_success_at: 1_000,
      last_error: 'latest news row unusable=tool-error',
    });
  });

  it('does not mark a live-tool-access refusal fresh even when status is ok', () => {
    const db = freshDb();
    db.prepare(`
      INSERT INTO news_items (fetched_at, summary, model, status)
      VALUES (?, ?, ?, ?)
    `).run(
      1_000,
      "I can help, but I don\u2019t currently have live tool access to pull the very latest two-hour headlines.",
      'sonar',
      'ok',
    );

    refreshNewsSync(db, 2_000);

    expect(freshnessRow(db)).toMatchObject({
      source_name: 'news-sync',
      last_fetch_at: 1_000,
      last_success_at: null,
      last_error: 'latest news row unusable=refusal',
    });
  });
});
