# Paper Activity Trading Plan - 2026-06-29

## Directive

Richard asked for more paper activity and supplied a transcript about broad strategy validation. The implementation decision is:

- Increase Polymarket paper activity inside existing deterministic risk gates.
- Keep live money blocked.
- Treat the transcript as a validation framework, not as a permission slip to add an unproven live strategy.

## Current State

As of the pre-change checks:

- Polymarket settled trades: 0/50.
- Polymarket realized P&L: $0.00.
- Polymarket unrealized P&L: -$763.31.
- Open Polymarket positions: 30.
- Current cap: 30 open positions.
- Current scan candidate set: 20 markets per scan.
- Current paper min-edge: 5pp.
- Equity regime-trader sample: 28/60 paper days.
- Equity Sharpe: 2.69 for both spy-aggressive and spy-conservative.
- Equity excess return: +0.30% versus SPY buy-and-hold.

## Paper Execution Change

Change:

- `POLY_MAX_OPEN_POSITIONS`: 30 -> 50.
- `POLY_SCAN_TOP_N`: 20 -> 40.
- `POLY_MIN_EDGE_PCT`: 5 -> 3.

Unchanged:

- `POLY_MAX_TRADE_USD=50`.
- `POLY_PAPER_CAPITAL=5000`.
- `POLY_MAX_DEPLOYED_PCT=0.5`.
- `POLY_TTL_FILTER_ENABLED=true`.
- `POLY_MARKET_QUALITY_FILTER_ENABLED=true`.
- `POLY_REFLECTION_ENABLED=false`.
- `POLY_EXIT_ENABLED=false`.
- `POLY_EXPOSURE_AWARE_SIZING=false`.
- Live execution flags remain disabled.

This gives the paper trader up to 20 more open slots while the deployed-cap gate still blocks exposure above 50% of paper capital.

The wider candidate set gives the strategy engine more due-soon markets to evaluate each scan without weakening the trade gates.

The lower paper min-edge is inside the bounded `TRUST.md` range and is used here for data collection only. It is not evidence that 3pp is safe for real money.

## Transcript Strategy Translation

The transcript's useful content is validation discipline:

- Test broad simple families: mean reversion, trend, momentum, breakout, volatility, volume, and composite baselines.
- Require out-of-sample or walk-forward evidence.
- Reject strategies with unacceptable drawdown.
- Penalize overfit in-sample versus out-of-sample divergence.
- Require enough trades to matter.
- Stress survivors with bootstrap or path-shuffle tests.
- Interpret performance by regime.

ClaudeClaw implementation:

- Polymarket continues using the existing AI-probability strategy for paper execution.
- The slot increase accelerates Box 2 data collection without changing stake size or capital.
- Mean-reversion and cross-sectional momentum from the transcript become equity research hypotheses for regime-trader shadow testing, not immediate execution changes.
- Any equity gauntlet belongs in `C:\Code\regime-trader`, with ClaudeClaw consuming its scoreboard.

## Gate Decisions

Box 2 remains open. There are zero settled wins/losses and no positive realized P&L.

Box 3 remains open. The equity side has 28/60 required paper days, even though current evidence is positive.

Box 7 remains open. Richard's instruction authorizes paper activity acceleration, not live-money execution while Boxes 2 and 3 are incomplete.

## Trading Rules For This Phase

1. Fill up to 50 paper slots only through existing strategy and risk gates.
2. Do not raise per-trade size.
3. Do not raise paper capital.
4. Do not raise deployed-cap percentage.
5. Do not enable live execution.
6. Do not enable reflection, exits, or exposure-aware sizing until settled data exists.
7. Review readiness after the next resolution batch closes, especially the 24 positions due within 7 days.

## Review Trigger

Run the review after either condition:

- At least 15 settled Polymarket trades exist.
- The near-term open batch resolves.

Minimum review commands:

```bash
npm run readiness:evidence
npm run gate:status
npm run poly:resolution:watch
npm run trading:benchmark
```
