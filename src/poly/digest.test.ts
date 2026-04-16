import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { shouldRunDigest, composeDigest } from './digest.js';

describe('shouldRunDigest', () => {
  it('returns true when current hour matches and not yet run today', () => {
    expect(
      shouldRunDigest({
        hour: 6,
        timezone: 'UTC',
        now: new Date('2026-04-12T06:30:00Z'),
        lastRunYmd: '2026-04-11',
      }),
    ).toBe(true);
  });

  it('returns false if already run today', () => {
    expect(
      shouldRunDigest({
        hour: 6,
        timezone: 'UTC',
        now: new Date('2026-04-12T06:30:00Z'),
        lastRunYmd: '2026-04-12',
      }),
    ).toBe(false);
  });

  it('returns false before the configured hour', () => {
    expect(
      shouldRunDigest({
        hour: 6,
        timezone: 'UTC',
        now: new Date('2026-04-12T05:30:00Z'),
        lastRunYmd: '2026-04-11',
      }),
    ).toBe(false);
  });

  it('returns false after midnight rollover when digest already ran for the target-tz day', () => {
    // Digest hour is 23 local (America/New_York). "now" is 2026-04-13T03:30Z =
    // 2026-04-12T23:30 America/New_York. lastRunYmd is already '2026-04-12' in
    // that tz, so the ymd-gate must short-circuit to false (no double-fire).
    expect(
      shouldRunDigest({
        hour: 23,
        timezone: 'America/New_York',
        now: new Date('2026-04-13T03:30:00Z'),
        lastRunYmd: '2026-04-12',
      }),
    ).toBe(false);
  });
});

function bootDigestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_markets (slug TEXT PRIMARY KEY, question TEXT, outcomes_json TEXT, volume_24h REAL, closed INTEGER);
    CREATE TABLE poly_signals (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, market_price REAL, estimated_prob REAL, edge_pct REAL,
      confidence TEXT, reasoning TEXT, approved INTEGER NOT NULL);
    CREATE TABLE poly_paper_trades (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, side TEXT, entry_price REAL, size_usd REAL, shares REAL,
      strategy TEXT, status TEXT, resolved_at INTEGER, realized_pnl REAL);
    CREATE TABLE poly_regime_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, vix REAL, btc_dominance REAL, yield_10y REAL, regime_label TEXT);
    CREATE TABLE poly_calibration_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, window_start INTEGER NOT NULL, window_end INTEGER NOT NULL,
      n_samples INTEGER NOT NULL, brier_score REAL, log_loss REAL, win_rate REAL,
      curve_json TEXT NOT NULL, by_regime_json TEXT);
  `);
  return db;
}

describe('composeDigest — regime section', () => {
  it('emits regime line with composed tag and staleness when a snapshot exists', () => {
    const db = bootDigestDb();
    const tenMinAgo = Math.floor(Date.now() / 1000) - 600;
    db.prepare(`INSERT INTO poly_regime_snapshots (created_at, vix, btc_dominance, yield_10y, regime_label)
      VALUES (?, 18.4, 57.0, 4.31, 'vnorm_bbtc_ymid')`).run(tenMinAgo);
    const { text } = composeDigest(db);
    expect(text).toMatch(/Regime:/);
    expect(text).toContain('vnorm_bbtc_ymid');
  });

  it('emits a no-data placeholder when no regime snapshot exists', () => {
    const db = bootDigestDb();
    const { text } = composeDigest(db);
    expect(text).toMatch(/Regime:\s*\(no data\)/);
  });
});

describe('composeDigest — calibration section', () => {
  it('emits brier + log-loss + n_samples when a calibration snapshot exists', () => {
    const db = bootDigestDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO poly_calibration_snapshots
      (created_at, window_start, window_end, n_samples, brier_score, log_loss, win_rate, curve_json, by_regime_json)
      VALUES (?, ?, ?, 27, 0.213, 0.52, 0.55, '[]', '[]')`).run(now, now - 86400 * 30, now);
    const { text } = composeDigest(db);
    expect(text).toMatch(/Calibration:/);
    expect(text).toContain('0.213');
    expect(text).toContain('N=27');
  });

  it('emits a no-resolutions placeholder when no calibration snapshot exists', () => {
    const db = bootDigestDb();
    const { text } = composeDigest(db);
    expect(text).toMatch(/Calibration:\s*\(no resolutions yet\)/);
  });
});

describe('composeDigest — open positions detail', () => {
  it('lists per-position detail with slug, outcome, entry price, and size when positions are open', () => {
    const db = bootDigestDb();
    db.prepare(`INSERT INTO poly_paper_trades
      (created_at, market_slug, outcome_token_id, outcome_label, side, entry_price, size_usd, shares, strategy, status)
      VALUES (0, 'israel-lebanon-ceasefire', 'tok1', 'Yes', 'BUY', 0.29, 31.69, 109.27, 'ai', 'open')`).run();
    const { text } = composeDigest(db);
    expect(text).toMatch(/Open paper positions:\s*1/);
    expect(text).toContain('israel-lebanon-ceasefire');
    expect(text).toContain('Yes');
    expect(text).toContain('0.29');
  });

  it('caps position detail at 10 lines even when more positions exist', () => {
    const db = bootDigestDb();
    const insert = db.prepare(`INSERT INTO poly_paper_trades
      (created_at, market_slug, outcome_token_id, outcome_label, side, entry_price, size_usd, shares, strategy, status)
      VALUES (0, ?, 'tok', 'Yes', 'BUY', 0.5, 50, 100, 'ai', 'open')`);
    for (let i = 0; i < 15; i++) insert.run(`mkt-${i}`);
    const { text } = composeDigest(db);
    expect(text).toContain('mkt-0');
    expect(text).toContain('mkt-9');
    expect(text).not.toContain('mkt-14');
  });
});
