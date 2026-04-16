// pm2 ecosystem for the regime-trader Python sidecar.
// Designed to auto-start on weekday market open (09:30 ET) and let the
// process exit naturally at close (regime-trader's main.py exits when
// market is CLOSED). pm2 cron_restart re-launches it weekday 09:30 ET.
//
// Usage:
//   pm2 start ecosystem.regime-trader.config.js
//   pm2 save
//
// TZ for cron_restart is the system TZ. If the host is in ET, use
// '30 9 * * 1-5'. If UTC, adjust for DST — ET market open is 13:30 UTC
// (winter) or 14:30 UTC (summer/DST). Recommend running the host in ET
// or converting on-the-fly; the cron below assumes ET.
module.exports = {
  apps: [
    {
      name: 'regime-trader-spy-agg',
      script: 'main.py',
      args: '--paper --instance spy-aggressive',
      interpreter: 'python',
      cwd: 'C:/Projects/regime-trader',
      autorestart: false,
      cron_restart: '30 9 * * 1-5',
      out_file: 'C:/Users/Richard/.pm2/logs/regime-trader-spy-agg-out.log',
      error_file: 'C:/Users/Richard/.pm2/logs/regime-trader-spy-agg-error.log',
    },
    {
      name: 'regime-trader-spy-cons',
      script: 'main.py',
      args: '--paper --instance spy-conservative',
      interpreter: 'python',
      cwd: 'C:/Projects/regime-trader',
      autorestart: false,
      cron_restart: '30 9 * * 1-5',
      out_file: 'C:/Users/Richard/.pm2/logs/regime-trader-spy-cons-out.log',
      error_file: 'C:/Users/Richard/.pm2/logs/regime-trader-spy-cons-error.log',
    },
  ],
};
