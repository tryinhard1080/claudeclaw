import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  collectGateProgress,
  summarizePaperClockGate,
  summarizeKillSwitchRollbackGate,
  summarizeHaltGate,
  summarizePolymarketResolvedGate,
  summarizeRegimeSharpeGate,
  summarizeReviewFindingsGate,
} from './gate-progress.js';
import {
  buildSignalSourceContext,
  classifySourceFreshness,
  readSourceFreshnessChecks,
  recordSourceFreshness,
} from './source-freshness.js';

function db(): Database.Database {
  return new Database(':memory:');
}

describe('gate progress', () => {
  it('surfaces paper-clock evidence when elapsed days are ready for mission review', () => {
    const check = summarizePaperClockGate(`
- [ ] 30+ consecutive days of paper trading without manual intervention.
      (2026-05-11) Day 20/30 on clock that started 2026-04-21. Target 2026-05-21.
- _2026-05-12_ - **A1 ACK: Gate-clock reading PERMISSIVE.** Operator-directed sprint deploys do NOT reset the Box-1 clock.
    `, Math.floor(Date.UTC(2026, 5, 1) / 1000));

    expect(check.status).toBe('warn');
    expect(check.state).toBe('elapsed_review_ready');
    expect(check.current).toBe(41);
    expect(check.target).toBe(30);
    expect(check.detail).toContain('MISSION checkbox still open');
  });

  it('passes the paper-clock gate only when MISSION marks the checkbox complete', () => {
    const check = summarizePaperClockGate(`
- [x] 30+ consecutive days of paper trading without manual intervention.
      (2026-05-21) Complete.
    `);

    expect(check.status).toBe('pass');
    expect(check.state).toBe('mission_checked');
  });

  it('keeps the paper-clock gate in review when the start date is not readable', () => {
    const check = summarizePaperClockGate(`
- [ ] 30+ consecutive days of paper trading without manual intervention.
- _2026-05-12_ - **A1 ACK: Gate-clock reading PERMISSIVE.**
    `);

    expect(check.status).toBe('warn');
    expect(check.state).toBe('mission_review_required');
  });

  it('counts only won/lost Polymarket trades toward the resolved gate', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_paper_trades (
        status TEXT NOT NULL,
        realized_pnl REAL
      );
      INSERT INTO poly_paper_trades(status, realized_pnl) VALUES
        ('won', 12),
        ('lost', -3),
        ('voided', 0),
        ('open', NULL);
    `);

    const check = summarizePolymarketResolvedGate(mem);

    expect(check.status).toBe('warn');
    expect(check.current).toBe(2);
    expect(check.detail).toContain('2/50');
    expect(check.detail).toContain('open 1');
    expect(check.detail).toContain('voided 1');
    mem.close();
  });

  it('passes the halt gate when poly.halt is clear', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO poly_kv(key, value) VALUES ('poly.halt', '0');
    `);

    expect(summarizeHaltGate(mem).status).toBe('pass');
    mem.close();
  });

  it('summarizes regime Sharpe gate from latest rows per instance', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE regime_sharpe_snapshots (
        instance TEXT NOT NULL,
        n_days INTEGER NOT NULL,
        rolling_sharpe_60d REAL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO regime_sharpe_snapshots(instance, n_days, rolling_sharpe_60d, created_at) VALUES
        ('spy-aggressive', 59, 1.0, 1),
        ('spy-aggressive', 60, 1.2, 2),
        ('spy-conservative', 60, 0.8, 2);
    `);

    const check = summarizeRegimeSharpeGate(mem);

    expect(check.status).toBe('pass');
    expect(check.current).toBe(60);
    mem.close();
  });

  it('collects the seven real-money gate boxes', () => {
    const mem = db();
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

    expect(collectGateProgress(mem).map(check => check.box)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    mem.close();
  });

  it('passes review gate when findings ledger has no unresolved P0/P1 rows', () => {
    const check = summarizeReviewFindingsGate(`
| Date | Sprint | Severity | Finding | Status | Commit |
|---|---|---|---|---|---|
| 2026-05-12 | full-project review | P1 | auth guard missing | FIXED | abc123 |
| 2026-05-12 | full-project review | P2 | display mismatch | FILED | abc124 |
    `);

    expect(check.status).toBe('pass');
    expect(check.state).toBe('clear');
  });

  it('fails review gate when a P0/P1 row is not resolved', () => {
    const check = summarizeReviewFindingsGate(`
| Date | Sprint | Severity | Finding | Status | Commit |
|---|---|---|---|---|---|
| 2026-06-01 | live gate | P1 | unsafe sizing path | OPEN | - |
    `);

    expect(check.status).toBe('fail');
    expect(check.current).toBe(1);
  });

  it('passes kill-switch gate when MISSION marks the drill complete', () => {
    const check = summarizeKillSwitchRollbackGate(`
- [x] Documented kill-switch and roll-back procedure tested.
    `);

    expect(check.status).toBe('pass');
  });
});

describe('source freshness', () => {
  const NOW = 1_000_000;

  it('classifies fresh, stale, and never-succeeded sources', () => {
    expect(classifySourceFreshness({
      source_name: 'fred',
      last_fetch_at: NOW - 60,
      last_success_at: NOW - 60,
      stale_after_sec: 3600,
      last_error: null,
      used_by_signal: 1,
      updated_at: NOW - 60,
    }, NOW).status).toBe('pass');

    expect(classifySourceFreshness({
      source_name: 'sec',
      last_fetch_at: NOW - 7200,
      last_success_at: NOW - 7200,
      stale_after_sec: 3600,
      last_error: null,
      used_by_signal: 1,
      updated_at: NOW - 7200,
    }, NOW).state).toBe('stale_signal_source');

    expect(classifySourceFreshness({
      source_name: 'bls',
      last_fetch_at: NOW - 60,
      last_success_at: null,
      stale_after_sec: 3600,
      last_error: '401',
      used_by_signal: 0,
      updated_at: NOW - 60,
    }, NOW).status).toBe('fail');
  });

  it('records source freshness idempotently', () => {
    const mem = db();
    recordSourceFreshness(mem, {
      sourceName: 'polymarket-us-public',
      fetchedAt: NOW - 120,
      success: true,
      staleAfterSec: 900,
      usedBySignal: false,
    });
    recordSourceFreshness(mem, {
      sourceName: 'polymarket-us-public',
      fetchedAt: NOW - 60,
      success: false,
      staleAfterSec: 900,
      lastError: 'temporary 503',
      usedBySignal: false,
    });

    const checks = readSourceFreshnessChecks(mem, NOW);

    expect(checks).toHaveLength(1);
    expect(checks[0]!.status).toBe('pass');
    expect(checks[0]!.detail).toContain('2m old');
    mem.close();
  });

  it('warns when the source_freshness table is missing', () => {
    const mem = db();

    expect(readSourceFreshnessChecks(mem, NOW)[0]!.state).toBe('table_missing');
    mem.close();
  });

  it('builds signal source context from required fresh sources only', () => {
    const mem = db();
    recordSourceFreshness(mem, {
      sourceName: 'polymarket-gamma-scan',
      fetchedAt: NOW - 60,
      success: true,
      staleAfterSec: 900,
      usedBySignal: true,
    });
    recordSourceFreshness(mem, {
      sourceName: 'operator-newsletter',
      fetchedAt: NOW - 7200,
      success: true,
      staleAfterSec: 60,
      usedBySignal: false,
    });

    const context = buildSignalSourceContext(mem, NOW);

    expect(context.allRequiredFresh).toBe(true);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]!.name).toBe('polymarket-gamma-scan');
    expect(context.sources[0]!.ageSec).toBe(60);
    mem.close();
  });

  it('marks signal source context incomplete when a required source is stale', () => {
    const mem = db();
    recordSourceFreshness(mem, {
      sourceName: 'polymarket-gamma-scan',
      fetchedAt: NOW - 7200,
      success: true,
      staleAfterSec: 900,
      usedBySignal: true,
    });

    const context = buildSignalSourceContext(mem, NOW);

    expect(context.allRequiredFresh).toBe(false);
    expect(context.sources[0]!.state).toBe('stale_signal_source');
    mem.close();
  });
});
