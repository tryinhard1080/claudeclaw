# Market-Open Drill Results

## Drill Window

- Date:
- Operator:
- Market open:
- ClaudeClaw commit:
- Regime Trader commit:

## Preflight, 8:20 AM CT

Commands:

```powershell
npm run status
npm run trading:status
pm2 list
pm2 describe claudeclaw-main
pm2 describe regime-trader-spy-agg
pm2 describe regime-trader-spy-cons
```

Result:

- ClaudeClaw PM2:
- Regime Trader PM2 paths:
- Trading readiness:
- Notes:

## Cron Start, 8:30 AM CT

Commands:

```powershell
pm2 list
pm2 logs regime-trader-spy-agg --lines 80 --nostream
pm2 logs regime-trader-spy-cons --lines 80 --nostream
```

Result:

- `regime-trader-spy-agg`:
- `regime-trader-spy-cons`:
- Notes:

## State Transition, 8:35 AM CT

Commands:

```powershell
Get-Content C:\Code\regime-trader\instances\spy-aggressive\data\state.json -TotalCount 40
Get-Content C:\Code\regime-trader\instances\spy-conservative\data\state.json -TotalCount 40
npm run trading:status
```

Result:

- `spy-aggressive` state:
- `spy-conservative` state:
- Readiness status:
- Notes:

## Operator Surface, 8:40 AM CT

Checks:

```text
/trade status
/poly status
http://localhost:3141
```

Result:

- `/trade status`:
- `/poly status`:
- Dashboard:
- Notes:

## Alert Quiet Period, 9:00 AM CT

Commands:

```powershell
pm2 logs claudeclaw-main --lines 80 --nostream
pm2 logs regime-trader-spy-agg --lines 80 --nostream
pm2 logs regime-trader-spy-cons --lines 80 --nostream
npm run trading:status
```

Result:

- Repeated stale/down alerts:
- Restart count:
- Final readiness:
- Notes:

## Final Verdict

- Pass or fail:
- Blocking issue IDs:
- Follow-up owner:
- Operator sign-off:
