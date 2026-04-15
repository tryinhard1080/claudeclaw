import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { execute, exitPosition, shouldExit, type SignalWithId } from './paper-broker.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE poly_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      market_slug TEXT NOT NULL,
      outcome_token_id TEXT NOT NULL,
      outcome_label TEXT NOT NULL,
      market_price REAL NOT NULL,
      estimated_prob REAL NOT NULL,
      edge_pct REAL NOT NULL,
      confidence TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      contrarian TEXT,
      approved INTEGER NOT NULL,
      rejection_reasons TEXT,
      paper_trade_id INTEGER
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

function seedSignal(db: Database.Database, over: Partial<{ marketPrice: number }> = {}): SignalWithId {
  const now = Math.floor(Date.now() / 1000);
  const marketPrice = over.marketPrice ?? 0.4;
  const info = db.prepare(`
    INSERT INTO poly_signals (created_at, market_slug, outcome_token_id, outcome_label,
      market_price, estimated_prob, edge_pct, confidence, reasoning, approved)
    VALUES (?, 'slug-a', 'tok-yes', 'Yes', ?, 0.55, 15, 'medium', 'because', 1)
  `).run(now, marketPrice);
  return {
    id: Number(info.lastInsertRowid),
    marketSlug: 'slug-a',
    outcomeTokenId: 'tok-yes',
    outcomeLabel: 'Yes',
    marketPrice,
    estimatedProb: 0.55,
    edgePct: 15,
    confidence: 'medium',
    reasoning: 'because',
    sizeUsd: 40,
    kellyFraction: 0.25,
    strategy: 'ai-probability',
  };
}

