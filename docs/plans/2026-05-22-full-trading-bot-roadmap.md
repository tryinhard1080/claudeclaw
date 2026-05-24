# Roadmap: Full Trading Bot With Real-Money Readiness

Date: 2026-05-22
Status: Draft implementation roadmap
Source research: `docs/research/2026-05-22-full-trading-bot-research.md`

## Goal

Turn ClaudeClaw into a full-fledged two-market trading bot:

- Stock trader through regime-trader plus a measured benchmark.
- Polymarket trader through paper first, then a compliant Polymarket US live venue only after `MISSION.md` gates close.
- Daily intelligence loop with official macro, filings, news, market data, and source freshness.
- Progress tracking visible through CLI, Telegram, and dashboard.

This roadmap does not enable real money. It prepares the system so a later signed approval can enable a small controlled rollout.

## Non-Negotiables

- No real money until every `MISSION.md` real-money checkbox is closed.
- No live Polymarket International order path for a US operator.
- No live adapter can share a flag with paper mode.
- No LLM can size or execute a trade directly.
- No paid feed is adopted without Richard's explicit approval.
- No new asset class, strategy family, or market integration is added before existing systems prove a paper track record.

## Phase 1: Measurement And Progress Tracking

Gate moved: real-money gate visibility, Boxes 1 through 7.

Deliverables:

1. Add a gate-progress module that reads live DB and runbook state:
   - Polymarket resolved trades count.
   - positive realized P&L status.
   - open positions and voided count.
   - regime-trader Sharpe days and latest Sharpe.
   - drawdown and halt state.
   - last scan age.
   - PM2 restart evidence.
2. Add `/trade gate` and `/poly gate` or a single `/status gate` view.
3. Add dashboard card that mirrors `npm run capacity:status`.
4. Add daily handoff note writer for gate deltas only.

Acceptance:

- One command and one Telegram view answer "how close are we to real money?"
- No gate value is hand-entered when it can be read from DB or PM2.

## Phase 2: Daily Intelligence Data Plane

Gate moved: research foundation and strategy reliability.

Deliverables:

1. Add a source freshness ledger table:
   - source name;
   - last fetch time;
   - last success;
   - stale threshold;
   - last error;
   - used by signal yes/no.
2. Add fetchers or adapters for:
   - FRED release dates and macro series.
   - SEC watched-ticker filings or RSS.
   - BLS CPI and jobs series.
   - Alpaca news, if access exists.
   - Polymarket US public market data, read-only.
3. Record source freshness on every Polymarket signal.
4. Add daily "market intelligence" digest:
   - macro events today/tomorrow;
   - watched ticker news;
   - filings;
   - Polymarket open-position relevant news;
   - stale source warnings.

Acceptance:

- A signal cannot claim "fresh context" unless source freshness proves it.
- Missing feeds warn without blocking paper trading unless they are required by a specific market type.

## Phase 3: Polymarket Strategy Hardening

Gate moved: Box 2 resolved-trade quality and safety.

Deliverables:

1. Finish TTL shadow comparison and make the Tier 3 active-filter decision separately.
2. Add price-bucket calibration:
   - 0.15 to 0.25;
   - 0.25 to 0.40;
   - 0.40 to 0.60;
   - 0.60 to 0.75;
   - 0.75 to 0.85.
3. Add market-prior delta cap:
   - signal stores model probability, market probability, delta, cap reason.
   - trade approval requires delta to be supported by calibration bucket and source freshness.
4. Add favorite/longshot bias report by TTL and price bucket.
5. Add spread/slippage capture from order book at paper fill time.

Acceptance:

- We can answer whether `ai-probability` is better than market prices by Brier bucket, not vibes.
- No future live order can be approved solely because the model disagrees with the market.

## Phase 4: Equity Strategy Benchmark

Gate moved: Box 3 confidence.

Deliverables:

1. Add a shadow baseline:
   - SPY trend/momentum signal;
   - volatility target;
   - cash risk-off;
   - daily cadence.
2. Persist daily benchmark equity and returns.
3. Compare regime-trader versus benchmark:
   - rolling Sharpe;
   - cumulative return;
   - max drawdown;
   - turnover;
   - worst day;
   - exposure.
4. Add `/trade benchmark`.

Acceptance:

- Regime-trader must beat a simple research-backed baseline before live money.
- If it does not, the fallback is reducing complexity, not adding another model.

## Phase 5: Polymarket US Read-Only Adapter

Gate moved: compliant real-money path discovery.

Deliverables:

1. Add research note for `polymarket-us` SDK and API shape.
2. Add a read-only adapter:
   - list markets;
   - fetch market by slug;
   - fetch book/BBO;
   - no order methods.
3. Add venue abstraction:
   - current international public/paper venue;
   - Polymarket US public venue;
   - future Polymarket US live venue, compile-time present but runtime disabled.
4. Add tests proving live order methods are unreachable without an explicit future flag.

Acceptance:

- US market discovery works in read-only mode.
- Existing paper trading is not broken.
- No private key or order credential is required for this phase.

## Phase 6: Adversarial And Failure Testing

Gate moved: no P0/P1, kill-switch confidence.

Deliverables:

1. Add perturbation test fixtures:
   - stale source;
   - malicious headline with embedded instruction;
   - wide spread;
   - crossed book;
   - duplicate open position;
   - missing settlement source;
   - wrong event date;
   - sudden price gap.
2. Add "must reject" test cases for each.
3. Add dashboard alert for source/data conditions that would block live trading.

Acceptance:

- Tests prove strategy can be wrong while gates still protect capital.
- Prompt-injection content is stored as data, not executed.

## Phase 7: Tiny Real-Money Rollout Plan

Gate moved: final operator sign-off only after Boxes 1 through 6 are closed.

Deliverables:

1. New `MISSION.md` sign-off template for:
   - market;
   - capital;
   - max trade;
   - daily loss;
   - allowed symbols or markets;
   - start date;
   - rollback condition.
2. New live flags, all false by default:
   - `EQUITY_LIVE_EXECUTION_ENABLED=false`;
   - `POLYMARKET_US_LIVE_EXECUTION_ENABLED=false`.
3. Startup requires:
   - signed mission line;
   - account balance read;
   - dry-run order preview;
   - kill switch tested that day;
   - source freshness green.
4. Initial rollout:
   - tiny stock order size;
   - tiny Polymarket contract quantity only after US venue approval;
   - hard daily loss lower than normal risk cap;
   - manual review after each live fill for first week.

Acceptance:

- Live trading cannot start accidentally.
- Richard can audit every live order from source context to risk verdict to execution.

Planning artifact: `docs/plans/2026-05-24-tiny-real-money-rollout-plan.md`.

## Immediate Next Sprint Recommendation

Sprint F1: gate progress and source freshness ledger.

Reason:

- It directly supports Richard's request to track progress.
- It improves both stock and Polymarket readiness.
- It does not touch `risk-gates.ts`, `paper-broker.ts`, or live execution.
- It gives us the framework needed to safely add daily web/news/macro data.
