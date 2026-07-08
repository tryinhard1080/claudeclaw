# Broker Plumbing Drill

## Status

Planning only. Not authorized for execution.

This drill exists to test dollars-and-cents broker plumbing after the real-money
gate closes. It is not a strategy-live procedure and it does not authorize
ClaudeClaw to choose, size, or place autonomous live orders.

## Trigger

Use this runbook only when Richard wants a live broker connectivity proof and
all of these are true:

- `MISSION.md` Boxes 1 through 6 are complete.
- `MISSION.md` Box 7 has a dated final live-money sign-off line.
- `npm run gate:audit` reports `Live-money ready YES`.
- `npm run capacity:status` has no FAIL rows.
- Richard is present and watching the broker account.

## Boundaries

- No live flag is changed by this drill.
- No monetary cap is changed by this drill.
- No halt is lifted by this drill.
- No strategy code places an order during this drill.
- The first candidate venue is equities, not Polymarket, unless Richard signs a
  different venue in `MISSION.md` after Box 2 closes.

## Phase 0: Read-Only Preflight

Run these from `C:\Code\claudeclaw`:

```powershell
git status --short --branch
npm run gate:audit
npm run capacity:status
npm run trading:status
npm run trading:benchmark
npm run poly:resolution:watch
```

Pass criteria:

- Gate audit says live money is ready.
- Capacity has no FAIL rows.
- Regime Trader state is fresh or correctly closed until next open.
- Polymarket resolution watch has no overdue-beyond-grace or closed-cache
  failures.
- Working tree state is understood before any live-capital event.

## Phase 1: Manual Broker Ticket

This phase is the dollars-and-cents plumbing proof. It is manual. ClaudeClaw is
not the order originator.

1. Capture broker account identifier, cash, buying power, and open positions.
2. Confirm the exact `MISSION.md` sign-off line for venue, symbol, max dollars,
   loss limit, start time, and rollback condition.
3. Confirm both live tripwire flags remain false before the ticket:

   ```text
   EQUITY_LIVE_EXECUTION_ENABLED=false
   POLYMARKET_US_LIVE_EXECUTION_ENABLED=false
   ```

4. Richard places one tiny manual test ticket in the signed venue. Prefer a
   marketable limit order with explicit price protection.
5. Capture order ID, timestamp, symbol, side, quantity, limit price, fill price,
   commission or fee, and account cash after fill.
6. Close or flatten the test position manually if the sign-off requires a
   round-trip proof.
7. Export the broker activity or fill statement.
8. Append the evidence to `docs/runbooks/trading-drill-log.md`.

Stop immediately if:

- Account identifier does not match the signed account.
- Order size differs from the signed max.
- Broker rejects or partially fills in an unexpected way.
- Fees or P&L are not visible.
- `npm run capacity:status` turns FAIL after the ticket.

## Phase 2: Autonomous Canary Review

Do not run this phase from this runbook. This is a review gate for a later
operator decision.

Before any autonomous canary:

- The manual broker ticket above has a clean signed result.
- The target live flag, max dollars, daily loss limit, allowed symbols, and
  rollback condition are all written in `MISSION.md`.
- A same-day kill-switch check is complete.
- Startup checks prove the live flag cannot be true without the signed gate.
- Richard confirms the bot, not the broker UI, may originate the next order.

## Verifications

After the manual ticket:

```powershell
npm run gate:audit
npm run capacity:status
npm run trading:status
```

Then verify:

- Broker cash and positions match the fill statement.
- ClaudeClaw did not originate a live strategy order.
- No unexpected open position remains.
- No PM2 process crash or restart occurred because of the drill.
- `MISSION.md` and `docs/runbooks/trading-drill-log.md` contain the evidence
  line.

## Rollback

If the manual ticket creates an unexpected live position:

1. Flatten manually in the broker account.
2. Keep live flags false.
3. Stop any affected PM2 execution process if one was incorrectly started.
4. Export broker activity, PM2 logs, and readiness output.
5. Add an incident line to `MISSION.md`.

## Outcome Signature

Record the result in both places:

- `docs/runbooks/trading-drill-log.md`
- `MISSION.md` Operator Sign-Off Log

The signature must say whether the drill was read-only only, manual broker
ticket only, or later autonomous canary review. Do not let those collapse into
one approval.
