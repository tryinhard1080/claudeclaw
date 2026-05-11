# Trading Drill Log

## 2026-05-09 Operational Readiness Drills

Environment:

- Worktree: `C:\Users\Richard\.config\superpowers\worktrees\claudeclaw\trading-operational-readiness`
- Store: `C:\claudeclaw-store`
- Date: Saturday, 2026-05-09
- Live-capital status: not enabled

### Halt/Resume Drill

Command:

```powershell
$env:STORE_DIR='C:\claudeclaw-store'; npx tsx scripts/drill-halt-resume.ts
```

Result: PASS

Key output:

```text
start:        2026-05-09T14:28:06.276Z
pre halt:     0
pre open:     10
after set:    1
after clear:  0
end:          2026-05-09T14:28:10.296Z
post open:    10  (delta from pre: 0)
```

Notes:

- `poly.halt` was set to `1` and then cleared to `0`.
- Open paper positions did not change.
- No PM2 restart was performed.

### DB Restore Drill

Command:

```powershell
$env:STORE_DIR='C:\claudeclaw-store'; npx tsx scripts/drill-db-restore.ts
```

Result: PASS

Key output:

```text
start:          2026-05-09T14:28:16.060Z
source backup:  C:\claudeclaw-store\backup-2026-05-09
sha256 verify:  OK (d3917d207a8a664a...)
tables:         29
poly_paper_trades        31
poly_signals             35935
poly_resolutions         79
poly_scan_runs           5809
poly_kv                  5
open=10  won=0  lost=0
end:            2026-05-09T14:28:16.429Z
```

Notes:

- Backup hash matched the recorded SHA256 file.
- Copy hash matched the source backup.
- Restored DB was opened read-only from a scratch temp directory.
- Live DB was not restored over or replaced.

### DB Bloat Check

Command:

```powershell
$env:STORE_DIR='C:\claudeclaw-store'; npx tsx scripts/check-db-bloat.ts
```

Result: PASS

Key output:

```text
claudeclaw.db          0.194 GB
claudeclaw.db-wal      0.009 GB
claudeclaw.db-shm      0.000 GB
poly_markets                         175,862 rows
poly_eval_cache                      81,781 rows
poly_signals                         36,072 rows
poly_scan_runs                       5,829 rows
poly_price_history                   840 rows
poly_price_history oldest=2026-05-09T12:51:29.000Z, newest=2026-05-09T14:25:52.000Z
rows older than 36h: 0
```

Notes:

- DB and WAL sizes were within practical operating range.
- Price history pruning target is working: zero rows older than 36 hours.

### Remaining Drill Gate

The Monday market-open drill cannot be completed on Saturday, 2026-05-09. First eligible window is Monday, 2026-05-11 at 8:20 AM Central / 9:20 AM Eastern, following [`market-open-drill.md`](market-open-drill.md).

## 2026-05-11 Market-Open Drill

Environment:

- Workspace: `C:\Code\claudeclaw` (main, post-hotfix `fb48f5c`)
- Store: `C:\claudeclaw-store`
- Date: Monday, 2026-05-11
- Live-capital status: not enabled
- Drill ran during the operational-readiness plan execution (`C:\Users\Richard\.claude\plans\review-this-code-base-rustling-whistle.md`, Phase 1).

### Result: **FAIL** — two independent bugs surfaced

Pass criteria from the runbook (verbatim from `market-open-drill.md`):

