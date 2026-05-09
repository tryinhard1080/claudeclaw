# Polymarket Paper Readiness Gate

## Trigger

Run this before claiming the Polymarket paper bot is operational, after scanner/evaluator changes, and before drafting any live-order adapter plan.

## Preconditions

- `POLY_ENABLED=true` is allowed for paper mode only.
- `POLY_EXIT_ENABLED=false` unless the operator has accepted the exit threshold gate.
- `POLY_EXPOSURE_AWARE_SIZING=false` unless the operator has accepted the exposure-sizing gate.
- No live-capital order path exists or is enabled.

## Commands

```powershell
npx tsx scripts/poly-qa-smoke.ts
npm run poly:paper:status
```

Optional paid evaluator check:

```powershell
npx tsx scripts/poly-qa-live-eval.ts
```

## What `poly:paper:status` Checks

- Latest successful `poly_scan_runs` age.
- Latest market count.
- Latest captured price count.
- Signals in the last 24 hours.
- Approved signals in the last 24 hours.
- Open paper positions.
- Realized P&L today.
- Halt flag state.
- Exit flag state.
- Exposure-aware sizing flag state.

## Acceptance Gate

Do not design or enable live-capital work until all of these are true:

- `poly-qa-smoke` passes.
- Paper bot records at least 20 fresh signals.
- At least one paper position opens and is visible in `/poly positions`.
- Halt/resume drill passes.
- DB backup/restore drill passes.
- `npm run poly:paper:status` has no FAIL rows.

Warnings are allowed only when they are explicitly understood and logged. A zero-position warning is normal before the bot has found a qualified trade. A halt flag failure is blocking.

## No-Go Rule

No live Polymarket order adapter until a separate plan covers:

- Signing and wallet/key custody.
- Min-size and allowance checks.
- Kill switch behavior.
- Dry-run order review.
- A startup guard requiring `POLY_LIVE_EXECUTION_ENABLED=true`.

`POLY_ENABLED=true` must never be enough to place a real order.

## Rollback

If readiness fails because the halt flag is set, do not clear it casually. Inspect why:

```powershell
npm run poly:paper:status
pm2 logs claudeclaw-main --lines 120 --nostream
```

If the scanner is stale, inspect PM2 and scan logs before restarting:

```powershell
pm2 describe claudeclaw-main
pm2 logs claudeclaw-main --lines 200 --nostream
```

If the DB is unreadable, run the restore drill against a scratch copy before touching the live DB.

## Outcome Signature

Record drill output in `docs/runbooks/trading-drill-log.md` once Task 9 creates it.
