import { describe, expect, it } from 'vitest';

import {
  buildWeatherShadowReport,
  formatWeatherShadowReport,
} from './poly-weather-shadow-report.js';

const nowSec = Math.floor(Date.parse('2026-05-09T15:00:00Z') / 1000);

describe('buildWeatherShadowReport', () => {
  it('summarizes coverage, resolved Brier, and primary-strategy overlap', () => {
    const report = buildWeatherShadowReport({
      nowSec,
      markets: [
        {
          slug: 'highest-temperature-in-seattle-on-may-11-2026-65forhigher',
          question: 'Will the highest temperature in Seattle be 65°F or higher on May 11?',
          end_date: Math.floor(Date.parse('2026-05-12T00:00:00Z') / 1000),
        },
        {
          slug: 'highest-temperature-in-atlantis-on-may-11-2026-65forhigher',
          question: 'Will the highest temperature in Atlantis be 65°F or higher on May 11?',
          end_date: Math.floor(Date.parse('2026-05-12T00:00:00Z') / 1000),
        },
        {
          slug: 'will-the-weather-delay-the-match',
          question: 'Will weather delay the championship match?',
          end_date: Math.floor(Date.parse('2026-05-12T00:00:00Z') / 1000),
        },
      ],
      signals: [
        {
          created_at: nowSec - 60,
          market_slug: 'highest-temperature-in-seattle-on-may-11-2026-65forhigher',
          outcome_token_id: 'yes-sea',
          outcome_label: 'Yes',
          estimated_prob: 0.7,
          prompt_version: 'v3-weather-shadow',
          paper_trade_id: null,
          rejection_reasons: 'shadow:weather',
        },
        {
          created_at: nowSec - 120,
          market_slug: 'highest-temperature-in-seattle-on-may-11-2026-65forhigher',
          outcome_token_id: 'yes-sea',
          outcome_label: 'Yes',
          estimated_prob: 0.6,
          prompt_version: 'v3',
          paper_trade_id: 11,
          rejection_reasons: null,
        },
      ],
      resolutions: [
        {
          slug: 'highest-temperature-in-seattle-on-may-11-2026-65forhigher',
          closed: 1,
          outcomes_json: JSON.stringify([
            { label: 'Yes', tokenId: 'yes-sea', price: 1 },
            { label: 'No', tokenId: 'no-sea', price: 0 },
          ]),
        },
      ],
    });

    expect(report.markets.totalCandidates).toBe(3);
    expect(report.markets.parsedWeatherMarkets).toBe(2);
    expect(report.markets.unsupportedParseCount).toBe(1);
    expect(report.markets.unsupportedLocationCount).toBe(1);
    expect(report.markets.byCity).toEqual([
      { city: 'Atlantis', total: 1, supported: false, shadowRows: 0 },
      { city: 'Seattle', total: 1, supported: true, shadowRows: 1 },
    ]);
    expect(report.signals.shadowRows).toBe(1);
    expect(report.signals.shadowPaperTradeLinks).toBe(0);
    expect(report.resolved.resolvedShadowRows).toBe(1);
    expect(report.resolved.brierScore).toBeCloseTo(0.09, 5);
    expect(report.overlap.primaryOverlapRows).toBe(1);
    expect(report.overlap.resolvedPairedRows).toBe(1);
    expect(report.overlap.shadowBrierScore).toBeCloseTo(0.09, 5);
    expect(report.overlap.primaryBrierScore).toBeCloseTo(0.16, 5);
    expect(report.recommendation).toBe('keep_shadow_only_collect_more_data');
  });

  it('flags any weather shadow row linked to a paper trade', () => {
    const report = buildWeatherShadowReport({
      nowSec,
      markets: [],
      signals: [
        {
          created_at: nowSec,
          market_slug: 'weather-row',
          outcome_token_id: 'yes',
          outcome_label: 'Yes',
          estimated_prob: 0.55,
          prompt_version: 'v3-weather-shadow',
          paper_trade_id: 99,
          rejection_reasons: 'shadow:weather',
        },
      ],
      resolutions: [],
    });

    expect(report.signals.shadowPaperTradeLinks).toBe(1);
    expect(report.recommendation).toBe('investigate_shadow_trade_link');
  });
});

describe('formatWeatherShadowReport', () => {
  it('prints a concise operator report', () => {
    const report = buildWeatherShadowReport({
      nowSec,
      markets: [],
      signals: [],
      resolutions: [],
    });

    expect(formatWeatherShadowReport(report)).toContain('Weather Goat Shadow Report');
    expect(formatWeatherShadowReport(report)).toContain('Recommendation');
  });
});
