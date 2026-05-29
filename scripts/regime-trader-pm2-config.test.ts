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
      expect(app.autorestart).toBe(true);
      expect(app.stop_exit_codes).toEqual([0]);
      expect(app.restart_delay).toBe(30_000);
      // Cron is evaluated in system local time (US Central). 08:30 CT = 09:30 ET
      // = NYSE open. CT and ET both observe DST identically, so the 1-hour offset
      // is constant year-round. The 2026-05-11 drill caught the prior `30 9` form
      // firing at 10:30 ET daily, missing the first hour of trading.
      expect(app.cron_restart).toBe('30 8 * * 1-5');
    }

    expect(config.apps[0]?.args).toBe('--paper --instance spy-aggressive');
    expect(config.apps[1]?.args).toBe('--paper --instance spy-conservative');
  });
});
