# Regime Trader PM2 Runbook

## Trigger

Use this when rebuilding the Regime Trader PM2 manifest, checking the weekday market-open cron, or investigating `instance_down` alerts from the equity bridge.

## Preconditions

- ClaudeClaw remains the orchestrator. Regime Trader is owned by `C:\Code\regime-trader`.
- Regime Trader stays paper-only from ClaudeClaw's perspective.
- Do not restart ClaudeClaw just to inspect Regime Trader PM2 state.

## Operating Behavior

Regime Trader can be stopped on weekends or after a clean market-closed exit. That is expected. The process is scheduled by PM2 with:

```powershell
cron_restart = 30 8 * * 1-5
autorestart = true
stop_exit_codes = 0
interpreter = C:\Code\regime-trader\.venv\Scripts\pythonw.exe
windowsHide = true
```

The cron is evaluated in system local time. On this host, `30 8 * * 1-5` is 08:30 CT, which is 09:30 ET market open.

`pythonw.exe` is intentional on Windows. It uses the same virtual environment as `python.exe`, but does not allocate a visible Windows Terminal or conhost window when PM2 starts the paper workers.

`stop_exit_codes = 0` keeps clean closed-market exits quiet while allowing PM2 to recover crashes, API failures, or console terminations.

## Regenerate Config

```powershell
npm run trading:pm2:write
```

The script writes:

```text
C:\Users\Richard\.claudeclaw\regime-trader.pm2.json
```

Then apply it:

```powershell
pm2 start C:\Users\Richard\.claudeclaw\regime-trader.pm2.json
pm2 save
```

## Verify PM2 Paths

```powershell
pm2 describe regime-trader-spy-agg
pm2 describe regime-trader-spy-cons
```

Expected paths:

```text
cwd         C:\Code\regime-trader
script      C:\Code\regime-trader\main.py
interpreter C:\Code\regime-trader\.venv\Scripts\pythonw.exe
```

Expected args:

```text
--paper --instance spy-aggressive
--paper --instance spy-conservative
```

## Confirm Fresh State Files

```powershell
Get-Content C:\Code\regime-trader\instances\spy-aggressive\data\state.json -TotalCount 40
Get-Content C:\Code\regime-trader\instances\spy-conservative\data\state.json -TotalCount 40
npm run trading:status
```

Before the next market open, closed-market state with a future `next_open` is healthy. After market open plus the grace window, stale closed-market state is a failure.

## Rollback

If the generated manifest points at the wrong path, do not start it. Fix `scripts/regime-trader-pm2-config.ts`, rerun the config test, regenerate the JSON, then re-apply PM2.

If PM2 starts the wrong process, stop only the Regime Trader apps:

```powershell
pm2 stop regime-trader-spy-agg
pm2 stop regime-trader-spy-cons
```

ClaudeClaw can continue running while Regime Trader PM2 is corrected.

## Outcome Signature

Record durable PM2 changes in `docs/runbooks/trading-drill-log.md` or `MISSION.md` only after both `pm2 describe` checks show `C:\Code\regime-trader`.
