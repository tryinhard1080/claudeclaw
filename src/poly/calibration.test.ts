import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import {
  brierScore, logLoss, calibrationCurve, brierByRegime,
  fetchResolvedSamples, composeSnapshot, persistSnapshot, latestSnapshot,
  shouldRunCalibration, formatCalibrationAlert, MIN_ALERT_SAMPLES,
  type ResolvedSample, type CalibrationSnapshot,
} from './calibration.js';

describe('brierScore', () => {
  it('returns null on empty input', () => {
    expect(brierScore([])).toBeNull();
  });

  it('returns 0 for perfect calibration', () => {
    expect(brierScore([
      { estimatedProb: 1, outcome: 1 },
      { estimatedProb: 0, outcome: 0 },
    ])).toBeCloseTo(0, 10);
  });

  it('returns 1 when every prediction is maximally wrong', () => {
    expect(brierScore([
      { estimatedProb: 0, outcome: 1 },
      { estimatedProb: 1, outcome: 0 },
    ])).toBeCloseTo(1, 10);
  });

  it('returns 0.25 for uniform-50% on mixed outcomes (baseline)', () => {
    expect(brierScore([
      { estimatedProb: 0.5, outcome: 1 },
      { estimatedProb: 0.5, outcome: 0 },
    ])).toBeCloseTo(0.25, 10);
  });

  it('matches manual calculation on a mixed three-sample case', () => {
    expect(brierScore([
      { estimatedProb: 0.7, outcome: 1 },
      { estimatedProb: 0.4, outcome: 0 },
      { estimatedProb: 0.9, outcome: 1 },
    ])).toBeCloseTo(0.0866666666, 6);
  });
});

describe('logLoss', () => {
  it('returns null on empty input', () => {
    expect(logLoss([])).toBeNull();
  });

  it('returns ~0 for confidently correct predictions', () => {
    const ll = logLoss([
      { estimatedProb: 0.999, outcome: 1 },
      { estimatedProb: 0.001, outcome: 0 },
    ])!;
    expect(ll).toBeLessThan(0.01);
  });

  it('caps at log(EPS) — predict 0, outcome 1 — no -Infinity', () => {
    const ll = logLoss([{ estimatedProb: 0, outcome: 1 }])!;
    expect(Number.isFinite(ll)).toBe(true);
    expect(ll).toBeGreaterThan(30);
  });

  it('caps in the other direction — predict 1, outcome 0', () => {
    const ll = logLoss([{ estimatedProb: 1, outcome: 0 }])!;
    expect(Number.isFinite(ll)).toBe(true);
    expect(ll).toBeGreaterThan(30);
  });

  it('returns ln(2) for uniform-50% on mixed outcomes', () => {
    expect(logLoss([
      { estimatedProb: 0.5, outcome: 1 },
      { estimatedProb: 0.5, outcome: 0 },
    ])).toBeCloseTo(Math.LN2, 6);
  });
});

describe('calibrationCurve', () => {
  it('always returns 10 buckets', () => {
    expect(calibrationCurve([])).toHaveLength(10);
    expect(calibrationCurve([{ estimatedProb: 0.5, outcome: 1 }])).toHaveLength(10);
  });

  it('bucket 0 covers [0,0.1); bucket 9 covers [0.9,1.0]', () => {
    const c = calibrationCurve([]);
    expect(c[0]!.predLow).toBe(0);
    expect(c[0]!.predHigh).toBeCloseTo(0.1, 10);
    expect(c[9]!.predLow).toBeCloseTo(0.9, 10);
    expect(c[9]!.predHigh).toBe(1);
  });

  it('probability=1 lands in bucket 9 (inclusive upper)', () => {
    const c = calibrationCurve([{ estimatedProb: 1, outcome: 1 }]);
    expect(c[9]!.count).toBe(1);
    expect(c[9]!.actualWinRate).toBe(1);
  });

  it('probability=0.5 lands in bucket 5', () => {
    const c = calibrationCurve([{ estimatedProb: 0.5, outcome: 0 }]);
    expect(c[5]!.count).toBe(1);
    expect(c[5]!.actualWinRate).toBe(0);
  });

  it('empty buckets report actualWinRate = null', () => {
    const c = calibrationCurve([{ estimatedProb: 0.5, outcome: 1 }]);
    expect(c[0]!.actualWinRate).toBeNull();
    expect(c[5]!.actualWinRate).toBe(1);
  });

  it('aggregates per-bucket win rate', () => {
    const c = calibrationCurve([
      { estimatedProb: 0.81, outcome: 1 },
      { estimatedProb: 0.85, outcome: 1 },
      { estimatedProb: 0.89, outcome: 0 },
    ]);
    expect(c[8]!.count).toBe(3);
    expect(c[8]!.actualWinRate).toBeCloseTo(2 / 3, 6);
  });
});

function bootDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_signals (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, market_price REAL, estimated_prob REAL, edge_pct REAL,
      confidence TEXT, reasoning TEXT, contrarian TEXT, approved INTEGER NOT NULL,
      rejection_reasons TEXT, paper_trade_id INTEGER, regime_label TEXT);
    CREATE TABLE poly_paper_trades (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, side TEXT, entry_price REAL, size_usd REAL, shares REAL,
      kelly_fraction REAL, strategy TEXT, status TEXT,
      resolved_at INTEGER, realized_pnl REAL, voided_reason TEXT);
  `);
  return db;
}

function insertResolved(db: Database.Database, o: { prob: number; status: 'won'|'lost'|'voided'; resolvedAt: number; regime?: string | null; }): void {
  const sig = db.prepare(`INSERT INTO poly_signals (created_at,market_slug,outcome_token_id,outcome_label,market_price,estimated_prob,edge_pct,confidence,reasoning,approved,regime_label) VALUES (0,'s','tok','Yes',0.4,?,10,'high','r',1,?)`).run(o.prob, o.regime ?? null);
  const tradeId = sig.lastInsertRowid;
  db.prepare(`INSERT INTO poly_paper_trades (id,created_at,market_slug,outcome_token_id,outcome_label,side,entry_price,size_usd,shares,kelly_fraction,strategy,status,resolved_at,realized_pnl) VALUES (?,0,'s','tok','Yes','BUY',0.4,50,125,0.25,'ai',?,?,0)`).run(tradeId, o.status, o.resolvedAt);
  db.prepare(`UPDATE poly_signals SET paper_trade_id=? WHERE id=?`).run(tradeId, tradeId);
}

function bootCalDb(): Database.Database {
  const db = bootDb();
  db.exec(`
    CREATE TABLE poly_calibration_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      window_start INTEGER NOT NULL, window_end INTEGER NOT NULL,
      n_samples INTEGER NOT NULL, brier_score REAL, log_loss REAL, win_rate REAL,
      curve_json TEXT NOT NULL, by_regime_json TEXT);
  `);
  return db;
}

describe('brierByRegime', () => {
  it('empty input returns empty list', () => {
    expect(brierByRegime([])).toEqual([]);
  });
  it('groups samples by regime and sorts by n desc', () => {
    const out = brierByRegime([
      { estimatedProb: 0.7, outcome: 1, regimeLabel: 'A' },
      { estimatedProb: 0.3, outcome: 0, regimeLabel: 'A' },
      { estimatedProb: 0.5, outcome: 1, regimeLabel: 'B' },
    ]);
    expect(out.map(g => g.regime)).toEqual(['A', 'B']);
    expect(out[0]!.nSamples).toBe(2);
    expect(out[1]!.nSamples).toBe(1);
    expect(out[0]!.brierScore).toBeCloseTo((0.09 + 0.09) / 2, 6);
  });
  it('tags untagged samples as "unknown"', () => {
    const out = brierByRegime([
      { estimatedProb: 0.5, outcome: 1 },
      { estimatedProb: 0.5, outcome: 0, regimeLabel: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.regime).toBe('unknown');
    expect(out[0]!.nSamples).toBe(2);
  });
});

describe('fetchResolvedSamples', () => {
  it('empty when no resolved trades in window', () => {
    expect(fetchResolvedSamples(bootDb(), 0, 1000)).toEqual([]);
  });

  it('returns one sample per won/lost trade', () => {
    const db = bootDb();
    insertResolved(db, { prob: 0.7, status: 'won',  resolvedAt: 100 });
    insertResolved(db, { prob: 0.3, status: 'lost', resolvedAt: 200 });
    const out = fetchResolvedSamples(db, 0, 1000);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ estimatedProb: 0.7, outcome: 1, regimeLabel: null });
    expect(out).toContainEqual({ estimatedProb: 0.3, outcome: 0, regimeLabel: null });
  });

  it('excludes voided trades', () => {
    const db = bootDb();
    insertResolved(db, { prob: 0.5, status: 'voided', resolvedAt: 100 });
    expect(fetchResolvedSamples(db, 0, 1000)).toEqual([]);
  });

  it('respects inclusive time window on both ends', () => {
    const db = bootDb();
    insertResolved(db, { prob: 0.6, status: 'won', resolvedAt: 50 });
    insertResolved(db, { prob: 0.6, status: 'won', resolvedAt: 100 });
    insertResolved(db, { prob: 0.6, status: 'won', resolvedAt: 150 });
    expect(fetchResolvedSamples(db, 100, 100)).toHaveLength(1);
    expect(fetchResolvedSamples(db, 50, 150)).toHaveLength(3);
  });

  it('skips trades whose signal row was deleted (INNER JOIN safety)', () => {
    const db = bootDb();
    insertResolved(db, { prob: 0.7, status: 'won', resolvedAt: 100 });
    db.prepare(`DELETE FROM poly_signals`).run();
    expect(fetchResolvedSamples(db, 0, 1000)).toEqual([]);
  });
});

describe('composeSnapshot', () => {
  it('null when no resolved samples in lookback', () => {
    expect(composeSnapshot(bootCalDb(), 1_700_000_000_000, 30)).toBeNull();
  });

  it('snapshot includes byRegime grouping', () => {
    const db = bootCalDb();
    const now = 1_700_000_000;
    insertResolved(db, { prob: 0.7, status: 'won',  resolvedAt: now - 1000, regime: 'A' });
    insertResolved(db, { prob: 0.3, status: 'lost', resolvedAt: now - 1000, regime: 'A' });
    insertResolved(db, { prob: 0.6, status: 'won',  resolvedAt: now - 1000, regime: 'B' });
    const snap = composeSnapshot(db, now * 1000, 30)!;
    const labels = snap.byRegime.map(r => r.regime);
    expect(labels).toContain('A');
    expect(labels).toContain('B');
  });

  it('produces full snapshot with math + curve', () => {
    const db = bootCalDb();
    const now = 1_700_000_000;
    insertResolved(db, { prob: 0.7, status: 'won',  resolvedAt: now - 86400 });
    insertResolved(db, { prob: 0.3, status: 'lost', resolvedAt: now - 86400 });
    const snap = composeSnapshot(db, now * 1000, 30)!;
    expect(snap.nSamples).toBe(2);
    expect(snap.brierScore).toBeCloseTo(((0.7 - 1) ** 2 + (0.3 - 0) ** 2) / 2, 6);
    expect(snap.winRate).toBeCloseTo(0.5, 6);
    expect(snap.curve).toHaveLength(10);
    expect(snap.windowEnd).toBe(now);
    expect(snap.windowStart).toBe(now - 30 * 86400);
  });
});

describe('persistSnapshot + latestSnapshot', () => {
  const baseSnap: CalibrationSnapshot = {
    createdAt: 100, windowStart: 0, windowEnd: 100, nSamples: 1,
    brierScore: 0.1, logLoss: 0.2, winRate: 1,
    curve: [{ bucket: 0, predLow: 0, predHigh: 0.1, count: 0, actualWinRate: null }],
    byRegime: [{ regime: 'vnorm_bmix_ymid', nSamples: 1, brierScore: 0.1 }],
  };

  it('persist returns id; latest round-trips the snapshot', () => {
    const db = bootCalDb();
    const id = persistSnapshot(db, baseSnap);
    expect(id).toBeGreaterThan(0);
    const latest = latestSnapshot(db);
    expect(latest!.brierScore).toBe(0.1);
    expect(latest!.curve).toHaveLength(1);
  });

  it('latest returns null when no rows exist', () => {
    expect(latestSnapshot(bootCalDb())).toBeNull();
  });

  it('latest returns most-recently-created, not highest id', () => {
    const db = bootCalDb();
    const emptyCurve = [{ bucket: 0, predLow: 0, predHigh: 0.1, count: 0, actualWinRate: null }];
    const base: CalibrationSnapshot = {
      createdAt: 0, windowStart: 0, windowEnd: 0, nSamples: 0,
      brierScore: null, logLoss: null, winRate: 0, curve: emptyCurve, byRegime: [],
    };
    persistSnapshot(db, { ...base, createdAt: 200, brierScore: 0.5 });
    persistSnapshot(db, { ...base, createdAt: 100, brierScore: 0.9 });
    expect(latestSnapshot(db)!.brierScore).toBe(0.5);
  });
});

describe('shouldRunCalibration', () => {
  const tz = 'America/New_York';
  it('true at 07:xx local when lastRunYmd is yesterday', () => {
    const now = DateTime.fromISO('2026-04-13T07:05:00', { zone: tz }).toJSDate();
    expect(shouldRunCalibration({ hour: 7, timezone: tz, now, lastRunYmd: '2026-04-12' })).toBe(true);
  });
  it('false before the configured hour', () => {
    const now = DateTime.fromISO('2026-04-13T06:59:00', { zone: tz }).toJSDate();
    expect(shouldRunCalibration({ hour: 7, timezone: tz, now, lastRunYmd: '2026-04-12' })).toBe(false);
  });
  it('false when already ran today', () => {
    const now = DateTime.fromISO('2026-04-13T08:00:00', { zone: tz }).toJSDate();
    expect(shouldRunCalibration({ hour: 7, timezone: tz, now, lastRunYmd: '2026-04-13' })).toBe(false);
  });
  it('true when lastRunYmd is null (first ever run)', () => {
    const now = DateTime.fromISO('2026-04-13T08:00:00', { zone: tz }).toJSDate();
    expect(shouldRunCalibration({ hour: 7, timezone: tz, now, lastRunYmd: null })).toBe(true);
  });
});

describe('formatCalibrationAlert', () => {
  const baseSnap: CalibrationSnapshot = {
    createdAt: 0, windowStart: 0, windowEnd: 30 * 86400, nSamples: 12,
    brierScore: 0.40, logLoss: 0.85, winRate: 0.42, curve: [], byRegime: [],
  };
  it('null when n below MIN_ALERT_SAMPLES', () => {
    expect(formatCalibrationAlert({ ...baseSnap, nSamples: MIN_ALERT_SAMPLES - 1 }, 0.30)).toBeNull();
  });
  it('null when brierScore is null', () => {
    expect(formatCalibrationAlert({ ...baseSnap, brierScore: null }, 0.30)).toBeNull();
  });
  it('null when brier <= threshold', () => {
    expect(formatCalibrationAlert({ ...baseSnap, brierScore: 0.30 }, 0.30)).toBeNull();
    expect(formatCalibrationAlert({ ...baseSnap, brierScore: 0.20 }, 0.30)).toBeNull();
  });
  it('returns formatted text when n >= min AND brier > threshold', () => {
    const txt = formatCalibrationAlert(baseSnap, 0.30);
    expect(txt).not.toBeNull();
    expect(txt!).toContain('Calibration alarm');
    expect(txt!).toContain('0.400');
    expect(txt!).toContain('0.300');
  });
});
