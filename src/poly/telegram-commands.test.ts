import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { renderSignals, renderPositions, renderPnl } from './telegram-commands.js';

function bootDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      market_slug TEXT, outcome_token_id TEXT, outcome_label TEXT,
      market_price REAL, estimated_prob REAL, edge_pct REAL, confidence TEXT,
      reasoning TEXT, contrarian TEXT, approved INTEGER NOT NULL,
      rejection_reasons TEXT, paper_trade_id INTEGER);
    CREATE TABLE poly_paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      market_slug TEXT, outcome_token_id TEXT, outcome_label TEXT, side TEXT,
      entry_price REAL, size_usd REAL, shares REAL, kelly_fraction REAL,
      strategy TEXT, status TEXT, resolved_at INTEGER, realized_pnl REAL,
      voided_reason TEXT);
    CREATE TABLE poly_positions (
      paper_trade_id INTEGER PRIMARY KEY, market_slug TEXT,
      current_price REAL, unrealized_pnl REAL, updated_at INTEGER);
  `);
  return db;
}

const now = Math.floor(Date.now() / 1000);

function insertSignal(db: Database.Database, o: {
  slug: string; approved: 0 | 1; edgePct?: number; rejection?: unknown; tradeId?: number | null;
}): void {
  db.prepare(`
    INSERT INTO poly_signals (created_at, market_slug, outcome_token_id, outcome_label,
      market_price, estimated_prob, edge_pct, confidence, reasoning, approved,
      rejection_reasons, paper_trade_id)
    VALUES (?, ?, 'tok', 'Yes', 0.4, 0.55, ?, 'high', 'r', ?, ?, ?)
  `).run(
    now, o.slug, o.edgePct ?? 15, o.approved,
    o.rejection ? JSON.stringify(o.rejection) : null,
    o.tradeId ?? null,
  );
}

function insertOpenTrade(db: Database.Database, id: number, o: {
  slug: string; shares: number; size: number; entry: number; current?: number; unrealized?: number;
}): void {
  db.prepare(`
    INSERT INTO poly_paper_trades (id, created_at, market_slug, outcome_token_id,
      outcome_label, side, entry_price, size_usd, shares, kelly_fraction, strategy, status)
    VALUES (?, ?, ?, 'tok', 'Yes', 'BUY', ?, ?, ?, 0.25, 'ai-probability', 'open')
  `).run(id, now, o.slug, o.entry, o.size, o.shares);
  db.prepare(`
    INSERT INTO poly_positions (paper_trade_id, market_slug, current_price, unrealized_pnl, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, o.slug, o.current ?? o.entry, o.unrealized ?? 0, now);
}

function insertResolved(db: Database.Database, o: {
  slug: string; status: 'won' | 'lost' | 'voided'; realized: number;
}): void {
  db.prepare(`
    INSERT INTO poly_paper_trades (created_at, market_slug, outcome_token_id, outcome_label,
      side, entry_price, size_usd, shares, kelly_fraction, strategy, status,
      resolved_at, realized_pnl)
    VALUES (?, ?, 'tok', 'Yes', 'BUY', 0.4, 50, 125, 0.25, 'ai-probability', ?, ?, ?)
  `).run(now, o.slug, o.status, now, o.realized);
}

describe('renderSignals', () => {
  let db: Database.Database;
  beforeEach(() => { db = bootDb(); });

  it('shows empty state cleanly', () => {
    expect(renderSignals(db)).toMatch(/No signals/);
  });

  it('renders approved signals with their trade id', () => {
    insertSignal(db, { slug: 'market-a', approved: 1, tradeId: 7 });
    const txt = renderSignals(db);
    expect(txt).toContain('market-a');
    expect(txt).toContain('trade #7');
    expect(txt).toMatch(/✅/);
  });

  it('renders rejected signals with the first gate reason', () => {
    insertSignal(db, {
      slug: 'market-b', approved: 0,
      rejection: [{ gate: 'signal_quality', reason: 'edge_pct 2 < min 8' }, { gate: 'other', reason: 'x' }],
    });
    const txt = renderSignals(db);
    expect(txt).toContain('market-b');
    expect(txt).toContain('signal_quality');
    expect(txt).toContain('edge_pct 2 < min 8');
    expect(txt).toMatch(/⚠️/);
  });

  it('orders by id desc and caps at 10', () => {
    for (let i = 1; i <= 15; i++) insertSignal(db, { slug: `m${i}`, approved: 1, tradeId: i });
    const txt = renderSignals(db);
    expect(txt).toContain('m15');
    expect(txt).not.toContain('m5');
  });
});

describe('renderPositions', () => {
  let db: Database.Database;
  beforeEach(() => { db = bootDb(); });

  it('shows empty state when nothing is open', () => {
    expect(renderPositions(db)).toBe('No open positions.');
  });

  it('lists open positions with unrealized totals', () => {
    insertOpenTrade(db, 1, { slug: 'mkt-1', shares: 100, size: 40, entry: 0.4, current: 0.45, unrealized: 5 });
    insertOpenTrade(db, 2, { slug: 'mkt-2', shares: 50, size: 25, entry: 0.5, current: 0.48, unrealized: -1 });
    const txt = renderPositions(db);
    expect(txt).toContain('#1');
    expect(txt).toContain('#2');
    expect(txt).toContain('Deployed: $65');
    expect(txt).toContain('Unrealized: +$4.00');
  });

  it('falls back to entry price when no position row exists', () => {
    db.prepare(`
      INSERT INTO poly_paper_trades (created_at, market_slug, outcome_token_id, outcome_label,
        side, entry_price, size_usd, shares, kelly_fraction, strategy, status)
      VALUES (?, 'orphan', 'tok', 'Yes', 'BUY', 0.4, 20, 50, 0.25, 'ai-probability', 'open')
    `).run(now);
    const txt = renderPositions(db);
    expect(txt).toContain('orphan');
    expect(txt).toContain('u/r +$0.00');
  });
});

describe('renderPnl', () => {
  let db: Database.Database;
  beforeEach(() => { db = bootDb(); });

  it('shows zero-state when nothing has happened', () => {
    const txt = renderPnl(db);
    expect(txt).toContain('Paper P&L');
    expect(txt).toContain('Lifetime realized: +$0.00');
    expect(txt).toContain('Open: 0');
  });

  it('aggregates realized pnl with win rate across won/lost/voided', () => {
    insertResolved(db, { slug: 'a', status: 'won', realized: 30 });
    insertResolved(db, { slug: 'b', status: 'won', realized: 20 });
    insertResolved(db, { slug: 'c', status: 'lost', realized: -15 });
    insertResolved(db, { slug: 'd', status: 'voided', realized: 0 });
    const txt = renderPnl(db);
    expect(txt).toContain('Lifetime realized: +$35.00');
    expect(txt).toContain('won 2');
    expect(txt).toContain('lost 1');
    expect(txt).toContain('void 1');
    expect(txt).toContain('win rate 67%');
  });

  it('includes deployed capital and unrealized total from open positions', () => {
    insertOpenTrade(db, 1, { slug: 'mkt-1', shares: 100, size: 40, entry: 0.4, unrealized: 8 });
    insertOpenTrade(db, 2, { slug: 'mkt-2', shares: 50, size: 25, entry: 0.5, unrealized: -3 });
    const txt = renderPnl(db);
    expect(txt).toContain('Open: 2');
    expect(txt).toContain('Deployed: $65');
    expect(txt).toContain('Unrealized: +$5.00');
  });
});
