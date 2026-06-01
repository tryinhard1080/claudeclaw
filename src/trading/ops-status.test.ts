import { describe, expect, it } from 'vitest';

import {
  isUsEquityRegularSession,
  type SharpeRow,
  summarizeFinancialDatasetsMcp,
  summarizePm2Apps,
  summarizePolyScanRuns,
  summarizeRegimeState,
  summarizeSharpeFreshness,
  summarizeWeatherGoatDoctor,
} from './ops-status.js';

const NOW = Date.parse('2026-05-09T14:00:00.000Z');
const SUNDAY = Date.parse('2026-05-24T16:00:00.000Z');
const MONDAY_REGULAR_SESSION = Date.parse('2026-05-18T15:00:00.000Z');

describe('summarizePm2Apps', () => {
  it('accepts online ClaudeClaw plus stopped Regime Trader apps before next open when paths point to C:\\Code', () => {
    const result = summarizePm2Apps(
      [
        {
          name: 'claudeclaw-main',
          pm2_env: { status: 'online', pm_cwd: 'C:\\Code\\claudeclaw', pm_exec_path: 'C:\\Code\\claudeclaw\\dist\\index.js' },
        },
        {
          name: 'regime-trader-spy-agg',
          pm2_env: { status: 'stopped', pm_cwd: 'C:\\Code\\regime-trader', pm_exec_path: 'C:\\Code\\regime-trader\\main.py' },
        },
        {
          name: 'regime-trader-spy-cons',
          pm2_env: { status: 'stopped', pm_cwd: 'C:\\Code\\regime-trader', pm_exec_path: 'C:\\Code\\regime-trader\\main.py' },
        },
      ],
      {
        nowMs: NOW,
        regimeStatesByApp: {
          'regime-trader-spy-agg': { market_open: false, next_open: '2026-05-11T13:30:00.000Z', equity: 100000, cash: 100000 },
          'regime-trader-spy-cons': { market_open: false, next_open: '2026-05-11T13:30:00.000Z', equity: 100000, cash: 100000 },
        },
      },
    );

    expect(result.status).toBe('pass');
    expect(result.state).toBe('healthy');
  });

  it('accepts stopped Regime Trader apps outside regular session when state is stale open-market state', () => {
    const result = summarizePm2Apps(
      [
        {
          name: 'claudeclaw-main',
          pm2_env: { status: 'online', pm_cwd: 'C:\\Code\\claudeclaw', pm_exec_path: 'C:\\Code\\claudeclaw\\dist\\index.js' },
        },
        {
          name: 'regime-trader-spy-agg',
          pm2_env: { status: 'stopped', pm_cwd: 'C:\\Code\\regime-trader', pm_exec_path: 'C:\\Code\\regime-trader\\main.py' },
        },
        {
          name: 'regime-trader-spy-cons',
          pm2_env: { status: 'stopped', pm_cwd: 'C:\\Code\\regime-trader', pm_exec_path: 'C:\\Code\\regime-trader\\main.py' },
        },
      ],
      {
        nowMs: SUNDAY,
        regimeStatesByApp: {
          'regime-trader-spy-agg': { market_open: true, equity: 100000, cash: 100000, regime: {}, risk: {} },
          'regime-trader-spy-cons': { market_open: true, equity: 100000, cash: 100000, regime: {}, risk: {} },
        },
        regimeStateMtimesByApp: {
          'regime-trader-spy-agg': Date.parse('2026-05-22T19:35:00.000Z'),
          'regime-trader-spy-cons': Date.parse('2026-05-22T19:35:00.000Z'),
        },
      },
    );

    expect(result.status).toBe('pass');
    expect(result.detail).toMatch(/closed_stale_open_state/);
  });
});

describe('isUsEquityRegularSession', () => {
  it('returns true during regular weekday session', () => {
    expect(isUsEquityRegularSession(MONDAY_REGULAR_SESSION)).toBe(true);
  });

  it('returns false on weekends', () => {
    expect(isUsEquityRegularSession(SUNDAY)).toBe(false);
  });
});

describe('summarizeFinancialDatasetsMcp', () => {
  it('returns needs_auth when Claude MCP reports authentication is required', () => {
    const result = summarizeFinancialDatasetsMcp('financial-datasets: https://mcp.financialdatasets.ai/ (HTTP) - Needs authentication');

    expect(result.status).toBe('warn');
    expect(result.state).toBe('needs_auth');
  });

  it('returns connected from targeted Claude MCP get output', () => {
    const result = summarizeFinancialDatasetsMcp(`financial-datasets:
  Scope: Local config
  Status: ✓ Connected
  Type: http
  URL: https://mcp.financialdatasets.ai/api`);

    expect(result.status).toBe('pass');
    expect(result.state).toBe('connected');
  });
});

