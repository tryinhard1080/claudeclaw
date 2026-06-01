import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { collectLiveStartupChecks, type LiveStartupFlags } from './live-startup.js';
import { recordSourceFreshness } from './source-freshness.js';

const NOW = 1_800_000_000;

function db(): Database.Database {
  const mem = new Database(':memory:');
  mem.exec(`
    CREATE TABLE poly_paper_trades (status TEXT NOT NULL, realized_pnl REAL);
    CREATE TABLE poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE regime_sharpe_snapshots (
      instance TEXT NOT NULL,
      n_days INTEGER NOT NULL,
      rolling_sharpe_60d REAL,
      created_at INTEGER NOT NULL
    );
  `);
  return mem;
}

const safeFlags: LiveStartupFlags = {
  equityLiveEnabled: false,
  polymarketUsLiveEnabled: false,
  emergencyKillPhraseSet: true,
};

describe('collectLiveStartupChecks', () => {
  it('passes live flag checks when execution flags are disabled', () => {
    const mem = db();
    recordSourceFreshness(mem, {
      sourceName: 'polymarket-gamma-scan',
      fetchedAt: NOW - 60,
      success: true,
      staleAfterSec: 900,
      usedBySignal: true,
    });

    const payload = collectLiveStartupChecks(mem, NOW, safeFlags);

    expect(payload.checks.find(check => check.name === 'Equity live flag')!.status).toBe('pass');
    expect(payload.checks.find(check => check.name === 'Polymarket US live flag')!.status).toBe('pass');
    expect(payload.status).toBe('fail');
    expect(payload.checks.find(check => check.name === 'Real-money gate boxes')!.state).toBe('blocked');
    mem.close();
  });

  it('blocks startup when any live execution flag is already true', () => {
    const mem = db();

    const payload = collectLiveStartupChecks(mem, NOW, {
      ...safeFlags,
      polymarketUsLiveEnabled: true,
    });

    const polyFlag = payload.checks.find(check => check.name === 'Polymarket US live flag')!;
    expect(polyFlag.status).toBe('fail');
    expect(polyFlag.state).toBe('enabled_blocked');
    mem.close();
  });

  it('blocks startup when required signal sources are stale', () => {
    const mem = db();
    recordSourceFreshness(mem, {
      sourceName: 'polymarket-gamma-scan',
      fetchedAt: NOW - 7200,
      success: true,
      staleAfterSec: 900,
      usedBySignal: true,
    });

    const payload = collectLiveStartupChecks(mem, NOW, safeFlags);

    const sourceCheck = payload.checks.find(check => check.name === 'Signal data sources')!;
    expect(sourceCheck.status).toBe('fail');
    expect(sourceCheck.detail).toContain('polymarket-gamma-scan');
    mem.close();
  });
});
