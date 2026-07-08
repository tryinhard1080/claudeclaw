# Sprint 2026-06-17 - resolution watchdog

## 1. Existing-code audit

- `scripts/fetch-resolutions.ts` already fetches Gamma state for open-trade
  slugs before background slugs and persists rows in `poly_resolutions`.
- `src/poly/pnl-tracker.ts` owns trade settlement. It transitions open paper
  trades only when Gamma reports a closed market with a clear winning outcome,
  or voids when the market is missing or delisted.
- `src/readiness/evidence.ts` already counts `dueNext7Days`,
  `dueNext30Days`, `overdueOpenTrades`, and renders a limited open-trade
  resolution queue.
- No standalone command failed readiness when an open paper trade was overdue
  past a grace window or when `poly_resolutions.closed=1` while the trade stayed
  open.

## 2. Literature / NotebookLM finding

No external literature needed. This is local operational accounting. The
profitability gate depends on settled realized P&L, so resolution freshness is a
precondition for judging the strategy.

## 3. Duplicate / complement / conflict verdict

**Complement.** The existing evidence surface answers "what is due soon?" The
new watchdog answers "is the resolution pipeline stale enough to block
profitability judgement?" It does not replace `pnl-tracker` settlement logic or
`fetch-resolutions.ts` cache population.

## 4. Why now

Richard asked whether the system has been profitable and whether it is actually
trading dollars and cents. The current Polymarket answer is unrealized only:
`0/50` settled trades and `$0.00` realized P&L. A stale resolution pipeline
would make that answer ambiguous. The watchdog makes stale or mismatched
resolution state visible immediately.

## 5. Out of scope

- No real-money enablement.
- No cap, halt, or risk-gate changes.
- No settlement classifier change in `src/poly/pnl-tracker.ts`.
- No forced close, void, or manual mutation of paper trades.

## 6. Risk

Low. The blast radius is read-only diagnostics plus `capacity:status` surfacing
pipeline failures. It does not execute trades or change strategy behavior.

## 7. Verification plan

- Unit-test no-open, due-soon, overdue, closed-cache, and missing-metadata
  cases.
- Run `npm run poly:resolution:watch` against the live DB.
- Keep the command inside `npm run capacity:status` so future stale resolution
  failures are visible before any live-money review.
