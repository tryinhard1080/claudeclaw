# Market-Open Trading Drill

## Trigger

Run this on the next regular U.S. equity market open after changes to Regime Trader PM2, trading state parsing, dashboard ops status, or alert routing.

For this plan, the first eligible drill window is Monday 2026-05-11.

## Preconditions

- ClaudeClaw remains in paper-trading mode.
- No live-capital flags are enabled.
- Regime Trader PM2 entries point at `C:\Code\regime-trader`.
- `npm run trading:status` has no FAIL rows before the drill, except issues explicitly marked as not blocking equities.
- Operator is available to watch Telegram and dashboard responses.

## Schedule

| Time Central | Time Eastern | Check |
|---|---:|---|
| 8:20 AM | 9:20 AM | Preflight |
| 8:30 AM | 9:30 AM | Confirm Regime Trader cron starts |
| 8:35 AM | 9:35 AM | Confirm state files move to open-market full state |
| 8:40 AM | 9:40 AM | Confirm `/trade status`, `/poly status`, and dashboard |
| 9:00 AM | 10:00 AM | Confirm no repeated stale/down alerts |

## Procedure

### 8:20 AM CT Preflight

```powershell
npm run status
npm run trading:status
pm2 list
pm2 describe claudeclaw-main
pm2 describe regime-trader-spy-agg
pm2 describe regime-trader-spy-cons
```

Expected:

- `claudeclaw-main` online.
- Regime Trader entries have `cron restart = 30 9 * * 1-5`.
- Regime Trader paths point at `C:\Code\regime-trader`.
- Closed-market state before `next_open` is not treated as stale.

### 8:30 AM CT Cron Start

```powershell
pm2 list
pm2 logs regime-trader-spy-agg --lines 80 --nostream
pm2 logs regime-trader-spy-cons --lines 80 --nostream
```

Expected:

- Both Regime Trader apps start at market open or produce a clear market/opening diagnostic.
- No path points at `C:\Projects`.

### 8:35 AM CT State Transition

```powershell
Get-Content C:\Code\regime-trader\instances\spy-aggressive\data\state.json -TotalCount 40
Get-Content C:\Code\regime-trader\instances\spy-conservative\data\state.json -TotalCount 40
npm run trading:status
```

Expected:

- `market_open=true`.
- Full state includes `regime`, `risk`, `positions`, and `recent_signals`.
- `npm run trading:status` shows no Regime Trader stale/down failure.

### 8:40 AM CT Operator Surface

Use Telegram:

```text
/trade status
/poly status
```

Open dashboard:

```text
http://localhost:3141
```

Expected:

- `/trade status` renders both instances without optional-field errors.
- `/poly status` still responds.
- Dashboard health remains available.

### 9:00 AM CT Alert Quiet Period

```powershell
pm2 logs claudeclaw-main --lines 80 --nostream
pm2 logs regime-trader-spy-agg --lines 80 --nostream
pm2 logs regime-trader-spy-cons --lines 80 --nostream
npm run trading:status
```

Expected:

- No repeated `instance_stale` alerts after fresh state exists.
- No repeated `instance_down` alerts after PM2 starts.
- No crash-looping or unstable restarts.

## Pass Criteria

- ClaudeClaw PM2 online.
- Both Regime Trader instances start at cron.
- State files update within 10 minutes of market open.
- No repeated `instance_stale` or `instance_down` alerts after state refresh.
- Dashboard and Telegram commands respond.

## Fail Criteria

- PM2 points at `C:\Projects`.
- State files do not update.
- Regime Trader exits because of missing credentials.
- ClaudeClaw reports stale after fresh state exists.
- Telegram or dashboard surface crashes on partial or full state.

## Rollback

If Regime Trader PM2 is wrong:

```powershell
pm2 stop regime-trader-spy-agg
pm2 stop regime-trader-spy-cons
npm run trading:pm2:write
pm2 start C:\Users\Richard\.claudeclaw\regime-trader.pm2.json
pm2 save
```

If ClaudeClaw reports stale despite fresh state, do not restart repeatedly. Capture:

```powershell
pm2 logs claudeclaw-main --lines 200 --nostream
npm run trading:status
Get-Content C:\Code\regime-trader\instances\spy-aggressive\data\state.json -TotalCount 80
```

Then fix the parser or state-poller root cause.

## Outcome Signature

Record the drill result in `docs/runbooks/market-open-drill-results-template.md` copied into a dated result note, or append it to `docs/runbooks/trading-drill-log.md` once that log exists.
