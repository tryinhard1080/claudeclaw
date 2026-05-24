# Sprint 2026-05-24: Regime Weekend Readiness

## Trigger

`npm run capacity:status` failed on Sunday 2026-05-24 because both regime-trader
PM2 apps were stopped while their last `state.json` snapshots still said
`market_open: true` from Friday 2026-05-22. The apps are expected to be stopped
outside market hours, but the readiness checker only accepted closed-market
state with `next_open`.

## Existing-code audit

Command:

```bash
rg -n "market_open|next_open|regular session|NYSE|trading day|tradingDays|summarizeRegimeState|summarizePm2Apps" src scripts docs --glob '!node_modules'
```

Findings:

- `src/trading/ops-status.ts` owns `summarizePm2Apps()` and
  `summarizeRegimeState()`.
- `scripts/trading-readiness.ts` and `src/trading/ops-dashboard.ts` both read
  regime-trader `state.json` files but did not preserve file mtimes.
- `docs/plans/2026-05-09-trading-bot-operational-readiness.md` already states
  the intended PM2 rule: regime apps may be stopped before next open.
- Existing tests cover `closed_until_next_open` and `stale_after_next_open`,
  but not stale Friday open-state on a weekend.

## Verdict

Duplicate: none. No existing code classifies stale open-state snapshots by
current regular-session status.

Complement: this complements the existing `next_open` handling. It does not
replace closed-market state; it covers the case where the producer stopped
before writing that state.

Conflict: low. The main risk is accidentally masking a real market-hours
outage. The implementation must fail stale open-state during regular weekday
session.

Novel: add `state.json` mtime to readiness classification and a US-equity
regular-session helper. This is readiness-only logic and does not touch order
execution, sizing, or risk gates.

## Plan

1. Add tests for Sunday stale open-state, weekday stale open-state, PM2 stopped
   app handling, and regular-session classification.
2. Extend `summarizeRegimeState()` to accept state-file mtime.
3. Pass state-file mtimes from `scripts/trading-readiness.ts` and
   `src/trading/ops-dashboard.ts`.
4. Treat stale open-state as pass outside regular session and fail during
   regular session.
5. Re-run the targeted test, typecheck, and readiness script.

## How this changes our code/strategy

This removes a false readiness failure on weekends without weakening trading
safety. If regime-trader is stopped while regular US equity session is open and
the last state snapshot is stale, readiness still fails. If the same stale
open snapshot exists outside regular session, readiness reports it as a safe
closed-session state that should still be cleaned up by the producer later.

