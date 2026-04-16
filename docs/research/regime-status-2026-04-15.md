# Regime Subsystem Status — 2026-04-15

## Data

Queried `C:/claudeclaw-store/claudeclaw.db` at audit time:

- `poly_regime_snapshots`: 180 rows. Last write 2026-04-15 23:37 UTC (~current).
- `poly_signals.regime_label` distribution (1766 rows):
  - `vnorm_bbtc_ymid`: 1133 (64%)
  - `NULL`: 626 (35%)
  - `vunk_bbtc_yunk`: 7 (<1%)
- Last 3 signals: all `vnorm_bbtc_ymid`.
- Last 2 snapshots (both 2026-04-15): `VIX=18.17, BTC-dom=57.28, 10y=4.28` → `vnorm_bbtc_ymid` unchanged.

## Two problems

### Problem 1: 35% NULL regime_label on signals

Sprint 3 design (per `project_sprint3_regime_shipped.md` line 33) said failed upstream components become `vunk`, **never NULL**. The 626 NULL rows contradict that design.

Hypothesis: signals inserted before the first regime refresh completes on startup, or a code path in `strategy-engine.ts` that inserts signals without calling the regime tagger. Fix is Phase 2 of audit remediation.

### Problem 2: single-regime population defeats per-regime Brier

Sprint 3's intended value is per-regime calibration — does the strategy's accuracy vary across `calm/norm/stress` × `alt/mix/btc` × `low/mid/high` cells? With 1133 of 1140 non-null signals in one cell (`vnorm_bbtc_ymid`), per-regime Brier is functionally a single-cell measurement plus noise from 7 `vunk` observations.

Macro regimes genuinely do change slowly — 2 days in the same cell is plausible, not bug evidence. But the *design* of Sprint 3 assumed we'd see distribution across cells within a reasonable window. The current distribution suggests:

- Bucket thresholds (VIX <15/15-25/≥25, dom <45/45-55/≥55, yield <3.5/3.5-5/≥5) may be too wide. Sprint 3 flagged them as "v1 guesses, revisit after 30+ days."
- Or the world is genuinely parked in one cell. Can't tell yet.

## Decision

**Hold thresholds.** Do not retune. Two reasons:

1. Sample size is too small. 180 snapshots over 2 days. The 30+ day threshold Sprint 3 set hasn't been reached.
2. Per-regime Brier carries no signal yet because (a) 35% of signals have no label at all (Problem 1), and (b) only 11 resolved trades total in `poly_resolutions`, none broken out by regime cell meaningfully.

## Criteria for when to retune

Trigger a threshold-tuning sprint when **all** are true:

- ≥30 days elapsed since 2026-04-13 ship.
- ≥3 distinct non-`vunk` regime labels represented in `poly_signals`.
- ≥50 resolved trades across at least 2 different labels.
- Problem 1 (NULL rate) fixed and backfilled.

Until then, regime is a lower-priority signal for strategy tuning. Aggregate Brier is still the primary calibration metric.

## Action items (captured elsewhere)

- Phase 2 of audit remediation: fix the NULL stamping path, add test, backfill existing NULLs to `vunk_bbtc_yunk`.
- No threshold changes this quarter absent trigger criteria.
