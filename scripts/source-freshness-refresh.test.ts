import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { retireNewsSyncRow } from './source-freshness-refresh.js';
import { recordSourceFreshness } from '../src/readiness/source-freshness.js';

describe('retireNewsSyncRow (Sprint R2 news-sync retirement)', () => {
  it('removes a lingering news-sync freshness row so gates stop warning on it', () => {
    const db = new Database(':memory:');
    recordSourceFreshness(db, {
      sourceName: 'news-sync',
      fetchedAt: 1_000,
      success: true,
      staleAfterSec: 3 * 60 * 60,
      lastError: null,
      usedBySignal: false,
    });
    recordSourceFreshness(db, {
      sourceName: 'polymarket-gamma-scan',
      fetchedAt: 2_000,
      success: true,
      staleAfterSec: 240,
      lastError: null,
      usedBySignal: true,
    });

    retireNewsSyncRow(db);

    const rows = db.prepare('SELECT source_name FROM source_freshness ORDER BY source_name')
      .all() as { source_name: string }[];
    expect(rows.map(r => r.source_name)).toEqual(['polymarket-gamma-scan']);
  });

  it('is a no-op when no news-sync row exists', () => {
    const db = new Database(':memory:');
    recordSourceFreshness(db, {
      sourceName: 'polymarket-gamma-scan',
      fetchedAt: 2_000,
      success: true,
      staleAfterSec: 240,
      lastError: null,
      usedBySignal: true,
    });
    expect(() => retireNewsSyncRow(db)).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) n FROM source_freshness').get()).toMatchObject({ n: 1 });
  });
});
