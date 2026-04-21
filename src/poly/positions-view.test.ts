import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildPositionsLivePayload } from './positions-view.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  db.exec(`
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
    CREATE TABLE poly_positions (
      paper_trade_id INTEGER PRIMARY KEY REFERENCES poly_paper_trades(id),
      market_slug TEXT NOT NULL,
      current_price REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

interface SeedOpts {
  slug?: string;
  tokenId?: string;
  entry?: number;
  shares?: number;
  sizeUsd?: number;
  createdAt?: number;
  status?: string;
  label?: string;
  withPosition?: boolean;
  currentPrice?: number;
  unrealizedPnl?: number;
  updatedAt?: number;
}

function seedTrade(db: Database.Database, over: SeedOpts = {}): number {
  const slug = over.slug ?? 'slug-a';
  const tokenId = over.tokenId ?? 'tok-yes';
  const entry = over.entry ?? 0.4;
  const shares = over.shares ?? 100;
  const sizeUsd = over.sizeUsd ?? shares * entry;
  const createdAt = over.createdAt ?? 1_000_000;
  const status = over.status ?? 'open';
  const label = over.label ?? 'Yes';
  const info = db.prepare(`
    INSERT INTO poly_paper_trades (created_at, market_slug, outcome_token_id, outcome_label,
      side, entry_price, size_usd, shares, kelly_fraction, strategy, status)
    VALUES (?, ?, ?, ?, 'BUY', ?, ?, ?, 0.25, 'ai', ?)
  `).run(createdAt, slug, tokenId, label, entry, sizeUsd, shares, status);
  const id = Number(info.lastInsertRowid);

  if (over.withPosition !== false && status === 'open') {
    db.prepare(`
      INSERT INTO poly_positions (paper_trade_id, market_slug, current_price, unrealized_pnl, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      slug,
      over.currentPrice ?? entry,
      over.unrealizedPnl ?? 0,
      over.updatedAt ?? createdAt,
    );
  }
  return id;
}

describe('buildPositionsLivePayload', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('returns empty payload when no open trades', () => {
    const out = buildPositionsLivePayload(db, 1_100_000);
    expect(out.positions).toEqual([]);
    expect(out.aggregate.open_count).toBe(0);
    expect(out.aggregate.total_open_exposure_usd).toBe(0);
    expect(out.aggregate.total_unrealized_pnl).toBe(0);
    expect(out.aggregate.total_unrealized_pct_of_exposure).toBeNull();
    expect(out.aggregate.last_tick_at).toBeNull();
  });

  it('returns one row with current_price + unrealized when poly_positions populated', () => {
    seedTrade(db, {
      slug: 'will-x-happen', entry: 0.4, shares: 100, sizeUsd: 40,
      currentPrice: 0.5, unrealizedPnl: 10, updatedAt: 1_090_000, createdAt: 1_000_000,
    });
    const out = buildPositionsLivePayload(db, 1_000_000 + 7200); // 2h later
    expect(out.positions).toHaveLength(1);
    const r = out.positions[0]!;
    expect(r.market_slug).toBe('will-x-happen');
    expect(r.entry_price).toBe(0.4);
    expect(r.current_price).toBe(0.5);
    expect(r.unrealized_pnl).toBe(10);
    expect(r.unrealized_pct).toBeCloseTo(10 / 40, 4); // 0.25
    expect(r.age_hours).toBe(2.0);
    expect(r.updated_at).toBe(1_090_000);
  });

  it('LEFT JOIN returns nulls when poly_positions row missing (trade opened pre-tick)', () => {
    seedTrade(db, { entry: 0.3, shares: 50, sizeUsd: 15, withPosition: false });
    const out = buildPositionsLivePayload(db, 1_100_000);
    expect(out.positions).toHaveLength(1);
    const r = out.positions[0]!;
    expect(r.current_price).toBeNull();
    expect(r.unrealized_pnl).toBeNull();
    expect(r.unrealized_pct).toBeNull();
    expect(r.updated_at).toBeNull();
  });

  it('excludes resolved/exited/voided trades', () => {
    seedTrade(db, { slug: 'a', status: 'open', entry: 0.4, shares: 100, sizeUsd: 40,
                    currentPrice: 0.5, unrealizedPnl: 10 });
    seedTrade(db, { slug: 'b', status: 'won', entry: 0.5, shares: 100, sizeUsd: 50,
                    withPosition: false });
    seedTrade(db, { slug: 'c', status: 'lost', entry: 0.6, shares: 100, sizeUsd: 60,
                    withPosition: false });
    seedTrade(db, { slug: 'd', status: 'exited', entry: 0.3, shares: 100, sizeUsd: 30,
                    withPosition: false });
    seedTrade(db, { slug: 'e', status: 'voided', entry: 0.7, shares: 100, sizeUsd: 70,
                    withPosition: false });

    const out = buildPositionsLivePayload(db, 1_100_000);
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0]!.market_slug).toBe('a');
  });

  it('aggregate sums nulls as zero for unrealized', () => {
    seedTrade(db, { slug: 'a', entry: 0.4, shares: 100, sizeUsd: 40,
                    currentPrice: 0.5, unrealizedPnl: 10, updatedAt: 1_090_000 });
    seedTrade(db, { slug: 'b', entry: 0.3, shares: 50, sizeUsd: 15, withPosition: false });

    const out = buildPositionsLivePayload(db, 1_100_000);
    expect(out.aggregate.open_count).toBe(2);
    expect(out.aggregate.total_open_exposure_usd).toBe(55); // 40 + 15
    expect(out.aggregate.total_unrealized_pnl).toBe(10);    // 10 + null-as-0
    expect(out.aggregate.total_unrealized_pct_of_exposure).toBeCloseTo(10 / 55, 4);
    expect(out.aggregate.last_tick_at).toBe(1_090_000);     // max; other is null
  });

  it('aggregate unrealized_pct null when exposure is zero', () => {
    const out = buildPositionsLivePayload(db, 1_100_000);
    expect(out.aggregate.total_unrealized_pct_of_exposure).toBeNull();
  });

  it('age_hours rounded to 1 decimal', () => {
    seedTrade(db, { createdAt: 1_000_000, entry: 0.4, shares: 100, sizeUsd: 40 });
    const out = buildPositionsLivePayload(db, 1_000_000 + 5400); // 1.5h
    expect(out.positions[0]!.age_hours).toBe(1.5);
  });

  it('age_hours rounds 95 min to 1.6h', () => {
    seedTrade(db, { createdAt: 1_000_000, entry: 0.4, shares: 100, sizeUsd: 40 });
    const out = buildPositionsLivePayload(db, 1_000_000 + 95 * 60);
    expect(out.positions[0]!.age_hours).toBe(1.6);
  });

  it('orders positions by trade id DESC (most recent first)', () => {
    const oldId = seedTrade(db, { slug: 'old', entry: 0.4, shares: 100, sizeUsd: 40 });
    const newId = seedTrade(db, { slug: 'new', entry: 0.5, shares: 100, sizeUsd: 50 });
    const out = buildPositionsLivePayload(db, 1_100_000);
    expect(out.positions[0]!.trade_id).toBe(newId);
    expect(out.positions[1]!.trade_id).toBe(oldId);
    expect(newId).toBeGreaterThan(oldId);
  });

  it('caps result at 200 rows defensively', () => {
    for (let i = 0; i < 210; i++) {
      seedTrade(db, { slug: 'slug-' + i, tokenId: 'tok-' + i, entry: 0.4, shares: 1, sizeUsd: 0.4 });
    }
    const out = buildPositionsLivePayload(db, 1_100_000);
    expect(out.positions).toHaveLength(200);
    expect(out.aggregate.open_count).toBe(200);
  });

  it('last_tick_at is the max updated_at across populated positions', () => {
    seedTrade(db, { slug: 'a', entry: 0.4, shares: 100, sizeUsd: 40,
                    currentPrice: 0.5, unrealizedPnl: 10, updatedAt: 1_050_000 });
    seedTrade(db, { slug: 'b', entry: 0.3, shares: 100, sizeUsd: 30,
                    currentPrice: 0.4, unrealizedPnl: 10, updatedAt: 1_090_000 });
    seedTrade(db, { slug: 'c', entry: 0.2, shares: 100, sizeUsd: 20,
                    currentPrice: 0.25, unrealizedPnl: 5, updatedAt: 1_070_000 });

    const out = buildPositionsLivePayload(db, 1_100_000);
    expect(out.aggregate.last_tick_at).toBe(1_090_000);
  });

  it('negative unrealized handled correctly', () => {
    seedTrade(db, {
      slug: 'losing', entry: 0.6, shares: 100, sizeUsd: 60,
      currentPrice: 0.4, unrealizedPnl: -20, updatedAt: 1_090_000,
    });
    const out = buildPositionsLivePayload(db, 1_100_000);
    expect(out.positions[0]!.unrealized_pnl).toBe(-20);
    expect(out.positions[0]!.unrealized_pct).toBeCloseTo(-20 / 60, 4);
    expect(out.aggregate.total_unrealized_pnl).toBe(-20);
    expect(out.aggregate.total_unrealized_pct_of_exposure).toBeCloseTo(-20 / 60, 4);
  });
});
