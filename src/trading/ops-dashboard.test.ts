import { describe, expect, it } from 'vitest';

import {
  buildTradingOpsPayload,
  resetDashboardMcpCacheForTest,
  summarizeDashboardMcp,
  type TradingOpsPaperSummary,
} from './ops-dashboard.js';
import type { OpsCheck } from './ops-status.js';

const checks: OpsCheck[] = [
  { name: 'PM2', status: 'pass', state: 'healthy', detail: 'expected apps online' },
  { name: 'Weather Goat', status: 'pass', state: 'healthy', detail: 'Open-Meteo reachable; auth not required' },
  { name: 'Financial Datasets MCP', status: 'warn', state: 'needs_auth', detail: 'financial-datasets needs auth' },
  { name: 'Polymarket scans', status: 'pass', state: 'fresh', detail: 'last ok scan 1m ago; markets=863' },
  { name: 'Regime spy-aggressive', status: 'pass', state: 'closed_until_next_open', detail: 'next open 2026-05-11T13:30:00.000Z' },
  { name: 'Regime spy-conservative', status: 'pass', state: 'closed_until_next_open', detail: 'next open 2026-05-11T13:30:00.000Z' },
];

const paper: TradingOpsPaperSummary = {
  signals24h: 112,
  approved24h: 0,
  openPositions: 10,
  realizedPnlToday: 0,
};

describe('buildTradingOpsPayload', () => {
  it('keeps dashboard status aligned to the worst readiness check', () => {
    const payload = buildTradingOpsPayload({
      generatedAt: 1_800_000_000,
      checks,
      paper,
    });

    expect(payload.status).toBe('warn');
    expect(payload.generatedAt).toBe(1_800_000_000);
    expect(payload.paper.openPositions).toBe(10);
    expect(payload.checks.financialDatasets?.state).toBe('needs_auth');
    expect(payload.checks.pm2?.status).toBe('pass');
    expect(payload.checks.regimes).toHaveLength(2);
  });
});

describe('summarizeDashboardMcp', () => {
  it('returns connected status from a live Claude MCP listing', () => {
    resetDashboardMcpCacheForTest();
    let timeoutMs = 0;

    const check = summarizeDashboardMcp({
      commandRunner: (_command, timeout) => {
        timeoutMs = timeout ?? 0;
        return {
          ok: true,
          output: 'financial-datasets: https://mcp.financialdatasets.ai/api (HTTP) - ✓ Connected',
        };
      },
      nowMs: 1_800_000_000_000,
    });

    expect(check.status).toBe('pass');
    expect(check.state).toBe('connected');
    expect(timeoutMs).toBe(30_000);
  });

  it('reuses a fresh dashboard MCP cache instead of spawning every refresh', () => {
    resetDashboardMcpCacheForTest();
    let calls = 0;

    const first = summarizeDashboardMcp({
      commandRunner: () => {
        calls += 1;
        return {
          ok: true,
          output: 'financial-datasets: https://mcp.financialdatasets.ai/api (HTTP) - ✓ Connected',
        };
      },
      nowMs: 1_800_000_000_000,
    });
    const second = summarizeDashboardMcp({
      commandRunner: () => {
        calls += 1;
        return {
          ok: false,
          output: 'should not be called',
        };
      },
      nowMs: 1_800_000_030_000,
    });

    expect(first.status).toBe('pass');
    expect(second.status).toBe('pass');
    expect(calls).toBe(1);
  });
});
