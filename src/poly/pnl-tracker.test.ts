import { describe, it, expect, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import Database from 'better-sqlite3';
import { PnlTracker, classifyResolution, getDailyRealizedPnl, type MarketFetcher } from './pnl-tracker.js';
import type { Market } from './types.js';
import { POLY_TIMEZONE } from '../config.js';

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

function seedOpenTrade(
  db: Database.Database,
  over: Partial<{ slug: string; tokenId: string; entry: number; shares: number }> = {},
): number {
  const slug = over.slug ?? 'slug-a';
  const tokenId = over.tokenId ?? 'tok-yes';
  const entry = over.entry ?? 0.4;
  const shares = over.shares ?? 100;
  const info = db.prepare(`
    INSERT INTO poly_paper_trades (created_at, market_slug, outcome_token_id, outcome_label,
      side, entry_price, size_usd, shares, kelly_fraction, strategy, status)
    VALUES (0, ?, ?, 'Yes', 'BUY', ?, ?, ?, 0.25, 'ai', 'open')
  `).run(slug, tokenId, entry, shares * entry, shares);
  const id = Number(info.lastInsertRowid);
  db.prepare(`INSERT INTO poly_positions (paper_trade_id, market_slug, current_price, unrealized_pnl, updated_at)
    VALUES (?, ?, ?, 0, 0)`).run(id, slug, entry);
  return id;
}

function mkMarket(
  over: Partial<{ closed: boolean; yesPrice: number; noPrice: number }> = {},
): Market {
  return {
    slug: 'slug-a',
    conditionId: '0x1',
    question: 'Q?',
    outcomes: [
      { label: 'Yes', tokenId: 'tok-yes', price: over.yesPrice ?? 0.5 },
      { label: 'No', tokenId: 'tok-no', price: over.noPrice ?? 0.5 },
    ],
    volume24h: 0,
    liquidity: 0,
    endDate: Math.floor(Date.now() / 1000) + 3600,
    closed: over.closed ?? false,
  };
}

describe('classifyResolution', () => {
  it('open when market not closed', () => {
    expect(classifyResolution(mkMarket(), 'tok-yes').status).toBe('open');
  });
  it('voided/delisted when market is null', () => {
    const r = classifyResolution(null, 'tok-yes');
    expect(r.status).toBe('voided');
    expect(r.voidedReason).toBe('delisted');
  });
  it('voided/unresolved when closed but no 1.0 price', () => {
    const r = classifyResolution(mkMarket({ closed: true, yesPrice: 0.5, noPrice: 0.5 }), 'tok-yes');
    expect(r.status).toBe('voided');
    expect(r.voidedReason).toBe('unresolved');
  });
  it('won when held token matches winning outcome', () => {
    const r = classifyResolution(mkMarket({ closed: true, yesPrice: 1, noPrice: 0 }), 'tok-yes');
    expect(r.status).toBe('won');
  });
  it('lost when held token does not match winning outcome', () => {
    const r = classifyResolution(mkMarket({ closed: true, yesPrice: 0, noPrice: 1 }), 'tok-yes');
    expect(r.status).toBe('lost');
  });
});

describe('pnl-tracker', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('won: realized_pnl = shares * (1 - entry_price) and status=won', async () => {
    const id = seedOpenTrade(db, { entry: 0.4, shares: 100 });
    const fetcher: MarketFetcher = async () => mkMarket({ closed: true, yesPrice: 1, noPrice: 0 });
    const t = new PnlTracker(db, fetcher, async () => 1);
    await t.runOnce();
    const row = db.prepare(`SELECT status, realized_pnl FROM poly_paper_trades WHERE id=?`).get(id) as { status: string; realized_pnl: number };
    expect(row.status).toBe('won');
    expect(row.realized_pnl).toBeCloseTo(100 * (1 - 0.4), 6);
  });

  it('lost: realized_pnl = -shares * entry_price and status=lost', async () => {
    const id = seedOpenTrade(db, { entry: 0.4, shares: 100 });
    const fetcher: MarketFetcher = async () => mkMarket({ closed: true, yesPrice: 0, noPrice: 1 });
    const t = new PnlTracker(db, fetcher, async () => 0);
    await t.runOnce();
    const row = db.prepare(`SELECT status, realized_pnl FROM poly_paper_trades WHERE id=?`).get(id) as { status: string; realized_pnl: number };
    expect(row.status).toBe('lost');
    expect(row.realized_pnl).toBeCloseTo(-100 * 0.4, 6);
  });

  it('voided (market delisted): realized_pnl=0 and status=voided with voided_reason set', async () => {
    const id = seedOpenTrade(db);
    const fetcher: MarketFetcher = async () => null;
    const t = new PnlTracker(db, fetcher, async () => 0);
    await t.runOnce();
    const row = db.prepare(`SELECT status, realized_pnl, voided_reason FROM poly_paper_trades WHERE id=?`).get(id) as { status: string; realized_pnl: number; voided_reason: string };
    expect(row.status).toBe('voided');
    expect(row.realized_pnl).toBe(0);
    expect(row.voided_reason).toBe('delisted');
  });

  it('updates poly_positions.unrealized_pnl on each tick for open trades', async () => {
    const id = seedOpenTrade(db, { entry: 0.4, shares: 100 });
    const fetcher: MarketFetcher = async () => mkMarket({ closed: false });
    const t = new PnlTracker(db, fetcher, async () => 0.5);
    await t.runOnce();
    const pos = db.prepare(`SELECT current_price, unrealized_pnl FROM poly_positions WHERE paper_trade_id=?`).get(id) as { current_price: number; unrealized_pnl: number };
    expect(pos.current_price).toBe(0.5);
    expect(pos.unrealized_pnl).toBeCloseTo(100 * (0.5 - 0.4), 6);
  });

  it('removes poly_positions row on resolution', async () => {
    const id = seedOpenTrade(db);
    const fetcher: MarketFetcher = async () => mkMarket({ closed: true, yesPrice: 1, noPrice: 0 });
    const t = new PnlTracker(db, fetcher, async () => 1);
    await t.runOnce();
    const pos = db.prepare(`SELECT COUNT(*) as n FROM poly_positions WHERE paper_trade_id=?`).get(id) as { n: number };
    expect(pos.n).toBe(0);
  });

  it('emits position_resolved event exactly once per trade', async () => {
    const id = seedOpenTrade(db);
    const fetcher: MarketFetcher = async () => mkMarket({ closed: true, yesPrice: 1, noPrice: 0 });
    const t = new PnlTracker(db, fetcher, async () => 1);
    const events: Array<{ tradeId: number; status: string }> = [];
    t.on('position_resolved', e => events.push(e));
    await t.runOnce();
    // Second pass: trade is now status=won, the query filters status='open' only, so no re-emit.
    await t.runOnce();
    expect(events).toHaveLength(1);
    expect(events[0]!.tradeId).toBe(id);
  });

  it('computes dailyRealizedPnl using POLY_TIMEZONE day boundary (not UTC)', () => {
    // Resolve a trade at 2026-04-12T03:00Z. In America/New_York that is
    // 2026-04-11 at 23:00 -> counts toward Apr 11's P&L, NOT Apr 12's.
    const resolvedAt = DateTime.fromISO('2026-04-12T03:00:00Z', { zone: 'utc' }).toSeconds();
    db.prepare(`INSERT INTO poly_paper_trades
      (created_at, market_slug, outcome_token_id, outcome_label, side,
       entry_price, size_usd, shares, kelly_fraction, strategy, status,
       resolved_at, realized_pnl)
      VALUES (0, 's', 't', 'Yes', 'BUY', 0.4, 40, 100, 0.25, 'ai', 'won', ?, 60)`
    ).run(resolvedAt);

    // Case A: query "now" = Apr 12 evening in NY. Day boundary Apr 12 00:00 NY
    // is ~04:00 Apr 12 UTC, which is AFTER resolvedAt (03:00 Apr 12 UTC).
    // So the Apr-11 trade should NOT be included in Apr 12's daily sum.
    const nowApr12Ny = DateTime.fromISO('2026-04-12T18:00:00', { zone: POLY_TIMEZONE }).toMillis();
    const sumApr12 = getDailyRealizedPnl(db, nowApr12Ny);
    expect(sumApr12).toBe(0);

    // Case B: query "now" = Apr 11 evening in NY. Day boundary is Apr 11 00:00 NY
    // = ~04:00 Apr 11 UTC, which is BEFORE resolvedAt. So it IS included.
    const nowApr11Ny = DateTime.fromISO('2026-04-11T23:30:00', { zone: POLY_TIMEZONE }).toMillis();
    const sumApr11 = getDailyRealizedPnl(db, nowApr11Ny);
    expect(sumApr11).toBe(60);
  });
});
