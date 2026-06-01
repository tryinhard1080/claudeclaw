import { describe, expect, it } from 'vitest';

import { CONFIG_ENV_KEYS } from './config.js';

describe('CONFIG_ENV_KEYS', () => {
  it('allows every advanced Polymarket strategy flag exported by config.ts', () => {
    expect(CONFIG_ENV_KEYS).toEqual(expect.arrayContaining([
      'POLY_KELLY_LOW_MULT',
      'POLY_KELLY_MED_MULT',
      'POLY_KELLY_HIGH_MULT',
      'POLY_REFLECTION_ENABLED',
      'POLY_EXIT_ENABLED',
      'POLY_TAKE_PROFIT_PCT',
      'POLY_STOP_LOSS_PCT',
      'POLY_EXPOSURE_AWARE_SIZING',
    ]));
  });

  it('allows both live execution tripwire flags', () => {
    expect(CONFIG_ENV_KEYS).toEqual(expect.arrayContaining([
      'EQUITY_LIVE_EXECUTION_ENABLED',
      'POLYMARKET_US_LIVE_EXECUTION_ENABLED',
    ]));
  });
});
