# Regime Subsystem Phase-2 Status — 2026-05-11

> Follow-up to `docs/research/regime-status-2026-04-15.md`. Plan: `C:\Users\Richard\.claude\plans\review-this-code-base-rustling-whistle.md`, Phase 5.

## Summary

The three issues called out in the 2026-04-15 status note have moved as follows:

| Issue | 2026-04-15 state | 2026-05-11 state | Action |
|---|---|---|---|
| A. 35% NULL `regime_label` on signals | 626 NULL of 1766 (35%) | **0 NULL of 39,999 (0%)** | RESOLVED — no code change needed |
| B. Single-regime population | 1133 of 1140 in `vnorm_bbtc_ymid` (99.4%) | 39,200 of 39,999 in `vnorm_bbtc_ymid` (98%) | Still dominant — gated on resolved-trade volume per criteria already in regime-status note |
| C. regime-trader fetch-window / live-prediction (MISSION Box 3 blocker) | HMM live prediction failing with `index 0 out of bounds for axis 0 with size 0` after 09:35 ET on 2026-04-16 | UNKNOWN — last known artifact is `handoff-regime-trader-hmm-debug.md`. **Monday 2026-05-11 09:30 ET market open is the live test** | Watch the drill; if state file transitions cleanly with `regime` key populated, Box 3 unblocks |

## Issue A — Resolution detail

Live DB query (`poly_signals` regime_label distribution, all-time):

```
{ label: 'vnorm_bbtc_ymid',  n: 39,200 }
{ label: 'vunk_bunk_yunk',   n:    696 }
{ label: 'vnorm_bunk_ymid',  n:     96 }
{ label: 'vunk_bbtc_yunk',   n:      7 }
NULL: 0
```

The Sprint-3 design invariant ("failed upstream → vunk, never NULL") now holds across 39,999 signals.

### Why no code change was needed

All three `INSERT INTO poly_signals` paths in `src/poly/strategy-engine.ts` (lines 442, 472, 498) use `regime?.regimeLabel ?? UNKNOWN_REGIME_TAG` where `UNKNOWN_REGIME_TAG = 'vunk_bunk_yunk'` per `src/poly/regime.ts:15`. The original 626 NULLs must have been (a) backfilled in a prior session, or (b) aged out by row-eviction or DB rebuild. Either way, the invariant is now operational.

The corresponding regression test already exists at `src/poly/strategy-engine.test.ts:373`:

```text
it('regime_label falls back to UNKNOWN_REGIME_TAG (not NULL) when no snapshot yet (cold start)', ...)
```

It asserts `row.regime_label === 'vunk_bunk_yunk'` and that `COUNT(regime_label IS NULL) === 0`. The bug cannot regress without breaking this test.

### Disposition

**Closed.** No new code or migration in this Phase. The 2026-04-15 status note's "Phase 2 of audit remediation" line is now satisfied by code that was already shipped between then and now. Annotate the original note with this closure.

## Issue B — Population diversity (still pending data)

The population is now even more dominated by `vnorm_bbtc_ymid` (98% vs 99.4% in April — slightly worse). This is genuine market reality, not a bug: VIX/BTC-dom/10y-yield have been parked in their middle bands for ~2 months.

Criteria from the 2026-04-15 note for retuning thresholds (unchanged):

1. ≥30 days since 2026-04-13 Sprint-3 ship ✓ (today is 2026-05-11, 28 days — just below threshold; will cross 2026-05-13)
2. ≥3 distinct non-`vunk` regime labels in `poly_signals` — currently 2 (`vnorm_bbtc_ymid`, `vnorm_bunk_ymid`). Need a third before retuning.
3. ≥50 resolved trades across at least 2 different labels — currently 0 resolved trades (Phase 4 finding). **HARD BLOCKER.**
4. Issue A fixed ✓ (this doc).

### Disposition

**Hold thresholds.** Bottleneck is no longer Issue A — it's the resolved-trade count. See `docs/research/2026-05-11-box2-pnl-verification.md` for the Q4-2026 projection on resolved trades at current strategy pace. Retuning is deferred behind that timeline.

## Issue C — Regime-trader live prediction (MISSION Box 3)

### What we know

- regime-trader repo at `C:\Code\regime-trader`, HEAD `2f5627f` (multi-instance architecture + config validation + path resolution).
- pm2 manifest at `C:\Users\Richard\.claudeclaw\regime-trader.pm2.json` correctly points at `C:\Code\regime-trader\main.py` with cron `30 9 * * 1-5` and `autorestart=false`.
- Per-instance state files (`instances/spy-aggressive/data/state.json` and `instances/spy-conservative/data/state.json`) currently show `mode: paper`, `market_open: false`, `next_open: 2026-05-11 09:30:00-04:00`, equity ~$103k, cash ~$15k, `updated_at: 2026-05-09T13:07Z`. This is correct closed-market state.
- Live prediction path is at `regime-trader/main.py:380-396`. Guard at line 381 requires ≥300 bars before predict; if guard fails, alert `data_feed_down` and skip cycle. If predict_regime raises, line 393 catches with `holding current regime`.
- The 2026-04-16 handoff note (`handoff-regime-trader-hmm-debug.md`) captures the size-0 IndexError that fired every 5-minute bar that day. **Unknown if it still fires.**

