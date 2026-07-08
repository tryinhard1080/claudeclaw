# Sprint 2026-06-29 Resolution Watch Scheduler

## Question

What is the safest next operational lever after paper activity is running, Box 2
still has 0/50 settled trades, and 31 open paper positions are due within 7
days?

## Existing-Code Audit

- `scripts/poly-resolution-watch.ts` already provides a read-only CLI around
  `collectResolutionWatch`.
- `scripts/fetch-resolutions.ts` already prioritizes open-trade slugs before
  background signal slugs and persists `poly_resolutions` cache rows.
- `src/readiness/poly-resolution-watch.ts` already classifies open paper trades
  as due soon, overdue, closed-cache-still-open, missing-market-row, or unknown
  end-date.
- `scripts/register-readiness-evidence-cron.ts` and
  `scripts/register-overnight-trading-agent-cron.ts` are the local pattern for
  registering idempotent `kind='shell'` scheduler tasks.
- `src/scheduler.ts` runs shell tasks through `tsx` and sends their output to
  Telegram, then stores the result in `scheduled_tasks`.

## Verdicts

- Duplicate: No duplicate recurring resolution watch registration exists.
- Duplicate: No recurring prioritized shell refresh exists for the resolution
  cache. The existing weekly resolution-fetch task is slower than the current
  sprint needs.
- Complement: The scheduler complements the existing read-only watch by making
  near-resolution evidence timely and operator-visible.
- Complement: A 75-slug prioritized fetch keeps `poly_resolutions` fresh enough
  for the watchdog's closed-cache mismatch check without touching `PnlTracker`.
- Conflict: None. The task does not trade, fetch new resolutions, alter risk
  gates, change monetary limits, lift halts, or enable live flags.
- Novel: Add idempotent registration scripts for a 2-hour resolution watch and
  a 2-hour prioritized resolution-cache refresh during the 5-trading-day
  sprint.

## How This Changes Code Or Strategy

ClaudeClaw should keep paper trading inside the current gates, but the
resolution queue should be checked automatically while the book is packed with
near-term positions. A prioritized cache refresh should run shortly before the
watch so due-market closure evidence is not stale. This reduces the chance that
Box 2 evidence is delayed by manual monitoring gaps without weakening the
real-money gate.
