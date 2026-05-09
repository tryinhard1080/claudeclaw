import { describe, expect, it } from 'vitest';
import type { Market } from './types.js';
import {
  WEATHER_SHADOW_PROMPT_VERSION,
  buildWeatherGoatForecastArgs,
  estimateWeatherProbability,
  evaluateWeatherShadow,
  extractForecastHigh,
  isWeatherMarket,
  parseWeatherMarket,
  resolveWeatherLocation,
} from './weather-shadow.js';

function mkMarket(overrides: Partial<Market> = {}): Market {
  return {
    slug: 'highest-temperature-in-seattle-on-april-24-2026-54-55f',
    conditionId: '0xabc',
    question: 'Will the highest temperature in Seattle be between 54-55°F on April 24?',
    category: null as unknown as string,
    outcomes: [
      { label: 'Yes', tokenId: 'tok-yes', price: 0.4 },
      { label: 'No', tokenId: 'tok-no', price: 0.6 },
    ],
    volume24h: 50_000,
    liquidity: 10_000,
    endDate: Date.parse('2026-04-25T00:00:00Z') / 1000,
    closed: false,
    ...overrides,
  };
}

describe('weather shadow market detection', () => {
  it('recognizes high-temperature weather markets', () => {
    expect(isWeatherMarket(mkMarket())).toBe(true);
    expect(isWeatherMarket(mkMarket({
      slug: 'highest-temperature-in-seoul-on-april-17-2026-18corhigher',
      question: 'Will the highest temperature in Seoul be 18°C or higher on April 17?',
    }))).toBe(true);
  });

  it('rejects sports and player-name false positives', () => {
    expect(isWeatherMarket(mkMarket({
      slug: 'will-the-miami-heat-win-the-2026-nba-finals',
      question: 'Will the Miami Heat win the 2026 NBA Finals?',
    }))).toBe(false);
    expect(isWeatherMarket(mkMarket({
      slug: 'will-the-carolina-hurricanes-win-the-2026-nhl-stanley-cup',
      question: 'Will the Carolina Hurricanes win the 2026 NHL Stanley Cup?',
    }))).toBe(false);
    expect(isWeatherMarket(mkMarket({
      slug: 'wta-krueger-hunter-2026-04-27',
      question: 'La Bisbal: Ashlyn Krueger vs Storm Hunter',
    }))).toBe(false);
  });
});

describe('parseWeatherMarket', () => {
  it('parses between-temperature markets and infers year from end date', () => {
    const parsed = parseWeatherMarket(mkMarket());
    expect(parsed).toEqual({
      kind: 'high_temp',
      city: 'Seattle',
      dateYmd: '2026-04-24',
      unit: 'fahrenheit',
      operator: 'between',
      low: 54,
      high: 55,
    });
  });

  it('parses celsius or-higher markets', () => {
    const parsed = parseWeatherMarket(mkMarket({
      slug: 'highest-temperature-in-seoul-on-april-17-2026-18corhigher',
      question: 'Will the highest temperature in Seoul be 18°C or higher on April 17?',
      endDate: Date.parse('2026-04-18T00:00:00Z') / 1000,
    }));
    expect(parsed).toEqual({
      kind: 'high_temp',
      city: 'Seoul',
      dateYmd: '2026-04-17',
      unit: 'celsius',
      operator: 'gte',
      threshold: 18,
    });
  });
});

describe('Weather Goat adapter helpers', () => {
  it('resolves known cities without the broken CLI geocoder', () => {
    expect(resolveWeatherLocation('Seattle')).toEqual({ latitude: 47.6062, longitude: -122.3321 });
    expect(resolveWeatherLocation('Hong Kong')).toEqual({ latitude: 22.3193, longitude: 114.1694 });
    expect(resolveWeatherLocation('New York City')).toEqual({ latitude: 40.7128, longitude: -74.006 });
    expect(resolveWeatherLocation('San Francisco')).toEqual({ latitude: 37.7749, longitude: -122.4194 });
    expect(resolveWeatherLocation('Singapore')).toEqual({ latitude: 1.3521, longitude: 103.8198 });
    expect(resolveWeatherLocation('Atlantis')).toBeNull();
  });

  it('builds coordinate forecast args with --forecast-days, not --days', () => {
    const spec = parseWeatherMarket(mkMarket({
      question: 'Will the highest temperature in Seattle be 70°F or higher on May 11?',
      endDate: Date.parse('2026-05-12T00:00:00Z') / 1000,
    }))!;
    const args = buildWeatherGoatForecastArgs(spec, resolveWeatherLocation('Seattle')!, Date.parse('2026-05-09T12:00:00Z') / 1000);
    expect(args).toContain('--forecast-days');
    expect(args).not.toContain('--days');
    expect(args).not.toContain('--select');
    expect(args).toEqual(expect.arrayContaining(['forecast', '--latitude', '47.6062', '--longitude', '-122.3321', '--forecast-days', '3', '--agent']));
  });

  it('extracts the target-date daily high from Weather Goat JSON', () => {
    const high = extractForecastHigh({
      results: {
        daily: {
          time: ['2026-05-09', '2026-05-10', '2026-05-11'],
          temperature_2m_max: [67.9, 64.8, 69],
        },
      },
    }, '2026-05-11');
    expect(high).toBe(69);
  });

  it('converts forecast-vs-threshold into bounded probabilities', () => {
    const gte = estimateWeatherProbability({
      kind: 'high_temp', city: 'Seattle', dateYmd: '2026-05-11',
      unit: 'fahrenheit', operator: 'gte', threshold: 65,
    }, 69);
    expect(gte?.probability).toBeGreaterThan(0.6);
    expect(gte?.confidence).toBe('medium');

    const exact = estimateWeatherProbability({
      kind: 'high_temp', city: 'Seattle', dateYmd: '2026-05-11',
      unit: 'fahrenheit', operator: 'exact', threshold: 65,
    }, 72);
    expect(exact?.probability).toBeLessThan(0.25);
  });

  it('evaluates a supported weather market through an injected runner', async () => {
    const estimate = await evaluateWeatherShadow({
      market: mkMarket({
        question: 'Will the highest temperature in Seattle be 65°F or higher on May 11?',
        endDate: Date.parse('2026-05-12T00:00:00Z') / 1000,
      }),
      bestAsk: 0.4,
      nowSec: Date.parse('2026-05-09T12:00:00Z') / 1000,
      runner: async (args) => {
        expect(args).toContain('--forecast-days');
        return {
          code: 0,
          stdout: JSON.stringify({
            results: {
              daily: {
                time: ['2026-05-09', '2026-05-10', '2026-05-11'],
                temperature_2m_max: [67.9, 64.8, 69],
              },
            },
          }),
          stderr: '',
        };
      },
    });
    expect(WEATHER_SHADOW_PROMPT_VERSION).toBe('v3-weather-shadow');
    expect(estimate?.probability).toBeGreaterThan(0.6);
    expect(estimate?.reasoning).toContain('Weather Goat forecast high');
    expect(estimate?.reasoning).toContain('target is 65F or higher');
  });
});
