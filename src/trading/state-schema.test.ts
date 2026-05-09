import { describe, expect, it } from 'vitest';

import {
  isClosedUntilNextOpen,
  isFullRegimeState,
  parseInstanceState,
} from './state-schema.js';

const fullOpenState = {
  mode: 'paper',
  market_open: true,
  equity: 101000,
  cash: 99000,
  buying_power: 99000,
  regime: {
    bar: 1,
    date: '2026-05-11T13:35:00.000Z',
    regime: 'STRONG_BULL',
    confidence: 0.82,
    vol_rank: 0.4,
    target_allocation: 0.7,
  },
  risk: {
    daily_dd_pct: 0.01,
    peak_dd_pct: 0.03,
    leverage: 1,
    circuit_breakers: { max_loss: false },
  },
  positions: [],
  recent_signals: [],
};

describe('parseInstanceState', () => {
  it('accepts full open-market state with regime, risk, positions, and recent signals', () => {
    const result = parseInstanceState(fullOpenState);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isFullRegimeState(result.state)).toBe(true);
    }
  });

  it('accepts partial closed-market state with next_open, equity, and cash', () => {
    const result = parseInstanceState({
      mode: 'paper',
      market_open: false,
      next_open: '2026-05-11T13:30:00.000Z',
      equity: 100000,
      cash: 100000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isFullRegimeState(result.state)).toBe(false);
    }
  });

  it('rejects state missing market_open', () => {
    const result = parseInstanceState({
      mode: 'paper',
      equity: 100000,
      cash: 100000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('market_open');
    }
  });
});

describe('isClosedUntilNextOpen', () => {
  it('classifies future next_open state as intentionally paused', () => {
    const result = parseInstanceState({
      mode: 'paper',
      market_open: false,
      next_open: '2026-05-11T13:30:00.000Z',
      equity: 100000,
      cash: 100000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isClosedUntilNextOpen(result.state, Date.parse('2026-05-09T15:00:00.000Z'))).toBe(true);
    }
  });

  it('does not classify past next_open state as intentionally paused after grace', () => {
    const result = parseInstanceState({
      mode: 'paper',
      market_open: false,
      next_open: '2026-05-11T13:30:00.000Z',
      equity: 100000,
      cash: 100000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isClosedUntilNextOpen(
        result.state,
        Date.parse('2026-05-11T13:45:01.000Z'),
        10 * 60 * 1000,
      )).toBe(false);
    }
  });
});