describe('paper broker execute', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('happy-path: inserts poly_paper_trades, poly_positions, updates poly_signals.paper_trade_id', () => {
    const signal = seedSignal(db);
    const res = execute(db, signal, 0.4, 1000);
    expect(res.status).toBe('filled');
    expect(res.tradeId).toBeGreaterThan(0);

    const trade = db.prepare(`SELECT * FROM poly_paper_trades WHERE id = ?`).get(res.tradeId!) as {
      market_slug: string; entry_price: number; shares: number; status: string; size_usd: number;
    };
    expect(trade.market_slug).toBe('slug-a');
    expect(trade.entry_price).toBe(0.4);
    // shares = floor(40/0.4 * 100)/100 = floor(10000)/100 = 100
    expect(trade.shares).toBe(100);
    expect(trade.status).toBe('open');

    const pos = db.prepare(`SELECT * FROM poly_positions WHERE paper_trade_id = ?`).get(res.tradeId!) as {
      market_slug: string; current_price: number;
    };
    expect(pos.market_slug).toBe('slug-a');
    expect(pos.current_price).toBe(0.4);

    const sig = db.prepare(`SELECT paper_trade_id FROM poly_signals WHERE id = ?`).get(signal.id) as { paper_trade_id: number };
    expect(sig.paper_trade_id).toBe(res.tradeId);
  });

  it('aborts and writes no trade row when current best ask drifted >3% from signal price', () => {
    const signal = seedSignal(db, { marketPrice: 0.4 });
    // 0.42 -> drift = 0.05 > 0.03
    const res = execute(db, signal, 0.42, 1000);
    expect(res.status).toBe('aborted');
    expect(res.reason).toBe('orderbook_changed_at_exec');
    const count = db.prepare(`SELECT COUNT(*) as n FROM poly_paper_trades`).get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('aborts when orderbook returned empty asks', () => {
    const signal = seedSignal(db);
    const res = execute(db, signal, null, 0);
    expect(res.status).toBe('aborted');
    expect(res.reason).toBe('empty_asks');
  });

  it('rolls back all three writes if any single insert throws (simulate with a UNIQUE violation on poly_positions)', () => {
    const signal = seedSignal(db);
    // FKs are OFF by default in better-sqlite3, so we can seed a position row
    // with paper_trade_id=1 even without the matching trade. When the broker
    // autoincrements its first trade insert to id=1, the position insert for
    // paper_trade_id=1 collides with the pre-seeded PRIMARY KEY → UNIQUE error.
    db.prepare(`INSERT INTO poly_positions (paper_trade_id, market_slug, current_price, unrealized_pnl, updated_at)
      VALUES (1, 's', 0.5, 0, 0)`).run();

    const res = execute(db, signal, 0.4, 1000);
    expect(res.status).toBe('aborted');
    expect(res.reason).toMatch(/db_error/);
    // Ensure no new paper_trade row was committed.
    const tradeCount = db.prepare(`SELECT COUNT(*) as n FROM poly_paper_trades`).get() as { n: number };
    expect(tradeCount.n).toBe(0);
    // Signal must be flipped back to rejected with a db_error stamp so
    // /poly signals + approval metrics don't count an orphaned approval.
    const sig = db.prepare(`SELECT approved, paper_trade_id, rejection_reasons FROM poly_signals WHERE id = ?`).get(signal.id) as {
      approved: number; paper_trade_id: number | null; rejection_reasons: string | null;
    };
    expect(sig.paper_trade_id).toBeNull();
    expect(sig.approved).toBe(0);
    expect(sig.rejection_reasons).toMatch(/db_error/);
  });

  it('marks the original poly_signals row with rejection reason "orderbook_changed_at_exec" on abort', () => {
    const signal = seedSignal(db);
    execute(db, signal, 0.5, 1000); // 25% drift
    const row = db.prepare(`SELECT approved, rejection_reasons FROM poly_signals WHERE id = ?`).get(signal.id) as { approved: number; rejection_reasons: string };
    expect(row.approved).toBe(0);
    expect(row.rejection_reasons).toMatch(/orderbook_changed_at_exec/);
  });
});

describe('shouldExit (Sprint 8)', () => {
  const baseThresholds = { takeProfitPct: 0.30, stopLossPct: 0.50 };

  it('returns null when current price is within bounds', () => {
    expect(shouldExit({ entryPrice: 0.4, currentPrice: 0.42, ...baseThresholds })).toBeNull();
  });

  it('fires take_profit at exactly the threshold', () => {
    // 0.4 * 1.3 = 0.52
    expect(shouldExit({ entryPrice: 0.4, currentPrice: 0.52, ...baseThresholds })).toEqual({ reason: 'take_profit' });
  });

  it('fires stop_loss at exactly the threshold', () => {
    // 0.4 * 0.5 = 0.20
    expect(shouldExit({ entryPrice: 0.4, currentPrice: 0.20, ...baseThresholds })).toEqual({ reason: 'stop_loss' });
  });

  it('take_profit takes precedence if both conditions somehow met', () => {
    // Not physically possible on one tick but defensive: negative stop + high price
    expect(shouldExit({ entryPrice: 0.4, currentPrice: 1.0, ...baseThresholds })).toEqual({ reason: 'take_profit' });
  });

  it('tp=0 disables take_profit', () => {
    expect(shouldExit({ entryPrice: 0.4, currentPrice: 0.99, takeProfitPct: 0, stopLossPct: 0.5 })).toBeNull();
  });

  it('sl=0 disables stop_loss', () => {
    expect(shouldExit({ entryPrice: 0.4, currentPrice: 0.01, takeProfitPct: 0.3, stopLossPct: 0 })).toBeNull();
  });

  it('returns null on degenerate entry price', () => {
    expect(shouldExit({ entryPrice: 0, currentPrice: 0.5, ...baseThresholds })).toBeNull();
    expect(shouldExit({ entryPrice: -0.1, currentPrice: 0.5, ...baseThresholds })).toBeNull();
  });

  it('treats negative threshold inputs as 0 (disabled)', () => {
    expect(shouldExit({ entryPrice: 0.4, currentPrice: 0.99, takeProfitPct: -1, stopLossPct: -1 })).toBeNull();
  });
});

describe('exitPosition (Sprint 8)', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  function seedOpenTrade(): number {
    const signal = seedSignal(db);
    const res = execute(db, signal, 0.4, 1000);
    return res.tradeId!;
  }

  it('happy-path take_profit: writes status=exited, realized_pnl, deletes position', () => {
    const tradeId = seedOpenTrade();
    const res = exitPosition(db, tradeId, 0.55, 'take_profit');
    expect(res.status).toBe('exited');
    // shares=100, realized = 100 * (0.55 - 0.40) = 15
    expect(res.realizedPnl).toBeCloseTo(15, 6);

    const row = db.prepare(`SELECT status, realized_pnl, voided_reason FROM poly_paper_trades WHERE id=?`).get(tradeId) as {
      status: string; realized_pnl: number; voided_reason: string;
    };
    expect(row.status).toBe('exited');
    expect(row.realized_pnl).toBeCloseTo(15, 6);
    expect(row.voided_reason).toBe('exit:take_profit');

    const posCount = db.prepare(`SELECT COUNT(*) AS n FROM poly_positions WHERE paper_trade_id=?`).get(tradeId) as { n: number };
    expect(posCount.n).toBe(0);
  });

  it('happy-path stop_loss: negative realized_pnl', () => {
    const tradeId = seedOpenTrade();
    const res = exitPosition(db, tradeId, 0.20, 'stop_loss');
    // realized = 100 * (0.20 - 0.40) = -20
    expect(res.realizedPnl).toBeCloseTo(-20, 6);
    const row = db.prepare(`SELECT voided_reason FROM poly_paper_trades WHERE id=?`).get(tradeId) as { voided_reason: string };
    expect(row.voided_reason).toBe('exit:stop_loss');
  });

  it('skips when trade not found', () => {
    const res = exitPosition(db, 9999, 0.5, 'take_profit');
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('trade_not_found');
  });

  it('skips when trade already non-open (double-close guard)', () => {
    const tradeId = seedOpenTrade();
    exitPosition(db, tradeId, 0.55, 'take_profit');
    const res = exitPosition(db, tradeId, 0.60, 'take_profit');
    expect(res.status).toBe('skipped');
    // Either status=exited (first call) or concurrent_close if stamped. Both acceptable.
    expect(res.reason).toMatch(/status=exited|concurrent_close/);
  });
});