describe('summarizeWeatherGoatDoctor', () => {
  it('returns healthy when Open-Meteo is reachable and auth is not required', () => {
    const result = summarizeWeatherGoatDoctor('{"api":"reachable","auth":"not required"}');

    expect(result.status).toBe('pass');
    expect(result.state).toBe('healthy');
  });
});

describe('summarizeRegimeState', () => {
  it('treats closed-market state as healthy before next_open', () => {
    const result = summarizeRegimeState(
      { market_open: false, next_open: '2026-05-11T13:30:00.000Z', equity: 100000, cash: 100000 },
      NOW,
    );

    expect(result.status).toBe('pass');
    expect(result.state).toBe('closed_until_next_open');
  });

  it('treats closed-market state as stale after next_open plus grace', () => {
    const result = summarizeRegimeState(
      { market_open: false, next_open: '2026-05-09T13:30:00.000Z', equity: 100000, cash: 100000 },
      NOW,
      { graceMs: 10 * 60 * 1000 },
    );

    expect(result.status).toBe('fail');
    expect(result.state).toBe('stale_after_next_open');
  });

  it('treats missing state as unhealthy', () => {
    const result = summarizeRegimeState(null, NOW);

    expect(result.status).toBe('fail');
    expect(result.state).toBe('missing');
  });

  it('treats stale open-market state outside regular session as safe closed-session state', () => {
    const result = summarizeRegimeState(
      { market_open: true, equity: 100000, cash: 100000, regime: {}, risk: {} },
      SUNDAY,
      { stateMtimeMs: Date.parse('2026-05-22T19:35:00.000Z') },
    );

    expect(result.status).toBe('pass');
    expect(result.state).toBe('closed_stale_open_state');
  });

  it('fails stale open-market state during regular session', () => {
    const result = summarizeRegimeState(
      { market_open: true, equity: 100000, cash: 100000, regime: {}, risk: {} },
      MONDAY_REGULAR_SESSION,
      { stateMtimeMs: MONDAY_REGULAR_SESSION - 31 * 60 * 1000 },
    );

    expect(result.status).toBe('fail');
    expect(result.state).toBe('open_stale_during_session');
  });
});

describe('summarizePolyScanRuns', () => {
  it('returns healthy when the most recent successful scan is within twice the scan interval', () => {
    const result = summarizePolyScanRuns(
      [{ started_at: Math.floor((NOW - 6 * 60 * 1000) / 1000), duration_ms: 900, market_count: 864, status: 'ok', error: null }],
      NOW,
      5,
    );

    expect(result.status).toBe('pass');
    expect(result.state).toBe('fresh');
  });
});

