# Resolution Rate Analysis — 2026-04-15

## Goal

MISSION.md Q2 2026 Objective #2 requires ≥50 resolved Polymarket trades with positive realized P&L before the real-money gate can open. Current progress: **11 market-level resolutions** in `poly_resolutions`. Question: what pace are we on, and what knobs exist to change it?

## Baseline data (queried `C:/claudeclaw-store/claudeclaw.db`)

Last 7 days (which is also roughly the bot's total active lifetime):

| Metric | Value |
|---|---|
| Signals evaluated | 1,779 |
| Signals approved | 7 (0.39%) |
| Paper trades open | 4 |
| Paper trades voided | 3 |
| Paper trades resolved (won/lost) | 0 |
| `poly_resolutions` rows (market-level) | 11 |

**Rejection mix (sampled last 7d):**
- `already_open_position_on_*` — 13 hits. Bot keeps re-picking the same handful of markets.
- `edge_pct < POLY_MIN_EDGE_PCT` — 13 hits (threshold = 5%).

## The actual bottleneck

**It's not the gate. It's the universe.**

A 0.39% approval rate with 13 repeat-market rejections suggests the bot is seeing the same ~10-20 markets every scan and genuinely running out of new candidates. `POLY_MIN_VOLUME_USD=5000` filters the 49,000-market active set down hard. `POLY_MIN_TTR_HOURS` filters further. The `edge_pct` rejection count is similar in magnitude, so there isn't one dominant gate.

More important: **4 trades open, 0 resolved in the paper set.** All resolutions that landed (11 in `poly_resolutions`) are market-level fetches — markets we had signals on that settled, but mostly on the rejected side. Resolved-trade target depends on market end dates, not our throughput.

## Projections

Under current parameters, assuming bot runs continuously:

| Scenario | 30-day approved signals | Resolved trades by 2026-06-30 |
|---|---|---|
| Status quo | ~30 | Hard to estimate — depends on market end dates; best guess 15–25 |
| `POLY_MIN_VOLUME_USD` 5000 → 2000 | ~60 (universe ~2x wider) | 30–50 |
| `POLY_MIN_EDGE_PCT` 5 → 3 | ~15 more approvals, lower quality | Marginal; probably 20–30 |

None of these hit 50 confidently by Q2 end. The 30-day-unattended objective is looking fine (crons firing, scans healthy), but the ≥50-resolved objective is at genuine risk.

## Options (NO CODE — this is an operator decision doc per plan Phase 6)

**Option A: Hold parameters, accept slower pace.** Conservative. Probably misses 50-resolved by end of Q2 but gives cleanest paper-track signal. Real-money gate stays closed regardless.

**Option B: Widen universe — lower `POLY_MIN_VOLUME_USD` to 2000 or 3000.** Doubles candidate set, probably doubles throughput. Tier 3 (monetary risk parameter adjacent — but not *actually* monetary since we're paper). Defensible.

**Option C: Lower `POLY_MIN_EDGE_PCT` from 5 to 3.** More approvals, lower per-trade expected value. Tier 3. I'd push back on this — narrowing edge hurts the calibration signal we need for the real-money gate.

**Option D: Fix "already open" re-rejection.** Currently the bot re-evaluates markets it's already in and rejects. That's correct logic but represents wasted LLM calls. Not a throughput problem; a cost problem. Low priority.

## Recommendation

**Option A for now.** The 0 paper resolutions so far means we don't yet know our actual win rate on resolved trades. Widening the universe before we've calibrated on the current one risks doubling the bet on a possibly-mis-calibrated strategy.

Re-check this analysis in 2 weeks (2026-04-29): if `poly_paper_trades WHERE status IN ('won','lost')` is still under 10, escalate to Option B.

## Tier

This doc is Tier 2 (write and file, no parameter change). Any parameter change is Tier 3 (TRUST.md: monetary/risk-param adjustments). Richard picks, no autonomous change.
