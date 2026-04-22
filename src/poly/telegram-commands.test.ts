import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { renderSignals, renderPositions, renderPnl, renderCalibration, setHalt, clearHalt } from './telegram-commands.js';

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

describe('renderCalibration', () => {
  function bootCalDb(): Database.Database {
    const d = new Database(':memory:');
    d.exec(`CREATE TABLE poly_calibration_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      window_start INTEGER NOT NULL, window_end INTEGER NOT NULL,
      n_samples INTEGER NOT NULL, brier_score REAL, log_loss REAL, win_rate REAL,
      curve_json TEXT NOT NULL, by_regime_json TEXT);`);
    return d;
  }

  it('shows empty-state when no snapshot exists yet', () => {
    expect(renderCalibration(bootCalDb())).toMatch(/no calibration snapshot/i);
  });

  it('renders Brier, log loss, win rate and populated curve buckets', () => {
    const db = bootCalDb();
    db.prepare(`INSERT INTO poly_calibration_snapshots (created_at,window_start,window_end,n_samples,brier_score,log_loss,win_rate,curve_json) VALUES (?,?,?,?,?,?,?,?)`)
      .run(now, now - 30 * 86400, now, 12, 0.18, 0.41, 7/12,
        JSON.stringify([
          { bucket: 0, predLow: 0,   predHigh: 0.1, count: 0, actualWinRate: null },
          { bucket: 5, predLow: 0.5, predHigh: 0.6, count: 4, actualWinRate: 0.5 },
          { bucket: 8, predLow: 0.8, predHigh: 0.9, count: 8, actualWinRate: 0.875 },
        ]));
    const txt = renderCalibration(db);
    expect(txt).toContain('Brier');
    expect(txt).toContain('0.180');
    expect(txt).toContain('Log loss');
    expect(txt).toContain('0.410');
    expect(txt).toContain('n=12');
    expect(txt).toContain('50-60%');
    expect(txt).toContain('80-90%');
    expect(txt).not.toContain('0-10%');
  });
});

function freshHaltDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  return db;
}

function readHaltValue(db: Database.Database): string | null {
  const row = db.prepare(`SELECT value FROM poly_kv WHERE key='poly.halt'`).get() as { value: string } | undefined;
  return row?.value ?? null;
}

describe('setHalt', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshHaltDb(); });

  it('writes poly.halt=1 to poly_kv from a fresh state', () => {
    const reply = setHalt(db);
    expect(readHaltValue(db)).toBe('1');
    expect(reply).toMatch(/halt/i);
    expect(reply).toMatch(/set|engaged|YES/i);
    expect(reply).toMatch(/next.*tick/i);
  });

  it('is idempotent — second call does not throw and value stays "1"', () => {
    setHalt(db);
    expect(() => setHalt(db)).not.toThrow();
    expect(readHaltValue(db)).toBe('1');
  });

  it('overrides a prior value of "0"', () => {
    db.prepare(`INSERT INTO poly_kv(key,value) VALUES('poly.halt','0')`).run();
    setHalt(db);
    expect(readHaltValue(db)).toBe('1');
  });

  it('reply text mentions that open positions are NOT closed', () => {
    const reply = setHalt(db);
    expect(reply.toLowerCase()).toMatch(/open positions.*remain|positions.*open|not.*close/i);
  });
});

describe('clearHalt', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshHaltDb(); });

  it('writes poly.halt=0 from halted state', () => {
    setHalt(db);
    const reply = clearHalt(db);
    expect(readHaltValue(db)).toBe('0');
    expect(reply).toMatch(/resume|cleared|no/i);
  });

  it('is idempotent — second call does not throw and value stays "0"', () => {
    setHalt(db);
    clearHalt(db);
    expect(() => clearHalt(db)).not.toThrow();
    expect(readHaltValue(db)).toBe('0');
  });

  it('clears from no-row state by inserting "0"', () => {
    expect(readHaltValue(db)).toBeNull();
    clearHalt(db);
    expect(readHaltValue(db)).toBe('0');
  });

  it('reply text mentions next-tick resume semantics', () => {
    setHalt(db);
    const reply = clearHalt(db);
    expect(reply).toMatch(/next.*tick|resume.*evaluat/i);
  });
});
