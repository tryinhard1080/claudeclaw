# Tiny Real-Money Rollout Plan

Date: 2026-05-24
Status: Planning only. Not authorized for execution.

## 2026-06-17 Refresh

Current gate state:

- Box 1 is accepted as elapsed paper-clock evidence.
- Box 2 is not complete: Polymarket has `0/50` settled paper trades and
  realized P&L is still `$0.00`.
- Box 3 is not complete: Regime Trader has `19/60` Sharpe sample days.
- Box 7 is not complete: Richard has not added final written live-money
  sign-off.

Current profitability read:

- Polymarket has mark-to-market movement, but no realized profitability proof
  because no paper trades have settled.
- Equity bridge has the cleaner first-review path once Box 3 closes because it
  already has daily return, Sharpe, and benchmark evidence surfaces.

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

## Candidate Order

1. **Equities first, after Box 3 and Box 7.** Regime Trader has a conventional
   broker/fill model, daily return history, benchmark comparison, and a
   clearer dollars-and-cents audit trail.
2. **Polymarket second, after Box 2.** The current Polymarket evidence is
   unrealized only. No live Polymarket canary should start until settlement
   count and realized P&L prove the paper strategy on closed markets.

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

## Tiny Canary Shape

The first live-capital canary is a bounded test, not a strategy scale-up.

- One venue only.
- One account only.
- One instrument or market family only.
- One trade at a time.
- Explicit dollar cap from the `MISSION.md` sign-off line.
- Manual review after every fill.
- Stop immediately on account mismatch, rejected order, unexpected size,
  missing fill report, stale source data, unexplained P&L delta, or any FAIL
  row in `npm run capacity:status`.

## First-Week Controls

- Tiny order size only.
- One market at a time.
- Manual review after each live fill.
- Stop for the day after any unexpected reject, stale-source warning, account
  mismatch, or unexplained P&L delta.
- No live Polymarket International path for a US operator.

## Broker Plumbing Before Strategy Live

Use `docs/runbooks/broker-plumbing-drill.md` before any autonomous live
strategy canary. The plumbing drill proves broker credentials, account
selection, order/fill visibility, fees, and rollback evidence. It does not
authorize the agent to choose or place strategy orders.

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
