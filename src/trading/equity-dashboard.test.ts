import { describe, expect, it } from 'vitest';

import {
  buildEquityDashboardPayload,
  type EquityBrokerSnapshot,
} from './equity-dashboard.js';

const broker: EquityBrokerSnapshot = {
  status: 'ACTIVE',
  equity: 105_000,
  cash: 92_000,
  buyingPower: 198_000,
  portfolioValue: 105_000,
  source: 'alpaca',
  paperTrading: true,
  baseUrl: 'https://paper-api.alpaca.markets',
  positions: [{
    symbol: 'SPY',
    qty: 17,
    marketValue: 12_750,
    unrealizedPnl: 330,
    unrealizedPnlPct: 0.026,
    currentPrice: 750,
    avgEntryPrice: 730,
  }],
  recentOrders: [{
    submittedAt: '2026-06-01T15:35:01Z',
    filledAt: '2026-06-01T15:35:03Z',
    symbol: 'SPY',
    side: 'sell',
    qty: 1,
    filledQty: 1,
    status: 'filled',
    orderType: 'limit',
    limitPrice: 756.28,
    filledAvgPrice: 757,
  }],
};

describe('buildEquityDashboardPayload', () => {
  it('summarizes active Alpaca paper exposure from broker truth', () => {
    const payload = buildEquityDashboardPayload({
      nowMs: 1_780_328_800_000,
      states: {
        'spy-aggressive': {
          market_open: true,
          execution_enabled: true,
          equity: 104_900,
          cash: 92_000,
          buying_power: 198_000,
          regime: { label: 'NEUTRAL', confidence: 1, vol_rank: 0.8333 },
          risk: { daily_dd_pct: 0.001, peak_dd_pct: 0, circuit_breakers: {} },
          positions: [{ symbol: 'SPY', quantity: 18, market_value: 13_500, unrealized_pl: 300 }],
          recent_signals: [{
            time: '2026-06-01T15:40:30Z',
            strategy: 'high_vol_defensive',
            target_allocation: 0.15,
            approved_allocation: 0.1225,
            should_rebalance: true,
            action: 'approved',
          }],
          session_trades: 2,
          updated_at: '2026-06-01T15:40:46Z',
        },
        'spy-conservative': {
          market_open: true,
          execution_enabled: false,
          equity: 104_900,
          cash: 92_000,
          buying_power: 198_000,
          positions: [{ symbol: 'SPY', quantity: 18, market_value: 13_500, unrealized_pl: 300 }],
          updated_at: '2026-06-01T15:40:47Z',
        },
      },
      stateMtimes: {
        'spy-aggressive': 1_780_328_790_000,
        'spy-conservative': 1_780_328_791_000,
      },
      broker,
    });

    expect(payload.status).toBe('pass');
    expect(payload.activeInstance?.id).toBe('spy-aggressive');
    expect(payload.activeInstance?.mode).toBe(null);
    expect(payload.activeInstance?.strategy).toBe('high_vol_defensive');
    expect(payload.activeInstance?.sessionTrades).toBe(2);
    expect(payload.activeInstance?.latestSignalAgeSec).toBe(370);
    expect(payload.instances.find(i => i.id === 'spy-conservative')?.role).toBe('shadow');
    expect(payload.aggregate.exposureUsd).toBe(12_750);
    expect(payload.aggregate.currentAllocation).toBeCloseTo(12_750 / 105_000, 6);
    expect(payload.aggregate.targetAllocation).toBe(0.1225);
    expect(payload.broker?.recentOrders[0]?.status).toBe('filled');
    expect(payload.broker?.paperTrading).toBe(true);
  });

  it('warns when broker data is unavailable but state files are readable', () => {
    const payload = buildEquityDashboardPayload({
      nowMs: 1_780_328_800_000,
      states: {
        'spy-aggressive': {
          market_open: true,
          execution_enabled: true,
          equity: 100_000,
          cash: 90_000,
          buying_power: 180_000,
          positions: [{ symbol: 'SPY', quantity: 10, market_value: 7_500, unrealized_pl: 100 }],
          recent_signals: [{ target_allocation: 0.15, strategy: 'high_vol_defensive', rejection_reason: 'Max daily trades reached' }],
          session_trades: 0,
        },
        'spy-conservative': {
          market_open: true,
          execution_enabled: false,
          equity: 100_000,
          cash: 90_000,
          buying_power: 180_000,
        },
      },
      stateMtimes: {
        'spy-aggressive': 1_780_328_790_000,
        'spy-conservative': 1_780_328_790_000,
      },
      broker: null,
    });

    expect(payload.status).toBe('warn');
    expect(payload.detail).toContain('broker snapshot unavailable');
    expect(payload.aggregate.exposureUsd).toBe(7_500);
    expect(payload.activeInstance?.latestRejectionReason).toBe('Max daily trades reached');
  });

  it('fails when Alpaca broker snapshot is not from the paper endpoint', () => {
    const payload = buildEquityDashboardPayload({
      nowMs: 1_780_328_800_000,
      states: {
        'spy-aggressive': {
          mode: 'paper',
          market_open: true,
          execution_enabled: true,
          equity: 105_000,
          cash: 92_000,
          buying_power: 198_000,
          recent_signals: [{ target_allocation: 0.15, strategy: 'high_vol_defensive' }],
        },
      },
      stateMtimes: {
        'spy-aggressive': 1_780_328_790_000,
      },
      broker: {
        ...broker,
        paperTrading: false,
        baseUrl: 'https://api.alpaca.markets',
      },
    });

    expect(payload.status).toBe('fail');
    expect(payload.detail).toContain('non-paper endpoint');
  });
});
