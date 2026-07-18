# Sprint R3 — Risk-gate integrity: real re-validation, honest depth, equity anchoring

Date: 2026-07-18
Parent plan: docs/plans/2026-07-18-repo-review-and-fix-plan.md (R3)
Operator approval: Richard, chat 2026-07-18 ("Proceed through the rest of the
plan (R2->R4)"). The plan flagged R3 as the Tier-3 approval bundle.

## Tier-3 boundary note

TRUST.md reserves deploys touching risk-gates.ts / paper-broker.ts. This sprint
deliberately ships with ZERO edits to either file: both drift checks
(risk-gates.ts:195, paper-broker.ts:47) already compare signal.marketPrice to
whatever orderbook snapshot they are handed. The defects were in the CALLER —
strategy-engine handed them the same pre-evaluation snapshot the signal was
built from. Fixing the inputs in strategy-engine.ts and clob-client.ts makes
the existing controls real. Materially this still changes gate behavior
(conservative direction only), which is why it rode the operator-approved R3
bundle and is called out loudly in the session report.

## Existing-code audit

- **conflict:** paper-broker's doc ("re-validation on the latest snapshot")
  and gate 3's drift guard claimed a control that structurally could not fire
  (review finding, 2026-07-18: drift always exactly 0).
- **duplicate/complement:** none; no other book re-fetch path existed.
- **novel:** post-evaluation book re-fetch; best-level depth semantics;
  realized-equity anchoring.

## Changes (with regression tests per HEARTBEAT sacred rule)

1. **Re-validation (strategy-engine.ts):** after evaluate(), the book is
   re-fetched; gates and execute() receive the FRESH snapshot while
   signal.marketPrice stays the pre-eval basis price. The 3% drift guard now
   measures real movement across the LLM-evaluation window. Fills record the
   fresh price. Tests: 25% drift -> price_drift rejection, no trade; 2.5%
   drift -> fills at the fresh price.
2. **Depth (clob-client.ts):** askDepthShares = shares at the best price
   level only (was: sum of ALL ask levels). The paper broker fills 100% at
   bestAsk, so deeper levels were phantom liquidity inflating paper P&L and
   the calibration data. Tests updated + same-level aggregation case.
3. **Equity anchoring (strategy-engine.ts buildPortfolioSnapshot):**
   snapshot.paperCapital and freeCapital now use realized equity
   max(0, paperCapital + totalRealized); Kelly sizing uses the same figure.
   After losses, deployment caps, the daily-loss floor, free-capital, and bet
   sizes all shrink with the book. Drawdown/halt stays measured against
   ORIGINAL capital (it answers "how much of the initial bankroll is gone").
   Unrealized P&L deliberately excluded (marks are estimates). Test: -500
   realized on 1000 capital halves the deployment cap to 250.

## Cost note

One extra CLOB book fetch per candidate that survives pre-filters and
evaluation (bounded by topN=40 per tick; usually far fewer with eval caching
and the R2 book-full short-circuit).

## How this changes our code/strategy

The three risk controls the codebase claimed now actually bind: price
movement during evaluation can veto a fill, the depth gate reflects executable
top-of-book liquidity, and position sizing de-risks automatically as realized
losses accumulate. All three move in the conservative direction; none loosen
any gate. Calibration data quality improves from honest fills.
