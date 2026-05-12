import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { renderSharpe } from './telegram-commands.js';

function bootDb(opts: { withTable?: boolean } = {}): Database.Database {
  const db = new Database(':memory:');
  if (opts.withTable !== false) {
    db.exec(`
      CREATE TABLE regime_sharpe_snapshots (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        instance        TEXT    NOT NULL,
        snapshot_date   TEXT    NOT NULL,
        equity          REAL    NOT NULL,
        cash            REAL,
        peak_equity     REAL,
        daily_return    REAL,
        rolling_sharpe_60d  REAL,
        n_days          INTEGER NOT NULL,
        source          TEXT    NOT NULL DEFAULT 'state_json',
        created_at      INTEGER NOT NULL,
        UNIQUE(instance, snapshot_date)
      );
    `);
  }
  return db;
}

function insertSnap(
  db: Database.Database,
  o: {
    instance: string;
    date: string;
    equity: number;
    cash?: number | null;
    peakEquity?: number | null;
    dailyReturn?: number | null;
    sharpe?: number | null;
    nDays: number;
  },
): void {
  db.prepare(
    `INSERT INTO regime_sharpe_snapshots
       (instance, snapshot_date, equity, cash, peak_equity, daily_return,
        rolling_sharpe_60d, n_days, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'state_json', ?)`,
  ).run(
    o.instance,
    o.date,
    o.equity,
    o.cash ?? null,
    o.peakEquity ?? null,
    o.dailyReturn ?? null,
    o.sharpe ?? null,
    o.nDays,
    Math.floor(Date.now() / 1000),
  );
}

describe('renderSharpe', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = bootDb();
  });

  it('returns empty-state message when table is missing (migration pending)', () => {
    const dbNoTable = bootDb({ withTable: false });
    const txt = renderSharpe(dbNoTable);
    expect(txt).toContain('Regime Trader Sharpe (rolling 60d)');
    expect(txt).toContain('no Sharpe snapshots yet');
    expect(txt).toContain('table not migrated');
  });

  it('returns empty-state message when no snapshots exist', () => {
    const txt = renderSharpe(db);
    expect(txt).toContain('Regime Trader Sharpe (rolling 60d)');
    expect(txt).toContain('no Sharpe snapshots yet');
  });

  it('renders one row per instance for a single-snapshot DB', () => {
    insertSnap(db, {
      instance: 'spy-aggressive',
      date: '2026-05-11',
      equity: 100_500,
      dailyReturn: 0.005,
      sharpe: null,
      nDays: 1,
    });
    insertSnap(db, {
      instance: 'spy-conservative',
      date: '2026-05-11',
      equity: 100_200,
      dailyReturn: 0.002,
      sharpe: null,
      nDays: 1,
    });
    const txt = renderSharpe(db);
    expect(txt).toContain('spy-aggressive');
    expect(txt).toContain('spy-conservative');
    // nDays < 2 should show the not-enough-data branch.
    expect(txt).toContain('not enough data yet (n_days=1)');
  });

  it('shows trend=rising when ≥8 snapshots have an upward sharpe path', () => {
    // 9 snapshots so we have a lookback of index -8 vs latest index -1.
    // Lookback sharpe = 0.10, latest sharpe = 0.50 → delta > 0.05 → rising.
    const dates = [
      '2026-04-29', '2026-04-30', '2026-05-01', '2026-05-04', '2026-05-05',
      '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-11',
    ];
    const sharpes = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50];
    for (let i = 0; i < dates.length; i++) {
      insertSnap(db, {
        instance: 'spy-aggressive',
        date: dates[i],
        equity: 100_000 + i * 100,
        dailyReturn: 0.001,
        sharpe: sharpes[i],
        nDays: i + 1,
      });
    }
    const txt = renderSharpe(db);
    expect(txt).toContain('spy-aggressive');
    expect(txt).toContain('sharpe=+0.50');
    expect(txt).toContain('trend=rising');
  });

  it('shows partial window (n_days=N/60) when n_days < 60', () => {
    insertSnap(db, {
      instance: 'spy-aggressive',
      date: '2026-05-10',
      equity: 100_500,
      dailyReturn: 0.001,
      sharpe: 0.25,
      nDays: 21,
    });
    insertSnap(db, {
      instance: 'spy-aggressive',
      date: '2026-05-11',
      equity: 100_600,
      dailyReturn: 0.001,
      sharpe: 0.28,
      nDays: 22,
    });
    const txt = renderSharpe(db);
    expect(txt).toContain('n_days=22/60');
    expect(txt).toContain('sharpe=+0.28');
  });

  it('drops the /60 suffix and renders full sharpe once n_days >= 60', () => {
    insertSnap(db, {
      instance: 'spy-conservative',
      date: '2026-05-10',
      equity: 100_500,
      dailyReturn: 0.001,
      sharpe: 0.40,
      nDays: 60,
    });
    insertSnap(db, {
      instance: 'spy-conservative',
      date: '2026-05-11',
      equity: 100_600,
      dailyReturn: 0.001,
      sharpe: 0.42,
      nDays: 61,
    });
    const txt = renderSharpe(db);
    expect(txt).toContain('spy-conservative');
    expect(txt).toContain('sharpe=+0.42');
    expect(txt).toContain('n_days=61');
    expect(txt).not.toContain('n_days=61/60');
  });

  it('renders sharpe=n/a when n_days >= 2 but rolling_sharpe_60d is null (degenerate variance)', () => {
    insertSnap(db, {
      instance: 'spy-aggressive',
      date: '2026-05-10',
      equity: 100_500,
      dailyReturn: 0.005,
      sharpe: null,
      nDays: 5,
    });
    insertSnap(db, {
      instance: 'spy-aggressive',
      date: '2026-05-11',
      equity: 100_503,
      dailyReturn: 0.005,
      sharpe: null,
      nDays: 6,
    });
    const txt = renderSharpe(db);
    expect(txt).toContain('sharpe=n/a');
    expect(txt).toContain('n_days=6/60');
  });

  it('renders negative sharpe with a leading minus sign', () => {
    insertSnap(db, {
      instance: 'spy-aggressive',
      date: '2026-05-11',
      equity: 99_500,
      dailyReturn: -0.005,
      sharpe: -0.31,
      nDays: 22,
    });
    insertSnap(db, {
      instance: 'spy-aggressive',
      date: '2026-05-12',
      equity: 99_400,
      dailyReturn: -0.001,
      sharpe: -0.34,
      nDays: 23,
    });
    const txt = renderSharpe(db);
    expect(txt).toContain('sharpe=-0.34');
  });

  it('sorts instances alphabetically in output', () => {
    insertSnap(db, {
      instance: 'spy-conservative',
      date: '2026-05-11',
      equity: 100_200,
      sharpe: 0.20,
      nDays: 10,
    });
    insertSnap(db, {
      instance: 'spy-aggressive',
      date: '2026-05-11',
      equity: 100_500,
      sharpe: 0.30,
      nDays: 10,
    });
    const txt = renderSharpe(db);
    const aggIdx = txt.indexOf('spy-aggressive');
    const consIdx = txt.indexOf('spy-conservative');
    expect(aggIdx).toBeGreaterThan(-1);
    expect(consIdx).toBeGreaterThan(-1);
    expect(aggIdx).toBeLessThan(consIdx);
  });
});