### Strategic decision

Phase 5 Issue C **deferred to the Monday market-open drill (Phase 1)** as the actual test:

- If 09:35 ET state files contain a populated `regime` key (regime_label, confidence, vol_rank, target_allocation) and no `data_feed_down` or `hmm_retrained` alerts fire → live prediction is working, Box 3 60-day Sharpe clock can start, Issue C closes.
- If state files DO NOT populate `regime` or alerts fire → Issue C still present. Open a regime-trader-scoped session with the starter prompt from `handoff-regime-trader-hmm-debug.md` (updated head: now at `2f5627f`, not the 2026-04-16 head).

### Why we don't speculatively fix

The 2026-04-16 handoff hypothesizes feature engineering drops all rows when given a short live-input window. That's plausible. But:

1. Between 2026-04-16 and today, regime-trader's main commit was `2f5627f` (multi-instance architecture) and the prior `cf81907` (code review fixes — memory leak, circuit breakers, path resolution). Both might have changed the live-prediction path.
2. The fix-shape (pad input, use last-bar of training, restructure feature engineering) depends on regime-trader's existing patterns. Without running pytest in that repo and reading the actual call path end-to-end, a speculative claudeclaw-side patch would be a guess.
3. **Live data tells the truth.** In ~30 minutes from this doc's commit (market opens at 09:30 ET / 08:30 CT), the bot exercises the path. The drill log entry will record the outcome.

### If the drill fails

Follow-up session prompt (paste into a Claude Code instance opened in `C:\Code\regime-trader`):

```text
Context: regime-trader live HMM prediction failed at 09:30+ ET on 2026-05-11.
See docs/research/2026-05-11-regime-phase2-status.md in C:\Code\claudeclaw
for context. The 2026-04-16 handoff
(handoff-regime-trader-hmm-debug.md) hypothesized feature-engineering
drops all rows when given a short live-input window — verify if that's
still the failure mode at current HEAD 2f5627f.

Tasks:
  1. Read main.py:380-396 (live cycle) and main.py:680-700 (backtest cycle).
     Compare how features are constructed for predict_regime in each.
  2. Run pytest -k 'predict or live or feature_engineering' from the
     regime-trader venv. Identify any tests that exercise the live-prediction
     path. If none, write one that reproduces the size-0 case.
  3. Hypotheses to verify in order:
     (a) compute_features in data/feature_engineering.py drops rows on
         short live input
     (b) the 300-bar guard at main.py:381 is bypassed (live history is
         shorter than 300 bars at market open)
     (c) different failure mode introduced by cf81907 or 2f5627f
  4. Fix in regime-trader repo's discipline: pytest test first, then
     surgical fix, then commit in that repo with conventional message.
  5. Restart regime-trader-spy-agg + regime-trader-spy-cons via pm2.
  6. Confirm state files refresh with regime key populated.
  7. Update C:\Code\claudeclaw\docs\research\2026-05-11-regime-phase2-status.md
     with closure or further findings.

Tools: Python, pytest, pm2. Use TDD. Stop service before editing, restart
after. Target: one regime-trader-scoped commit. No claudeclaw-side changes.
```

### Disposition

**Deferred to drill outcome.** Updates land in `docs/runbooks/trading-drill-log.md` (Phase 1 entry) and back-propagate to this doc.

## What this Phase did NOT touch

- `src/poly/regime.ts` (no code change)
- `src/poly/regime-migration.ts` (no schema change)
- `poly_signals` table (no backfill — Issue A self-resolved)
- `poly_regime_snapshots` table (no change)
- regime-trader repo (no code change — deferred to drill outcome)
- `POLY_HALT_DD_PCT` / capital params (Tier 3, not touched)

## MISSION.md Box-3 line annotation (Phase 9)

```
- [ ] Equity strategies (regime-trader) have positive paper Sharpe over ≥60 days.
      (2026-05-11) regime-trader at HEAD 2f5627f; 09:30 ET market open drill is
      the live test for the 2026-04-16 size-0 prediction bug. If state files
      populate cleanly, 60-day Sharpe clock starts today. Otherwise re-open
      regime-trader-scoped session per
      docs/research/2026-05-11-regime-phase2-status.md.
```
