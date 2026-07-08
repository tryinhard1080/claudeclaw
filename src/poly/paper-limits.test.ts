import { describe, expect, it } from 'vitest';

import { buildPaperLimitSummary } from './paper-limits.js';

describe('buildPaperLimitSummary', () => {
  it('reports remaining paper slots and deployed-cap math', () => {
    const limits = buildPaperLimitSummary({
      openTradeCount: 20,
      openExposureUsd: 938.8,
      config: {
        paperCapitalUsd: 5000,
        maxTradeUsd: 50,
        maxOpenPositions: 30,
        maxDeployedPct: 0.5,
      },
    });

    expect(limits.maxOpenPositions).toBe(30);
    expect(limits.openSlotsRemaining).toBe(10);
    expect(limits.maxTradeUsd).toBe(50);
    expect(limits.maxDeployedUsd).toBe(2500);
    expect(limits.deployedRemainingUsd).toBeCloseTo(1561.2, 6);
    expect(limits.deployedPct).toBeCloseTo(0.18776, 6);
  });
});