describe('summarizeSharpeFreshness', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it('returns warn when the table is missing (migration pending)', () => {
    const result = summarizeSharpeFreshness([], { nowMs: NOW, tableMissing: true });

    expect(result.status).toBe('warn');
    expect(result.state).toBe('table_missing');
    expect(result.detail).toMatch(/migration pending/);
  });

  it('returns warn when no snapshots exist yet and bot is fresh', () => {
    const result = summarizeSharpeFreshness([], { nowMs: NOW, tradingDaysSinceStart: 2 });

    expect(result.status).toBe('warn');
    expect(result.state).toBe('no_snapshots');
  });

  it('returns fail when no snapshots exist after 5+ trading days', () => {
    const result = summarizeSharpeFreshness([], { nowMs: NOW, tradingDaysSinceStart: 7 });

    expect(result.status).toBe('fail');
    expect(result.state).toBe('missing');
  });

  it('returns pass when both instances have fresh rows with n_days >= 1', () => {
    const rows: SharpeRow[] = [
      { instance: 'spy-aggressive', snapshot_date: '2026-05-08', n_days: 21, created_at: NOW - 2 * HOUR },
      { instance: 'spy-conservative', snapshot_date: '2026-05-08', n_days: 21, created_at: NOW - 2 * HOUR },
    ];
    const result = summarizeSharpeFreshness(rows, { nowMs: NOW });

    expect(result.status).toBe('pass');
    expect(result.state).toBe('fresh');
    expect(result.detail).toMatch(/spy-aggressive/);
    expect(result.detail).toMatch(/spy-conservative/);
  });

  it('accepts Friday Sharpe snapshots on Monday morning before the next scheduled snapshot', () => {
    const mondayMorningCt = Date.parse('2026-06-01T14:00:00.000Z');
    const fridaySnapshotMs = Date.parse('2026-05-29T22:00:00.000Z');
    const rows: SharpeRow[] = [
      { instance: 'spy-aggressive', snapshot_date: '2026-05-29', n_days: 8, created_at: fridaySnapshotMs },
      { instance: 'spy-conservative', snapshot_date: '2026-05-29', n_days: 8, created_at: fridaySnapshotMs },
    ];
    const result = summarizeSharpeFreshness(rows, { nowMs: mondayMorningCt });

    expect(result.status).toBe('pass');
    expect(result.state).toBe('fresh');
  });

  it('fails Friday Sharpe snapshots after the Monday scheduled snapshot is missed', () => {
    const mondayEveningCt = Date.parse('2026-06-01T23:05:00.000Z');
    const fridaySnapshotMs = Date.parse('2026-05-29T22:00:00.000Z');
    const rows: SharpeRow[] = [
      { instance: 'spy-aggressive', snapshot_date: '2026-05-29', n_days: 8, created_at: fridaySnapshotMs },
      { instance: 'spy-conservative', snapshot_date: '2026-05-29', n_days: 8, created_at: fridaySnapshotMs },
    ];
    const result = summarizeSharpeFreshness(rows, { nowMs: mondayEveningCt });

    expect(result.status).toBe('fail');
    expect(result.state).toBe('stale');
  });

  it('returns warn when latest row is 1-3 days stale', () => {
    const rows: SharpeRow[] = [
      { instance: 'spy-aggressive', snapshot_date: '2026-05-07', n_days: 20, created_at: NOW - 2 * DAY },
      { instance: 'spy-conservative', snapshot_date: '2026-05-08', n_days: 21, created_at: NOW - 2 * HOUR },
    ];
    const result = summarizeSharpeFreshness(rows, { nowMs: NOW });

    expect(result.status).toBe('warn');
    expect(result.state).toBe('stale');
    expect(result.detail).toMatch(/spy-aggressive/);
  });

  it('returns warn when an instance has n_days=0 despite a fresh row', () => {
    const rows: SharpeRow[] = [
      { instance: 'spy-aggressive', snapshot_date: '2026-05-08', n_days: 0, created_at: NOW - 2 * HOUR },
      { instance: 'spy-conservative', snapshot_date: '2026-05-08', n_days: 5, created_at: NOW - 2 * HOUR },
    ];
    const result = summarizeSharpeFreshness(rows, { nowMs: NOW });

    expect(result.status).toBe('warn');
    expect(result.detail).toMatch(/n_days=0/);
  });

  it('returns fail when latest row is more than 3 days stale', () => {
    const rows: SharpeRow[] = [
      { instance: 'spy-aggressive', snapshot_date: '2026-05-04', n_days: 18, created_at: NOW - 5 * DAY },
      { instance: 'spy-conservative', snapshot_date: '2026-05-08', n_days: 21, created_at: NOW - 2 * HOUR },
    ];
    const result = summarizeSharpeFreshness(rows, { nowMs: NOW });

    expect(result.status).toBe('fail');
    expect(result.state).toBe('stale');
    expect(result.detail).toMatch(/spy-aggressive/);
  });

  it('returns fail when an expected instance is missing after 5+ trading days', () => {
    const rows: SharpeRow[] = [
      { instance: 'spy-aggressive', snapshot_date: '2026-05-08', n_days: 7, created_at: NOW - 2 * HOUR },
    ];
    const result = summarizeSharpeFreshness(rows, {
      nowMs: NOW,
      tradingDaysSinceStart: 10,
    });

    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/spy-conservative missing/);
  });

  it('returns warn when an expected instance is missing but bot is too young to fail', () => {
    const rows: SharpeRow[] = [
      { instance: 'spy-aggressive', snapshot_date: '2026-05-08', n_days: 1, created_at: NOW - 2 * HOUR },
    ];
    const result = summarizeSharpeFreshness(rows, {
      nowMs: NOW,
      tradingDaysSinceStart: 1,
    });

    expect(result.status).toBe('warn');
    expect(result.detail).toMatch(/spy-conservative missing/);
  });

  it('picks the latest row per instance when multiple exist', () => {
    const rows: SharpeRow[] = [
      { instance: 'spy-aggressive', snapshot_date: '2026-05-06', n_days: 19, created_at: NOW - 3 * DAY },
      { instance: 'spy-aggressive', snapshot_date: '2026-05-08', n_days: 21, created_at: NOW - 2 * HOUR },
      { instance: 'spy-conservative', snapshot_date: '2026-05-08', n_days: 21, created_at: NOW - 2 * HOUR },
    ];
    const result = summarizeSharpeFreshness(rows, { nowMs: NOW });

    expect(result.status).toBe('pass');
  });
});
