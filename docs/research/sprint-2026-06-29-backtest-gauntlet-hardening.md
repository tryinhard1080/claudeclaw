# Sprint 2026-06-29 - Backtest Gauntlet Hardening

## 1. Existing-code audit

The attached transcript argues for a validation gauntlet: broad strategy library, walk-forward testing, out-of-sample filters, minimum trade counts, transaction costs, parameter robustness, bootstrap stress, and regime-aware interpretation.

Current ClaudeClaw coverage is narrower:

- `scripts/backtest.ts` runs a Polymarket min-edge sweep over historical `poly_signals` joined to cached `poly_resolutions`. It is useful for threshold sensitivity, not for equity strategy discovery, walk-forward validation, or bootstrap stress.
- `src/poly/backtest.ts` simulates current YES-only Polymarket paper-trade payoff and computes approved count, win rate, P&L, ROI, and Brier.
- `src/poly/strategy-compare.ts` computes paired Brier deltas and a paired t-test for two Polymarket prompt versions on resolved overlap.
- `docs/research/2026-05-22-full-trading-bot-research.md` already says to keep regime-trader active, add a simple volatility-targeted momentum benchmark, and require regime-trader to beat the benchmark after costs before live money.
- `docs/trading-research-2025-2026.md` already captures the relevant failure modes: overfitting, survivorship bias, transaction cost blindness, slippage underestimation, regime shift, and trend-following whipsaw risk.

Live audit result before this patch:

```text
npx tsx scripts/backtest.ts
Cached resolutions: 294 markets (0 closed)
0.1pp row: resolved=22908, win%=0.0, P&L=+$0.00, Brier=n/a
```

That output is not valid strategy evidence. With zero closed cached resolutions, the runner should not print thousands of settled or resolved outcomes.

## 2. Literature / NotebookLM finding

No paid or fresh web research was needed for this maintenance sprint. The user-provided transcript is treated as a research prompt, not authority. Its useful claim is methodological: broad backtests only matter when they survive out-of-sample testing, drawdown limits, overfit checks, minimum trade counts, realistic costs, and bootstrap stress.

Repo-local research agrees with the same core constraint: every LLM-generated or candidate strategy must be independently backtested, and backtests that ignore overfitting, survivorship, transaction costs, and slippage are unreliable.

## 3. Duplicate / complement / conflict verdict

**Complement.** A 9,000-run equity gauntlet would not replace the current Polymarket min-edge sweep or prompt-version comparator. It belongs as a separate equity research/benchmark layer, likely in `C:\Code\regime-trader`, with ClaudeClaw consuming the resulting readiness evidence.

Immediate conflict found: the current Polymarket backtest runner can make unresolved data look resolved. Fix that first.

## 4. Why now

Metric improved now: when cached resolutions contain zero closed markets, the backtest output must report zero settled outcomes and surface open/voided counts separately.

Metric for the later gauntlet: any candidate equity strategy must produce walk-forward out-of-sample Sharpe, max drawdown, trade count, bootstrap drawdown distribution, parameter-sensitivity score, and regime-bucket attribution before it can be considered for paper deployment.

## 5. Out of scope

- No new live or paper strategy.
- No change to risk gates, sizing, paper capital, max trade caps, or halt behavior.
- No 9,000-run equity implementation in ClaudeClaw today. That should be a regime-trader scoped sprint after this reporting fix.

## 6. Risk

Tooling-only, but if wrong it can overstate strategy evidence and push the operator toward a bad threshold or bad strategy.

## 7. Verification plan

- Unit test: missing cached resolution remains open, not voided or settled.
- Unit test: malformed closed resolution increments `voidedCount` but not `resolvedCount`.
- CLI check: `npx tsx scripts/backtest.ts` reports `settled=0` when cached closed resolutions are zero.
- Project gate for this scoped patch: `npx vitest run src/poly/backtest.test.ts`.

## Transcript translation for the roadmap

Use the transcript as a validation design, not as a trading conclusion.

1. Build or delegate an equity gauntlet around daily bars, costs, walk-forward windows, drawdown filters, overfit filters, minimum trade counts, and bootstrap stress.
2. Start with simple hypotheses only: mean reversion, momentum, breakout, volatility, volume, and composite baselines.
3. Treat mean reversion as a hypothesis to test under current data, not as a permission slip to add a third strategy or bypass existing regime-trader gates.
4. Regime-tag the result. Momentum may be situationally useful in trend or bull regimes; mean reversion may be useful in choppy regimes. Neither should be live without paper evidence.
5. Feed ClaudeClaw only the scoreboard and readiness evidence. Keep the heavy equity implementation in regime-trader.

## How this changes our code/strategy

First, make the existing backtest runner honest. Then treat a full strategy gauntlet as a separate measurement sprint, not a strategy expansion. ClaudeClaw should continue its current two-system mission: Polymarket paper trading plus the regime-trader bridge. The next equity improvement is a shadow validation scoreboard that proves whether regime-trader beats simple, cost-aware baselines before any live-money gate changes.
