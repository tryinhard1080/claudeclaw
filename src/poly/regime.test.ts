import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  vixBucket, btcDomBucket, yieldBucket, composeRegimeTag,
  composeRegimeSnapshot, persistRegimeSnapshot, latestRegimeSnapshot,
  shouldRunRegimeSnapshot, fetchRegimeInputs,
  type RegimeSnapshot, type RegimeHttpFn,
} from './regime.js';

describe('vixBucket', () => {
  it('classifies below 15 as calm', () => {
    expect(vixBucket(14.99)).toBe('calm');
    expect(vixBucket(0)).toBe('calm');
  });
  it('classifies 15 inclusive to 25 exclusive as norm', () => {
    expect(vixBucket(15)).toBe('norm');
    expect(vixBucket(24.99)).toBe('norm');
  });
  it('classifies 25+ as stress', () => {
    expect(vixBucket(25)).toBe('stress');
    expect(vixBucket(80)).toBe('stress');
  });
  it('returns unk on null/undefined/NaN', () => {
    expect(vixBucket(null)).toBe('unk');
    expect(vixBucket(NaN)).toBe('unk');
  });
});

describe('btcDomBucket', () => {
  it('below 45 is alt-heavy', () => { expect(btcDomBucket(44.9)).toBe('alt'); });
  it('45-55 is mix', () => {
    expect(btcDomBucket(45)).toBe('mix');
    expect(btcDomBucket(54.99)).toBe('mix');
  });
  it('55+ is btc-dominant', () => {
    expect(btcDomBucket(55)).toBe('btc');
    expect(btcDomBucket(80)).toBe('btc');
  });
  it('returns unk on null', () => { expect(btcDomBucket(null)).toBe('unk'); });
});

describe('yieldBucket', () => {
  it('below 3.5 is low', () => { expect(yieldBucket(3.49)).toBe('low'); });
  it('3.5-5 is mid', () => {
    expect(yieldBucket(3.5)).toBe('mid');
    expect(yieldBucket(4.99)).toBe('mid');
  });
  it('5+ is high', () => {
    expect(yieldBucket(5)).toBe('high');
    expect(yieldBucket(7)).toBe('high');
  });
  it('returns unk on null', () => { expect(yieldBucket(null)).toBe('unk'); });
});

describe('composeRegimeTag', () => {
  it('builds v/b/y tripled string', () => {
    expect(composeRegimeTag({ vix: 14, btcDominance: 50, yield10y: 4 }))
      .toBe('vcalm_bmix_ymid');
  });
  it('stamps unk components independently', () => {
    expect(composeRegimeTag({ vix: null, btcDominance: 50, yield10y: 4 }))
      .toBe('vunk_bmix_ymid');
  });
  it('all-null yields all-unk tag (still a valid label)', () => {
    expect(composeRegimeTag({ vix: null, btcDominance: null, yield10y: null }))
      .toBe('vunk_bunk_yunk');
  });
});

describe('composeRegimeSnapshot', () => {
  it('bundles inputs + tag + timestamp', () => {
    const s = composeRegimeSnapshot({ vix: 20, btcDominance: 60, yield10y: 3 }, 1700);
    expect(s.createdAt).toBe(1700);
    expect(s.vix).toBe(20);
    expect(s.btcDominance).toBe(60);
    expect(s.yield10y).toBe(3);
    expect(s.regimeLabel).toBe('vnorm_bbtc_ylow');
  });
});

function bootDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_regime_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      vix REAL, btc_dominance REAL, yield_10y REAL,
      regime_label TEXT NOT NULL);
  `);
  return db;
}

describe('persistRegimeSnapshot + latestRegimeSnapshot', () => {
  const base: RegimeSnapshot = {
    createdAt: 1000, vix: 18, btcDominance: 52, yield10y: 4.2,
    regimeLabel: 'vnorm_bmix_ymid',
  };
  it('round-trips a snapshot', () => {
    const db = bootDb();
    const id = persistRegimeSnapshot(db, base);
    expect(id).toBeGreaterThan(0);
    const latest = latestRegimeSnapshot(db);
    expect(latest).toMatchObject(base);
  });
  it('latest is null when no rows', () => {
    expect(latestRegimeSnapshot(bootDb())).toBeNull();
  });
  it('latest uses created_at ordering, not id', () => {
    const db = bootDb();
    persistRegimeSnapshot(db, { ...base, createdAt: 2000, regimeLabel: 'a' });
    persistRegimeSnapshot(db, { ...base, createdAt: 1500, regimeLabel: 'b' });
    expect(latestRegimeSnapshot(db)!.regimeLabel).toBe('a');
  });
  it('persists nullable numerics', () => {
    const db = bootDb();
    persistRegimeSnapshot(db, { ...base, vix: null, btcDominance: null, yield10y: null });
    const got = latestRegimeSnapshot(db)!;
    expect(got.vix).toBeNull();
    expect(got.btcDominance).toBeNull();
    expect(got.yield10y).toBeNull();
  });
});

describe('shouldRunRegimeSnapshot', () => {
  it('true when no prior run', () => {
    expect(shouldRunRegimeSnapshot({ refreshMinutes: 15, lastRunAtSec: null, nowSec: 1000 }))
      .toBe(true);
  });
  it('false when interval not elapsed', () => {
    expect(shouldRunRegimeSnapshot({ refreshMinutes: 15, lastRunAtSec: 1000, nowSec: 1000 + 14 * 60 }))
      .toBe(false);
  });
  it('true once interval elapsed (inclusive)', () => {
    expect(shouldRunRegimeSnapshot({ refreshMinutes: 15, lastRunAtSec: 1000, nowSec: 1000 + 15 * 60 }))
      .toBe(true);
  });
});

describe('fetchRegimeInputs', () => {
  it('parses Yahoo VIX + TNX and CoinGecko BTC dominance', async () => {
    const http: RegimeHttpFn = async (url) => {
      if (url.includes('%5EVIX')) {
        return { chart: { result: [{ indicators: { quote: [{ close: [17.5] }] } }] } };
      }
      if (url.includes('%5ETNX')) {
        // Yahoo's ^TNX close is already in percent (4.2 = 4.2%).
        return { chart: { result: [{ indicators: { quote: [{ close: [4.2] }] } }] } };
      }
      if (url.includes('coingecko.com')) {
        return { data: { market_cap_percentage: { btc: 51.3 } } };
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const out = await fetchRegimeInputs(http);
    expect(out.vix).toBeCloseTo(17.5);
    expect(out.btcDominance).toBeCloseTo(51.3);
    expect(out.yield10y).toBeCloseTo(4.2);
  });

  it('takes latest non-null close (some bars report null on half-days)', async () => {
    const http: RegimeHttpFn = async (url) => {
      if (url.includes('%5EVIX')) {
        return { chart: { result: [{ indicators: { quote: [{ close: [17, null, null] }] } }] } };
      }
      if (url.includes('%5ETNX')) {
        return { chart: { result: [{ indicators: { quote: [{ close: [4.2, null] }] } }] } };
      }
      return { data: { market_cap_percentage: { btc: 50 } } };
    };
    const out = await fetchRegimeInputs(http);
    expect(out.vix).toBe(17);
    expect(out.yield10y).toBeCloseTo(4.2);
  });

  it('null-safe when an upstream returns unexpected shape', async () => {
    const http: RegimeHttpFn = async () => ({});
    const out = await fetchRegimeInputs(http);
    expect(out.vix).toBeNull();
    expect(out.btcDominance).toBeNull();
    expect(out.yield10y).toBeNull();
  });

  it('one endpoint failing does not block the others', async () => {
    const http: RegimeHttpFn = async (url) => {
      if (url.includes('%5EVIX')) throw new Error('net');
      if (url.includes('%5ETNX')) return { chart: { result: [{ indicators: { quote: [{ close: [4] }] } }] } };
      return { data: { market_cap_percentage: { btc: 50 } } };
    };
    const out = await fetchRegimeInputs(http);
    expect(out.vix).toBeNull();
    expect(out.yield10y).toBe(4);
    expect(out.btcDominance).toBe(50);
  });
});
