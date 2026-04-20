import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  upsertMarkets,
  capturePrices,
  pruneOldPrices,
  scanWrite,
} from './market-scanner.js';
import { getPriceApproxHoursAgo } from './price-history.js';
import type { Market } from './types.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_markets (
      slug TEXT PRIMARY KEY,
      condition_id TEXT NOT NULL,
      question TEXT NOT NULL,
      category TEXT,
      outcomes_json TEXT NOT NULL,
      volume_24h REAL NOT NULL DEFAULT 0,
      liquidity REAL NOT NULL DEFAULT 0,
      end_date INTEGER NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0,
      resolution TEXT,
      last_scan_at INTEGER NOT NULL
    );
    CREATE TABLE poly_price_history (
      token_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      price REAL NOT NULL,
      PRIMARY KEY (token_id, captured_at)
    );
    CREATE INDEX idx_poly_price_history_captured
      ON poly_price_history(captured_at);
  `);
  return db;
}

function mkMarket(overrides: Partial<Market> = {}): Market {
  return {
    slug: 'test-market',
    conditionId: '0xcond',
    question: 'Will X happen?',
    category: 'Crypto',
    outcomes: [
      { label: 'Yes', tokenId: 'tok-yes', price: 0.6 },
      { label: 'No', tokenId: 'tok-no', price: 0.4 },
    ],
    volume24h: 12345,
    liquidity: 67890,
    endDate: Math.floor(Date.now() / 1000) + 86400,
    closed: false,
    ...overrides,
  };
}

describe('market-scanner persistence', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('upserts markets and writes price history', () => {
    const m1 = mkMarket({ slug: 'm-1' });
    const m2 = mkMarket({
      slug: 'm-2',
      outcomes: [
        { label: 'Yes', tokenId: 'tok-2-yes', price: 0.25 },
        { label: 'No', tokenId: 'tok-2-no', price: 0.75 },
      ],
    });

    upsertMarkets(db, [m1, m2]);
    capturePrices(db, [m1, m2]);

    const mktRows = db.prepare(`SELECT slug, volume_24h, last_scan_at FROM poly_markets ORDER BY slug`).all() as Array<{ slug: string; volume_24h: number; last_scan_at: number }>;
    expect(mktRows.length).toBe(2);
    expect(mktRows[0]!.slug).toBe('m-1');
    expect(mktRows[1]!.slug).toBe('m-2');
    const firstScanAt = mktRows[0]!.last_scan_at;

    const priceRows = db.prepare(`SELECT token_id, price FROM poly_price_history ORDER BY token_id`).all() as Array<{ token_id: string; price: number }>;
    expect(priceRows.length).toBe(4);

    // Now update m1 with new prices/volume and re-upsert; should update in place.
    const waitUntilNextSecond = () => {
      const start = Math.floor(Date.now() / 1000);
      while (Math.floor(Date.now() / 1000) === start) {
        // spin; typically < 1s
      }
    };
    waitUntilNextSecond();

    const m1Updated = mkMarket({
      slug: 'm-1',
      volume24h: 99999,
      outcomes: [
        { label: 'Yes', tokenId: 'tok-yes', price: 0.8 },
        { label: 'No', tokenId: 'tok-no', price: 0.2 },
      ],
    });
    upsertMarkets(db, [m1Updated]);

    const afterRows = db.prepare(`SELECT slug, volume_24h, last_scan_at FROM poly_markets WHERE slug='m-1'`).all() as Array<{ slug: string; volume_24h: number; last_scan_at: number }>;
    expect(afterRows.length).toBe(1);
    expect(afterRows[0]!.volume_24h).toBe(99999);
    expect(afterRows[0]!.last_scan_at).toBeGreaterThan(firstScanAt);

    // Total row count still 2 (no duplicates).
    const countAll = db.prepare(`SELECT COUNT(*) AS c FROM poly_markets`).get() as { c: number };
    expect(countAll.c).toBe(2);
  });

  it('pruneOldPrices(db, 24) removes rows older than 24h', () => {
    const now = Math.floor(Date.now() / 1000);
    const insert = db.prepare(`INSERT INTO poly_price_history (token_id, captured_at, price) VALUES (?, ?, ?)`);
    insert.run('tok-a', now - 1 * 3600, 0.5);       // 1h ago   → keep
    insert.run('tok-a', now - 23 * 3600, 0.51);     // 23h ago  → keep
    insert.run('tok-a', now - 25 * 3600, 0.52);     // 25h ago  → prune
    insert.run('tok-b', now - 100 * 3600, 0.6);     // 100h ago → prune
    insert.run('tok-b', now - 10 * 3600, 0.61);     // 10h ago  → keep

    pruneOldPrices(db, 24);

    const remaining = db.prepare(`SELECT token_id, captured_at FROM poly_price_history ORDER BY captured_at`).all() as Array<{ token_id: string; captured_at: number }>;
    expect(remaining.length).toBe(3);
    for (const r of remaining) {
      expect(now - r.captured_at).toBeLessThan(24 * 3600);
    }
  });

  it('pruneOldPrices(db, 48) respects a custom retention window', () => {
    const now = Math.floor(Date.now() / 1000);
    const insert = db.prepare(`INSERT INTO poly_price_history (token_id, captured_at, price) VALUES (?, ?, ?)`);
    insert.run('tok-a', now - 30 * 3600, 0.5);   // 30h  → keep (under 48h)
    insert.run('tok-a', now - 49 * 3600, 0.51);  // 49h  → prune
    insert.run('tok-a', now - 100 * 3600, 0.52); // 100h → prune

    pruneOldPrices(db, 48);

    const remaining = db.prepare(`SELECT captured_at FROM poly_price_history`).all() as Array<{ captured_at: number }>;
    expect(remaining.length).toBe(1);
  });

  it('getPriceApproxHoursAgo finds nearest match within tolerance', () => {
    const now = Math.floor(Date.now() / 1000);
    const insert = db.prepare(`INSERT INTO poly_price_history (token_id, captured_at, price) VALUES (?, ?, ?)`);
    // Target is 24h ago. Put a price at ~24h ago and a couple of decoys.
    insert.run('tok-x', now - 24 * 3600 + 60, 0.42);   // ~24h ago, 1min off
    insert.run('tok-x', now - 24 * 3600 - 1800, 0.40); // ~24h ago, 30min off
    insert.run('tok-x', now - 12 * 3600, 0.99);         // way off
    insert.run('tok-y', now - 24 * 3600, 0.77);         // different token

    const got = getPriceApproxHoursAgo(db, 'tok-x', 24, 1);
    expect(got).toBe(0.42);

    // No data in window for tok-z
    const miss = getPriceApproxHoursAgo(db, 'tok-z', 24, 1);
    expect(miss).toBeNull();

    // tok-x at 48h: nothing in ±1h window
    const miss2 = getPriceApproxHoursAgo(db, 'tok-x', 48, 1);
    expect(miss2).toBeNull();
  });
});

describe('scanWrite (atomic upsert + capture + prune)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('writes markets, captures prices for candidates only, and prunes old rows in one transaction', () => {
    const now = Math.floor(Date.now() / 1000);
    // Seed old price rows we expect to be pruned.
    const insert = db.prepare(`INSERT INTO poly_price_history (token_id, captured_at, price) VALUES (?, ?, ?)`);
    insert.run('stale-token', now - 48 * 3600, 0.3);
    insert.run('fresh-token', now - 1 * 3600, 0.4);

    // 5 markets from "Gamma fetch" but only 2 are "strategy candidates".
    const markets = [1, 2, 3, 4, 5].map(i =>
      mkMarket({
        slug: `m-${i}`,
        conditionId: `0x${i}`,
        outcomes: [
          { label: 'Yes', tokenId: `tok-${i}-yes`, price: 0.5 },
          { label: 'No', tokenId: `tok-${i}-no`, price: 0.5 },
        ],
      }),
    );
    const candidates = [markets[0]!, markets[1]!];

    scanWrite(db, markets, candidates, 24);

    // All 5 markets upserted
    const mktCount = (db.prepare(`SELECT COUNT(*) AS c FROM poly_markets`).get() as { c: number }).c;
    expect(mktCount).toBe(5);

    // Only 2 candidate markets × 2 outcomes = 4 new price rows, plus the seeded fresh-token.
    // Stale-token was pruned.
    const priceRows = db
      .prepare(`SELECT token_id FROM poly_price_history ORDER BY token_id`)
      .all() as Array<{ token_id: string }>;
    const tokenIds = priceRows.map(r => r.token_id);
    expect(tokenIds).toContain('fresh-token');
    expect(tokenIds).not.toContain('stale-token');
    expect(tokenIds).toContain('tok-1-yes');
    expect(tokenIds).toContain('tok-2-yes');
    expect(tokenIds).not.toContain('tok-3-yes'); // not a candidate
    expect(priceRows.length).toBe(5);
  });

  it('rolls back all three operations if any statement fails', () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO poly_price_history (token_id, captured_at, price) VALUES (?, ?, ?)`)
      .run('old-token', now - 48 * 3600, 0.1);

    // Malformed market: missing required field (outcomes_json will fail when the
    // transaction tries to serialize). Use a market that will fail SQL constraints.
    const goodMarket = mkMarket({ slug: 'good' });
    // NOT NULL check on `end_date` — force a failure by passing NaN which SQLite
    // coerces in a way that passes the prepared-statement check. Instead, break
    // by violating the UNIQUE on slug midway through the tx.
    const duplicate = mkMarket({ slug: 'good' });

    // Pre-insert a row that makes the upsert's ON CONFLICT update path succeed
    // (upserts don't fail on conflict). So instead we need a truly failing row.
    // Easiest repro: pass a Market with a null conditionId, which violates NOT NULL.
    const bad = mkMarket({ slug: 'bad', conditionId: null as unknown as string });

    expect(() => scanWrite(db, [goodMarket, bad, duplicate], [goodMarket], 24)).toThrow();

    // Market rollback: no rows in poly_markets
    const mktCount = (db.prepare(`SELECT COUNT(*) AS c FROM poly_markets`).get() as { c: number }).c;
    expect(mktCount).toBe(0);

    // Price rollback: stale row still present (prune did not commit)
    const oldRow = db.prepare(`SELECT 1 FROM poly_price_history WHERE token_id='old-token'`).get();
    expect(oldRow).toBeDefined();
  });
});
