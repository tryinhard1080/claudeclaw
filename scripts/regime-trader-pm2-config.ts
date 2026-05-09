export interface RegimeTraderPm2App {
  name: string;
  cwd: string;
  script: string;
  interpreter: string;
  args: string;
  autorestart: false;
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
  const python = `${root}/.venv/Scripts/python.exe`;
  const script = `${root}/main.py`;
  const base = {
    cwd: root,
    script,
    interpreter: python,
    autorestart: false as const,
    cron_restart: '30 9 * * 1-5',
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
