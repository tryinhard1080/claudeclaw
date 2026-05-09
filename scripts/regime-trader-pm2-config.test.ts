import { describe, expect, it } from 'vitest';

import { buildRegimeTraderPm2Config } from './regime-trader-pm2-config.js';

describe('buildRegimeTraderPm2Config', () => {
  it('generates durable PM2 entries for both SPY paper instances', () => {
    const config = buildRegimeTraderPm2Config();

    expect(config.apps.map(app => app.name)).toEqual([
      'regime-trader-spy-agg',
      'regime-trader-spy-cons',
    ]);

    for (const app of config.apps) {
      expect(app.cwd).toBe('C:/Code/regime-trader');
      expect(app.script).toBe('C:/Code/regime-trader/main.py');
      expect(app.interpreter).toBe('C:/Code/regime-trader/.venv/Scripts/python.exe');
      expect(app.autorestart).toBe(false);
      expect(app.cron_restart).toBe('30 9 * * 1-5');
    }

    expect(config.apps[0]?.args).toBe('--paper --instance spy-aggressive');
    expect(config.apps[1]?.args).toBe('--paper --instance spy-conservative');
  });
});
