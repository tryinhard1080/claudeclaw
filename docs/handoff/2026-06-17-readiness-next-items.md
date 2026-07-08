# Readiness Next Items - 2026-06-17

## Summary

Implemented the safe next-readiness items without enabling live money:
resolution diagnostics, tiny-live plan refresh, equity-first review order, and
a broker-plumbing drill that separates a manual dollars-and-cents proof from
autonomous strategy trading.

## Added Diagnostics

- `npm run poly:resolution:watch` is a read-only Polymarket resolution watchdog.
- It reports due-soon open paper trades, overdue open trades, missing market
  metadata, and closed-cache/still-open mismatches.
- It exits nonzero only on true pipeline failures: overdue beyond grace,
  closed-cache/still-open, or unreadable core schema.
- It is included in `npm run capacity:status`.

## Current Profitability Evidence

- Polymarket: `0/50` settled paper trades, `$0.00` realized P&L.
- Polymarket mark-to-market after verification: total paper P&L `-$19.16`,
  all unrealized, paper equity `$4,980.84`.
- Equity bridge: both regime-trader instances show `2.22%` strategy return
  versus `1.58%` SPY buy-and-hold, for `+0.64%` excess return.

Latest run:

```text
PASS  Overall status
Open trades                20
Due <=7d                  4
Due <=30d                 20
Overdue open              0
Overdue beyond grace      0
Closed cache still open   0
Missing market rows       0
Unknown end dates         0
```

## Live-Money Planning Updates

- `docs/plans/2026-05-24-tiny-real-money-rollout-plan.md` now records the
  2026-06-17 gate state and candidate order.
- Equities are the first live-candidate review after Box 3 and Box 7 because
  the bridge has daily return, Sharpe, and benchmark evidence.
- Polymarket remains second until Box 2 settles enough paper trades to prove
  realized profitability.

## Broker-Plumbing Drill

- `docs/runbooks/broker-plumbing-drill.md` defines the future dollars-and-cents
  broker test.
- The drill is manual and plan-only until `MISSION.md` gates pass.
- It explicitly does not authorize ClaudeClaw to originate autonomous live
  strategy orders.

## Remaining Blocks

- Box 2: Need `50` settled Polymarket paper trades with positive realized P&L.
- Box 3: Need `60` days of positive regime-trader paper Sharpe evidence.
- Box 7: Richard must add final written live-money approval in `MISSION.md`
  after Boxes 1-6 pass.

## Safety Notes

No real-money flags were enabled. No monetary caps changed. No halt state was
lifted. No risk gate, paper broker, or P&L settlement logic was edited.
