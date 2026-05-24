# Tiny Real-Money Rollout Plan

Date: 2026-05-24
Status: Planning only. Not authorized for execution.

## Rule

No real-money trading starts from this plan. Real money requires every
`MISSION.md` gate checkbox, Richard's written operator sign-off, and a same-day
kill-switch check.

## Disabled Flags

These flags must remain false until the signed operator line exists:

```text
EQUITY_LIVE_EXECUTION_ENABLED=false
POLYMARKET_US_LIVE_EXECUTION_ENABLED=false
```

They are separate on purpose. Equities and Polymarket US cannot share a live
switch.

## Required Sign-Off Line

Before any live-capital deployment, Richard adds one dated line to
`MISSION.md` with:

- market or venue;
- capital;
- max trade;
- daily loss limit;
- allowed symbols or market categories;
- start date and end-of-first-review date;
- rollback condition;
- confirmation that the kill switch was tested that day;
- confirmation that source freshness was green.

## First-Week Controls

- Tiny order size only.
- One market at a time.
- Manual review after each live fill.
- Stop for the day after any unexpected reject, stale-source warning, account
  mismatch, or unexplained P&L delta.
- No live Polymarket International path for a US operator.

## Rollback

Rollback means:

1. Set the relevant live flag back to false.
2. Stop the relevant PM2 service if execution may still be running.
3. Export the final state, trades, logs, and source-freshness rows.
4. Write the incident line in `MISSION.md`.

## How this changes our code/strategy

The repo now has explicit live flags and an operator sign-off template without
adding an execution path. This closes planning ambiguity while keeping the
real-money gate intact.

