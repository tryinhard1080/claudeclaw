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
cron_restart = 30 9 * * 1-5
autorestart = false
```

`autorestart=false` is intentional. If the Python process exits because the market is closed, PM2 should not keep relaunching it. If it exits during market hours, diagnose the Python logs and state files before changing restart policy.

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
interpreter C:\Code\regime-trader\.venv\Scripts\python.exe
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
