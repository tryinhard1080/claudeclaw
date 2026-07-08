# Sprint 2026-06-29: Open-Position Candidate Rotation

## Trigger

The 5-trading-day launch-readiness sprint needs more paper-trade activity
without weakening `MISSION.md` gates. Current evidence shows Box 2 still at
0/50 settled trades with 38 open positions. Last-hour signal diagnostics show
the current strategy loop repeatedly evaluates high-volume markets that already
have open paper positions, then rejects them at the position-limit gate.

## Existing-Code Audit

Commands:

```bash
rg -n "already open|openPositionKeys|selectPriceCaptureCandidates|topN|poly_paper_trades" src/poly
node -e "<read-only better-sqlite3 last-hour rejection mix>"
```

Findings:

- `src/poly/strategy-engine.ts` selects candidates by quality, volume, and
  `topN`, then evaluates them and only later lets `risk-gates.ts` reject
  duplicate open positions.
- `buildPortfolioSnapshot()` already computes `openPositionKeys` as
  `slug::tokenId`.
- `selectPriceCaptureCandidates()` is shared with scanner price capture and
  strategy candidate selection, so scanner behavior should not lose open
  position price history.
- Last-hour live data showed repeated rejections for already-open markets,
  while 12 more paper positions are still needed to fill the Box 2 pipeline.

## Verdict

Duplicate: not duplicate. The deterministic risk gate already blocks duplicate
orders, but it does so after evaluation work has been spent.

Complement: this complements the existing risk gate by avoiding redundant
evaluations before they reach the gate. The gate remains the final authority.

Conflict: low. No monetary parameters, live flags, risk-gate source, paper
broker source, halt state, or deployed-cap logic changes. Scanner price capture
continues to use the existing shared selector without open-position exclusion.

Novel: add an optional candidate-selector exclusion set so StrategyEngine can
rotate past already-open `slug::tokenId` keys before `topN` slicing while other
callers keep existing behavior.

## How This Changes Our Code/Strategy

The paper strategy should spend the same candidate budget on more fresh
eligible markets instead of repeatedly evaluating markets already in the open
book. This can improve paper-learning velocity and help fill the remaining
Box 2 pipeline slots without lowering edge, raising capital, increasing
per-trade dollars, changing drawdown limits, or enabling real money.
