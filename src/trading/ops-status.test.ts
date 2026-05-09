import { describe, expect, it } from 'vitest';

import {
  summarizeFinancialDatasetsMcp,
  summarizePm2Apps,
  summarizePolyScanRuns,
  summarizeRegimeState,
  summarizeWeatherGoatDoctor,
} from './ops-status.js';

const NOW = Date.parse('2026-05-09T14:00:00.000Z');

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
});

describe('summarizeFinancialDatasetsMcp', () => {
  it('returns needs_auth when Claude MCP reports authentication is required', () => {
    const result = summarizeFinancialDatasetsMcp('financial-datasets: https://mcp.financialdatasets.ai/ (HTTP) - Needs authentication');

    expect(result.status).toBe('warn');
    expect(result.state).toBe('needs_auth');
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
