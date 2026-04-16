# Sprint 9 — Exposure-aware Kelly sizing

> Backfilled 2026-04-15 as part of audit remediation. Original ship 2026-04-15 (commit e11a77b) went through without this note. `feedback_baby_steps_research_first` memory required this audit before any more sizing code.

## 1. Existing-code audit

Prior art that touches deployed-exposure math:

- `src/poly/risk-gates.ts:79-100` — `gate1PositionLimits`:
  - Line 88: `maxDeployed = config.maxDeployedPct * portfolio.paperCapital`
  - Line 89–91: rejects when `portfolio.deployedUsd + sizeUsd > maxDeployed`.
  - `maxDeployedPct` sourced from `POLY_MAX_DEPLOYED_PCT` (config.ts).
- `src/poly/strategy-engine.ts:123-129` — `computeAvailableCapital` (Sprint 9):
  - Sums `size_usd` across `poly_paper_trades WHERE status='open'`.
  - Returns `max(paperCapital - exposure, 0)`.
- `src/poly/strategy-engine.ts:131-141` — `computeKellySize`: standard fractional Kelly capped at `maxTradeUsd`.

So exposure is tracked in *two* places: the gate uses `PortfolioSnapshot.deployedUsd` (computed elsewhere and passed in), the sizer uses a fresh SQL sum of open trades.

## 2. Literature / NotebookLM finding

Kelly with multiple simultaneous positions: the classical formulation assumes sequential independent bets. With overlapping positions, the bankroll "available" for the next bet is naturally bankroll minus currently-deployed capital — which is exactly what Sprint 9 computes. Thorp ("The Kelly Capital Growth Investment Criterion", 2011) and the practical fractional-Kelly literature both treat "capital at risk" as the denominator for the next bet. Nothing exotic here; it's textbook.

## 3. Duplicate / complement / conflict verdict

**Complement, with one small nit.**

The two layers do different jobs:

| Layer | What it does | Trigger |
|---|---|---|
| `computeAvailableCapital` (sizing) | Shrinks the bet *size* as exposure grows | Runs before gates |
| `gate1PositionLimits` (gate) | *Rejects* a bet that would push deployment over `maxDeployedPct * paperCapital` | Runs after sizing |

Concrete example: `paperCapital=10000`, `maxDeployedPct=0.5`, `deployedUsd=4800`, incoming signal wants ~$1000 at fair Kelly.

- Without Sprint 9: Kelly uses `paperCapital=10000` → say sizes $2000 → gate 1 rejects ($4800 + $2000 = $6800 > $5000). Lost signal.
- With Sprint 9: Kelly uses `paperCapital - 4800 = 5200` → smaller Kelly → maybe $200 → gate 1 passes ($5000 = $5000). Signal fills at a smaller size.

Without Sprint 9, near the cap the bot rejects signals it could have taken smaller. With Sprint 9, it shrinks gracefully. Value add is real.

**The nit:** `computeAvailableCapital` uses the full `paperCapital` as its effective ceiling (via `paperCapital - exposure`). Gate 1 uses `maxDeployedPct * paperCapital` as its ceiling. When `maxDeployedPct < 1` (typical), the sizer is operating on a bigger budget than the gate will actually allow. Sprint 9 doesn't produce *wrong* sizes — the gate still catches anything over — but it produces sizes that are more likely to hit the gate than they need to be.

**Recommended refinement (not done here, future sprint if enabled):** change Sprint 9 to use `maxDeployedPct * paperCapital - exposure` as the ceiling, so sizer and gate agree on the same frontier. Small change, clear improvement.

## 4. Why now

Sprint 9 improves capital efficiency near the `maxDeployedPct` cap. Value materializes only when the portfolio is actually running near its cap. Right now `poly_paper_trades WHERE status='open'` is small; exposure-vs-capital is low; this feature is currently latent.

**Measurable improvement:** approval rate conditional on `deployedUsd > 0.7 * maxDeployed` should rise after flag-enable. Baseline unknown (flag was never enabled). Metric: take weekly average over 30 days post-enable.

## 5. Out of scope

- Any change to `gate1PositionLimits` itself (would be Tier 3).
- Changing `POLY_MAX_DEPLOYED_PCT` (Tier 3).
- The refinement to use `maxDeployedPct * paperCapital` as the sizer ceiling (separate, small future sprint — or just fold it into the Sprint-9-enable commit).

## 6. Risk

Blast radius if wrong: **low**. Flag-gated off (`POLY_EXPOSURE_AWARE_SIZING=false`). Pure sizing-layer change; gate 1 still catches over-deployment. Worst case = undersizes signals when exposure is high, which is the conservative direction.

## 7. Verification plan

Before flag-enable:

1. Apply the sizer-ceiling refinement (`maxDeployedPct * paperCapital - exposure`).
2. Run `poly-qa-smoke.ts` with the flag on, verify no signals fill above gate 1 limit.
3. Backtest harness (Sprint 5): replay a period where the portfolio hit `>0.7 * maxDeployed` — confirm Sprint 9 produces smaller sizes, no filled trade exceeds gate.

After flag-enable (30 days):

- Compare approval rate conditional on `deployedUsd > 0.7 * maxDeployed` vs flag-off baseline.
- Confirm no unexpected undersizing at low exposure (should be identity when exposure=0).

## Verdict

**Keep Sprint 9. It's not redundant with gate 1.** Apply the small refinement to align ceilings before flag-enable. Do not enable without Richard's explicit nod (Tier 3, changes risk envelope).

The memory worry ("duplicate/redundant") is closer to **redundant-until-enabled + minor ceiling misalignment** — a real but small issue, not a wasted sprint. The bigger lesson is process: this 15-minute audit should have preceded the 15-minute sprint, not followed it two days later.