| Criterion | Result | Evidence |
|---|---|---|
| claudeclaw pm2 online throughout | PASS | claudeclaw-main 71m uptime, restart count 6 (one restart for the day's hotfix), no errors in `pm2 logs --err` |
| Both regime-trader instances start at cron | **FAIL** | cron `30 9 * * 1-5` did not fire at 08:30 CT (09:30 ET). Instances remained stopped until manual `pm2 start regime-trader-spy-agg regime-trader-spy-cons` at 08:34 CT. |
| State files update within 10 minutes of market open | **FAIL** | At 08:43 CT (13 min after manual start, 13 min into the open trading window), both per-instance `state.json` files still show `market_open: false`, `updated_at: 2026-05-09T13:07Z`. The first 5-min tick at 08:40 CT failed with the 2026-04-16 HMM size-0 bug. |
| Dashboard + Telegram commands respond | NOT TESTED | Skipped because the upstream failures invalidate the drill before reaching this step. |

### Timeline

```
08:15:13 CT  preflight commands: npm run status / trading:status / pm2 list — all PASS
              (financial-datasets MCP WARN is the documented operator-action item)
08:20:00 CT  drill window opens
08:30:00 CT  EXPECTED cron fire of regime-trader-spy-agg + spy-cons — DID NOT FIRE
08:34:21 CT  pm2 list confirms both still stopped 4 min past expected fire
08:34:30 CT  manual start: pm2 start regime-trader-spy-agg regime-trader-spy-cons → both online
08:36:16 CT  HMM training completes (7-state, BIC=-222526.19); broker positions synced
              (1 SPY position x120 shares, exposure=$88,519.20); "Paper trading started"
08:40:00 CT  first 5-min tick fires — HMM prediction FAILS:
              "HMM prediction failed: index 0 is out of bounds for axis 0 with size 0.
               Holding current regime."
08:43:13 CT  re-check: state files still show market_open=false, updated_at unchanged
```

### Root cause #1 — PM2 cron interprets local system time, not ET

The pm2 manifest at `C:\Users\Richard\.claudeclaw\regime-trader.pm2.json` specifies `"cron_restart": "30 9 * * 1-5"`. PM2 evaluates that pattern against **system local time**, which is US Central (UTC-5 in CDT). Cron fires at 09:30 CT = **10:30 ET** = 1 hour after NYSE open. The bot misses the first hour of trading every day.

Evidence: `pm2 describe regime-trader-spy-agg | grep "cron"` confirms `cron restart: 30 9 * * 1-5`. At 08:34 CT (well past 09:30 ET), the instances were still stopped. They would have started naturally at 09:30 CT (10:30 ET) without intervention.

Reference: `docs/research/sprint-2026-05-11-regime-trader-cron-tz-fix.md`.

### Root cause #2 — HMM size-0 bug on fresh startup persists

The 2026-04-16 `handoff-regime-trader-hmm-debug.md` documented this exact failure mode. My pre-drill log inspection (see `docs/research/2026-05-11-regime-phase2-status.md`) misread *warm-running* logs as evidence the bug was fixed. It is not — on fresh startup, the first 5-min bar fires with insufficient feature-engineered history, throws the IndexError, and the bot enters indefinite "holding current regime" mode.

Evidence: `pm2 logs regime-trader-spy-agg --lines 25` shows `08:36:16 ... === Paper trading started ===` then `08:40:00 [WARNING] __main__: HMM prediction failed: index 0 is out of bounds for axis 0 with size 0. Holding current regime.`

Reference: `docs/research/handoff-regime-trader-hmm-debug.md` (2026-04-16) — the diagnostic + starter prompt is still valid. Today's drill is fresh evidence that the bug never got fixed.

### What this means for the MISSION gate

- **Box 1** (30-day unattended paper): unaffected. claudeclaw-main is healthy.
- **Box 3** (60-day paper Sharpe): **clock cannot start.** The bot needs the size-0 bug fixed before it produces any real per-bar regime predictions. The cron-timezone bug compounds — even after the HMM fix, the bot is starting 1 hour late daily.
- **Box 6** (kill-switch tested): unaffected; Saturday's halt-resume + DB-restore + bloat drills stand on their own.

### Manual mitigation in effect

I left both regime-trader instances RUNNING at the end of this drill. They continue to "hold current regime" on each 5-min bar (no real predictions) but stay online so the operator can observe behavior and decide next move. Operator-action item added to `docs/handoff/2026-05-11-operator-action-checklist.md`: stop both instances at market close (15:00 CT = 16:00 ET) OR let them run until tomorrow's 09:30 CT cron, but real predictions remain blocked.

### Drill outcome → MISSION.md Operator Sign-Off Log

```
2026-05-11 — Market-open drill: FAIL. Two independent bugs surfaced (PM2 cron
  interprets local time not ET; HMM size-0 IndexError on fresh startup). Bot
  online but in "holding current regime" since 08:40 CT. Box 3 clock blocked
  until both fixed in C:\Code\regime-trader. See
  docs/runbooks/trading-drill-log.md and
  docs/research/sprint-2026-05-11-regime-trader-cron-tz-fix.md.
```
