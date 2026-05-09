import { describe, expect, it } from 'vitest';

import {
  buildTradingOpsPayload,
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
