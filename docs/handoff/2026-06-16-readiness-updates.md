# Readiness Updates - 2026-06-16

## Summary

ClaudeClaw remains operational in paper mode and is still not live-money ready.
This update closes stale documentation gaps from the June readiness review:
Box 1 paper-clock evidence is accepted, Box 7 wording now clearly means final
written live-money sign-off, and Financial Datasets MCP is classified as
advisory-only status rather than a trading execution warning.

## Current Profitability Evidence

- Polymarket: `$26.09` total paper P&L, all unrealized. Realized P&L remains
  `$0.00` because settled paper trades are `0/50`.
- Polymarket book: `20` open, `67` voided. Open book can cover at most `20/50`
  settled-trade slots, so at least `30` additional resolved trade opportunities
  are still needed after the current book.
- Equity bridge: both regime-trader instances report `2.30%` strategy return
  versus `1.58%` SPY buy-and-hold, for `+0.72%` excess return. Sharpe is
  positive but incomplete at `19/60` sample days.

## Updates Applied

- `MISSION.md`: Box 1 marked complete based on Richard's 2026-06-16 request and
  current `56/30` elapsed paper-clock evidence. This does not authorize live
  money.
- `MISSION.md`: Box 2 and Box 3 notes refreshed to the current evidence state.
- `MISSION.md`: Box 7 wording clarified. A1/A2/A3 were interim operating
  decisions, not final live-money sign-off.
- `src/trading/ops-status.ts`: Financial Datasets MCP `missing` and `needs_auth`
  states now stay visible as advisory PASS states instead of trading readiness
  WARN rows.
- `docs/agent-shared/README.md`, `docs/runbooks/full-capacity.md`, and
  `docs/runbooks/financial-datasets-mcp.md`: readiness guidance refreshed to
  match the current gate state.
- `docs/research/sprint-2026-06-16-readiness-warning-hygiene.md`: sprint note
  added because the MCP status classifier touches `src/trading/`.

## Remaining Blocks

- Box 2: Need `50` settled Polymarket paper trades with positive realized P&L.
- Box 3: Need `60` days of positive regime-trader paper Sharpe evidence.
- Box 7: Richard must add final written live-money approval in `MISSION.md`
  after Boxes 1-6 pass.

## Safety Notes

No real-money flags were enabled. No monetary caps changed. No halt state was
lifted. No risk gate, paper broker, or P&L resolution logic was edited.
