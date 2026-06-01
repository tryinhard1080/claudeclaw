import { describe, expect, it } from 'vitest';
import type { Market } from './types.js';
import { evaluateMarketQuality } from './market-quality.js';

function mkMarket(overrides: Partial<Market> = {}): Market {
  return {
    slug: 'will-x-happen',
    conditionId: '0xabc',
    question: 'Will X happen?',
    category: 'politics',
    outcomes: [
      { label: 'Yes', tokenId: 'yes', price: 0.4 },
      { label: 'No', tokenId: 'no', price: 0.6 },
    ],
    volume24h: 50_000,
    liquidity: 10_000,
    endDate: 1_700_000_000 + 10 * 86400,
    closed: false,
    ...overrides,
  };
}

describe('evaluateMarketQuality', () => {
  const nowSec = 1_700_000_000;

  it('passes normal markets inside the active TTL band', () => {
    const decision = evaluateMarketQuality(mkMarket(), {
      nowSec,
      ttlFilterEnabled: true,
      minTtlDays: 1,
      maxTtlDays: 30,
      marketQualityFilterEnabled: true,
    });
    expect(decision.passed).toBe(true);
  });

  it('rejects markets beyond the active TTL band', () => {
    const decision = evaluateMarketQuality(mkMarket({
      slug: 'will-x-happen-in-2028',
      endDate: nowSec + 200 * 86400,
    }), {
      nowSec,
      ttlFilterEnabled: true,
      minTtlDays: 1,
      maxTtlDays: 30,
    });
    expect(decision).toMatchObject({ passed: false, code: 'ttl_too_long' });
  });

  it('rejects the prophecy joke-market pattern that polluted paper trading', () => {
    const decision = evaluateMarketQuality(mkMarket({
      slug: 'will-jesus-christ-return-before-gta-vi-665',
      question: 'Will Jesus Christ return before GTA VI?',
    }), {
      nowSec,
      marketQualityFilterEnabled: true,
    });
    expect(decision).toMatchObject({ passed: false, code: 'untradeable_question' });
  });
});

