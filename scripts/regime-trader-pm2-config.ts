export interface RegimeTraderPm2App {
  name: string;
  cwd: string;
  script: string;
  interpreter: string;
  windowsHide: true;
  args: string;
  autorestart: true;
  stop_exit_codes: number[];
  restart_delay: number;
  cron_restart: string;
  out_file: string;
  error_file: string;
}

export interface RegimeTraderPm2Config {
  apps: RegimeTraderPm2App[];
}

export function buildRegimeTraderPm2Config(
  root = 'C:/Code/regime-trader',
  logRoot = 'C:/Users/Richard/.pm2/logs',
): RegimeTraderPm2Config {
  const python = `${root}/.venv/Scripts/pythonw.exe`;
  const script = `${root}/main.py`;
  const base = {
    cwd: root,
    script,
    interpreter: python,
    // python.exe can allocate a visible Windows Terminal/conhost when PM2 starts
    // the venv launcher. pythonw.exe keeps the same venv but stays headless.
    windowsHide: true as const,
    autorestart: true as const,
    // main.py returns 0 for planned closed-market shutdowns. Abnormal Windows
    // console terminations, crashes, and API failures should recover under PM2.
    stop_exit_codes: [0],
    restart_delay: 30_000,
    // 08:30 CT = 09:30 ET = NYSE open. PM2 evaluates this in system local time
    // (US Central); both CT and ET observe DST in lockstep so the 1-hour offset
    // is constant year-round.
    cron_restart: '30 8 * * 1-5',
  };

  return {
    apps: [
      {
        ...base,
        name: 'regime-trader-spy-agg',
        args: '--paper --instance spy-aggressive',
        out_file: `${logRoot}/regime-trader-spy-agg-out.log`,
        error_file: `${logRoot}/regime-trader-spy-agg-error.log`,
      },
      {
        ...base,
        name: 'regime-trader-spy-cons',
        args: '--paper --instance spy-conservative',
        out_file: `${logRoot}/regime-trader-spy-cons-out.log`,
        error_file: `${logRoot}/regime-trader-spy-cons-error.log`,
      },
    ],
  };
}
