# Plan: Get to Real Money Gate Closure

**Date:** 2026-05-12
**Author:** Bot (Opus 4.7), proposed for operator review
**Supersedes:** `docs/plans/2026-04-29-sprint-roadmap.md` (kept for archive)

---

## TL;DR

We have a 7-box real-money gate. 4 boxes are calendar-bound (just need time). 3 require decisions or specific work. The reason this has dragged for weeks is that every shipped sprint has been **orthogonal to the gate boxes**: useful infra work, zero gate movement.

**The binding constraint is Box 2 (≥50 resolved Polymarket trades with positive P&L).** At the current strategy's 0.073% approval rate and the current selection bias toward long-dated political markets, projected close is **Q4 2026**, not before.

This plan forces three things:

1. **Operator picks one of three paths for Box 2 this week.** Path A (strategy shift, target ~2026-07-15), Path B (status quo, target ~2026-10-31), Path C (give up Polymarket, regime-trader-only real money, target ~2026-07-15). Until this decision lands, the plan has no honest target date.
2. **Every sprint after today maps to a specific gate box.** No more orthogonal infra ratchet. If a sprint can't name which box it closes (and by how much), it doesn't ship.
3. **The operator clears the Tier-3 queue in one sitting** (~25 min, see §7). Five of those items have been PROPOSED since 2026-04-21.

If we hit all three, the real-money gate closes between **2026-07-15 and 2026-10-31** depending on path. If we don't, we keep wheelspinning.

---

## 1. Why we haven't finished (honest assessment)

Sprints shipped 2026-04-21 to 2026-05-12 (post-pivot, last 21 days):

| Sprint | Topic | Closes which gate box? |
|---|---|---|
| 20 | News injection into ai-probability prompt | None (blocker pending: PPLX key) |
| 21 | News→position intersection alerts | None (same blocker) |
| 22 | Cron prompt-drift audit | None (housekeeping) |
| 23 | Scheduler EINVAL on Node 24 | None (build-green) |
| 24 | Parallel fetchActiveMarkets | None (perf) |
| 25 | Capacity refinement | None (gated on calibration data we don't have) |
| 26 | News-sync via pwm CLI | None (blocker pending: `pwm login`) |
| 27 | Open-trade slug priority + coverage alarm | None (coverage hygiene) |

**Eight sprints. Zero direct gate movement.** Every sprint was a reasonable engineering decision. None bent the gate-closure curve.

The pattern that produced this:
- The 2026-04-29 roadmap enumerated sprints by capability, not by gate impact.
- The selection rule preferred "dependency leverage" and "marginal P&L impact," neither tied to a specific gate box.
- The bot ratcheted forward on the easy work and never had to name a hard strategic choice.
- The operator felt productive momentum without seeing the gate move.

This plan replaces the selection rule (§5).

---

## 2. The seven boxes: current state with hard numbers

(Source: `MISSION.md`, live DB query 2026-05-12.)

| # | Box | State 2026-05-12 | Bound by | Hard number |
|---|---|---|---|---|
| 1 | 30+ days no manual intervention | Day 21/30 | calendar | target 2026-05-21 (9 days out) |
| 2 | ≥50 resolved trades, positive P&L | 0 resolved of 50 | **strategy** | 42,415 signals × 0.073% approval × current resolution speed |
| 3 | regime-trader paper Sharpe ≥0 over 60 days | Day 1/60 | calendar + Sharpe instrumentation | target 2026-07-11; instrumentation grep returns 0 hits |
| 4 | Drawdown never exceeded `POLY_HALT_DD_PCT` | Green | nothing (stay green) | drawdown auto-halt verified fb48f5c |
| 5 | No P0/P1 codex findings outstanding | Ackable | nothing (fb48f5c closed P1) | 0 P0 / 0 P1 |
| 6 | Kill-switch tested + roll-back drilled | Green | quarterly re-drill | C10 + C11 PASS 2026-05-09 |
| 7 | Operator A1/A2/A3 sign-off | PROPOSED | operator chat | 3 acks, ~5 min |

**Bot can close 1, 3, 4, 5, 6 alone.** 4, 5, 6 are already done modulo monitoring. 1 is on the clock and needs zero unplanned restarts in 9 days. 3 needs the Sharpe instrumentation built.

**Box 2 is the structural problem.** Box 7 is operator-only.

---

## 3. The Box 2 math (the binding constraint)

```
Signals evaluated since 2026-04-21:           42,415
Signals approved (strategy + 3 risk gates):       31    (0.073%)
Approved trades that have resolved (won|lost):     0
Approved trades currently open:                   10    (mostly long-dated political/event)
Approved trades voided (delisted):                21
Days elapsed since live run started:              21
```

At observed rate of 0 resolved in 21 days, the strategy needs roughly the average **time-to-resolution of approved markets** worth of additional time before the first resolution lands. The 10 open positions are biased toward 2026-Q3/Q4/2027/2028 political markets: most won't resolve before the calendar Box-1 + Box-3 windows close.

**Three regimes of arithmetic depending on what we change:**

| Regime | Approval rate change | Selection bias | Days to 50 resolved | Real-money date |
|---|---|---|---|---|
| **Status quo** | unchanged 0.073% | unchanged (long-dated) | ~160 days | ~2026-10-31 |
| **Filter to <30d-resolution markets** | likely down 30-50% (smaller pool) | resolution-biased | ~50-70 days | ~2026-07-10 to 2026-07-30 |
| **Raise approval rate (lower min-edge)** | up to ~0.2% | unchanged | ~110-120 days | ~2026-09-15 |

A duration-filter change cuts the calendar wait drastically because each approved trade resolves much sooner. An approval-rate change helps less because we still wait the same average resolution time per trade.

These are first-order estimates with wide error bars. The 50-trade target is itself an arbitrary boundary the operator set in MISSION.md.

---

## 4. The three paths

The operator must choose one this week. Without a choice, this plan has no honest target date.

### Path A: Strategy refinement toward short-dated markets (RECOMMENDED)

**What changes:**
- Add `POLY_MAX_MARKET_TTL_DAYS = 30` env var. Scanner filters out markets whose `end_date` is more than N days away.
- Add `POLY_MIN_MARKET_TTL_DAYS = 1` env var. Filter out markets resolving in <24h (lottery-style, high noise).
- A/B-test the filter against the current strategy for a 14-day shadow period (Sprint S2 below).
- After validation: enable filter as the primary scanner mode.

**What stays:**
- Strategy logic (`ai-probability` v3), risk gates, paper broker. Untouched.
- Calibration tracker, regime tagger, news pipeline. All shipped, all keep running.

**Tier:** Joint decision per `EVOLUTION.md §0`. Bot proposes, operator signs in MISSION sign-off log.

**Why recommended:** the current 31 approved positions failed to resolve not because the strategy is wrong but because the strategy is being given long-dated markets to choose from. Constraining the time horizon is the smallest possible change that bends Box 2's curve.

**Target real-money date:** **~2026-07-15** (assuming Box-3 60-day clock and Box-2 50-resolutions land in the same window).

### Path B: Status quo, accept the Q4 2026 calendar

**What changes:** nothing. Bot keeps running the existing strategy.

**Real-money date:** **~2026-10-31** at observed pace; later if approval rate or resolution speed drops further.

**Why pick this:** if you don't trust strategy refinement under pressure, or you want to see at least a few natural resolutions land before changing anything.

### Path C: Give up Polymarket, regime-trader-only real money

**What changes:** modify MISSION.md to drop Box 2 from the gate, OR scope real-money authorization to equities-only (regime-trader paper Sharpe drives the switch, Polymarket continues paper-only forever).

**Real-money date (regime-trader alone):** **~2026-07-15** when Box 3 60-day clock completes.

**Why pick this:** if you've concluded Polymarket isn't yielding fast enough and the equity side is the real edge.

### My pick: A

Rationale: Path A is the smallest reversible change that makes the calendar work. We don't abandon Polymarket; we constrain it. Path B accepts a 5-month wait for an arbitrary count threshold. Path C concedes Polymarket too early: the strategy hasn't been given a fair test on short-dated markets yet.

If Path A's filter A/B test shows no real lift after 14 days, we fall back to Path B or Path C automatically. Path A is reversible; the other two require more conviction.

---

## 5. New selection rule (replaces 2026-04-29 §F)

**A sprint ships if and only if it names which gate box it moves and by how much.**

The previous rule (filter blockers → dependency leverage → marginal P&L → effort) is suspended.

| Acceptance test | Pass / fail |
|---|---|
| Names a specific MISSION.md gate box | required |
| States expected days-shaved on that box's clock OR % movement on its threshold | required |
| Does not depend on another PROPOSED operator item | required |
| Has a research note in `docs/research/sprint-<N>-<topic>.md` with duplicate/complement/conflict/novel verdict | required |
| Has a target metric tied to the gate box (not "shipped clean": gate movement) | required |
| Estimated effort ≤ 1 day OR explicitly justified in research note | required |

If any test fails, the sprint goes to a "freeze list" until the failing condition is resolved.

Sprints on the freeze list as of 2026-05-12:
- Sprint 20 / 21 (news injection / intersection alerts): blocker `pwm login` still PROPOSED. Frozen until operator clears item Q3 below.
- Sprint 4.5 (NotebookLM upload): blocker `POLY_RESEARCH_NOTEBOOK_ID` still PROPOSED. Frozen until operator clears item Q5.
- Sprint Email-A / Email-B (outbound + inbound mail): blocker `OPERATOR_EMAIL` still PROPOSED. Frozen until operator clears item Q4.
- Reflection / exit / exposure-aware flag-flips: blockers `≥15-20 resolved trades`. Frozen until Box 2 has data.

**Net effect:** the bot can only work on sprints that move Box 3, harden Box 1, or move Box 2 via Path A (if approved). Everything else is frozen.

---

## 6. Sprint queue (next 4 weeks, gate-tied)

### Sprint S1: Sharpe instrumentation (Box 3: REQUIRED)

**Closes:** Box 3 prerequisite. Without this, Box 3 cannot close on Day 60.

**Scope:**
- New module `src/trading/sharpe.ts`: pure functions `computeDailyReturn(equityToday, equityYesterday)`, `computeRollingSharpe(returns, riskFreeRate, periodsPerYear=252)`, `summarizeSharpe(snapshots)`.
- New table `regime_sharpe_snapshots` (id, instance, date, equity, daily_return, rolling_sharpe_60d, n_days, created_at). Migration `v1.15.0`.
- New cron `kind=shell` task `regime-sharpe-snapshot` runs daily 17:00 CT (post-close). Reads each instance's `state.json` + Alpaca account equity, writes one row per instance.
- New `/poly` (or new `/trade`) Telegram subcommand: `/trade sharpe` returns last-30-day Sharpe per instance + sparkline.
- Backfill: write S1.1 backfill script that walks `regime-trader-spy-{agg,cons}` log files since 2026-05-12 to populate snapshots. Will be at most 1 row before today and at most 1 row per day forward.

**Effort:** 3-5 hrs. Pure additive; no Tier-3 surface (`risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, `strategy-engine.ts`) touched.

**Target metric:** `npm run trading:status` includes a `Sharpe (60d)` row per instance. `/trade sharpe` returns a non-null value once at least 2 daily rows exist.

**Definition of Done:** Sprint S1 closes when the cron has fired once and written one row per instance, AND a regression test verifies the Sharpe math against a known-answer fixture (e.g., constant 0.5% daily return → annualized Sharpe ≈ 7.94).

**Codex review:** required. Touches `kind=shell` cron writer and DB schema (additive, no Tier-3 surface).

**Ship by:** 2026-05-17.

### Sprint S2: Path A short-dated market filter (Box 2: REQUIRED IF PATH A APPROVED)

**Closes:** Box 2 timeline acceleration. Gated on operator picking Path A.

**Scope:**
- Two new env vars in `src/config.ts`: `POLY_MAX_MARKET_TTL_DAYS` (default 30), `POLY_MIN_MARKET_TTL_DAYS` (default 1).
- Filter in `src/poly/scanner.ts` (or wherever the market-volume-rank filter lives today) that excludes markets outside the [min, max] TTL band.
- Shadow mode: log every market that WOULD have been filtered out with the new band, for 14 days, before enabling the filter. Allows comparison.
- A/B harness in `scripts/poly-strategy-compare.ts` already exists (Sprint 2 shipped); add a `--ttl-filter-shadow` flag to compare current vs filtered approval rate, average TTL of approved markets, and projected days-to-50.

**Effort:** 4-6 hrs (filter logic, env-var plumbing, shadow logging, A/B add).

**Target metric:** after 14 days of shadow comparison, projected days-to-50 under filtered mode is ≤ 60 days, OR we fall back to Path B/C.

**Definition of Done:** Sprint S2 closes when 14 days of shadow data have been logged AND the comparison report is in `docs/research/sprint-s2-ttl-filter-comparison.md`. Flag-flip from shadow to active mode is a SEPARATE Tier-3 decision after that report lands.

**Codex review:** required. Touches scanner code (strategy-adjacent, not strictly Tier-3 surface but worth review).

**Ship shadow by:** 2026-05-20. Comparison report by: 2026-06-03. Active flip by: 2026-06-05 (after operator nod).

### Sprint S3: Bug 2 fresh-retrain verification (Box 1 / Box 3 hardening)

**Closes:** Reduces risk that Box 1 or Box 3 clock gets reset by an unplanned regime-trader restart-loop when the 7-day retrain interval expires.

**Scope:**
- Wait for the natural `retrain_interval_days=7` boundary on or around 2026-05-18.
- When pkl mtime hits 7 days, the next pm2 startup will force a fresh BIC training. The `e8c6b59` instrumentation will surface what happens.
- If Bug 2 manifests at training time (the 4 `[!] HMM error` lines and silent exit OR a faulthandler segfault), the recovery options are: (a) cap `n_components_range` to `[3, 4]` in instance yaml (Tier 2 in regime-trader repo), (b) pin/upgrade hmmlearn (Tier 2), (c) revert to the stashed `cb2b282` fix (Tier 2).
- If Bug 2 does NOT manifest, document the verification in `docs/research/sprint-s3-bug2-retrain-verification.md` and close.

**Effort:** 1-2 hrs operator monitoring + 1-3 hrs fix if needed.

**Target metric:** at least one successful fresh-retrain pkl write between 2026-05-18 and 2026-05-25, with no claudeclaw-side restart triggered.

**Definition of Done:** verification doc committed, with either "Bug 2 confirmed dormant on fresh retrain" or "Bug 2 surfaced and fixed via X."

**Codex review:** not needed for the verification itself; required IF a fix lands.

**Window:** 2026-05-18 to 2026-05-25.

### Sprint S4: Path A flag-flip (Box 2)

**Closes:** Box 2 acceleration becomes live (Path A only).

**Scope:**
- After Sprint S2's 14-day shadow comparison shows positive lift, operator flips `POLY_MAX_MARKET_TTL_DAYS_ACTIVE=true` in `.env`.
- pm2 restart with `--update-env`.
- Monitor next 7 days: approval rate, average TTL of approved markets, first resolutions.

**Tier:** 3 (strategy parameter change).

**Effort:** 5 min operator + 1 day monitoring.

**Target metric:** within 14 days of flip, at least 3 trades resolve (Path A's whole bet is that resolutions land sooner).

**Window:** 2026-06-05 to 2026-06-19.

### Sprint S5 (conditional): Codex CLI repair

**Closes:** unblocks formal codex passes on all future sprints.

**Scope:** outside the claudeclaw repo. `~/.claude/scripts/codex-review.js` has a `--full-auto` flag-ordering bug (line 264/268). Surgical fix: drop `--full-auto` from the `review` branch. Then prune or repair the 18 malformed `~/.agents/skills/*/SKILL.md` files.

**Effort:** 30-90 min.

**Tier:** 2-adjacent (harness, not project). Bot surfaces each edit before applying.

**Window:** any time, fits in a wait gap. Not gate-bound.

---

## 7. Operator queue (one sitting, ~25 min)

This is the **biggest single lever the operator has.** Five of these have been PROPOSED since 2026-04-21. Clearing them all unblocks four frozen sprints and closes Box 7.

| # | Item | Effort | Closes / unblocks | Decision |
|---|---|---|---|---|
| Q1 | A1: Gate-clock reading (PERMISSIVE: operator-directed deploys don't reset 30-day clock) | 1 min | Box 7 (1/3) | ACK or override with new reasoning |
| Q2 | A2: Defer reflection / exit / exposure-aware flags pre-calibration | 1 min | Box 7 (2/3) | ACK (now mandatory per Phase-4 P&L: 0 resolved) |
| Q3 | A3: Defer adversarial-review OAuth (`CLAUDE_CODE_OAUTH_TOKEN`) | 1 min | Box 7 (3/3) | ACK (no data to ground critique on yet) |
| Q4 | `pwm login` + `PPLX_API_KEY=pwm` in `.env` + restart | 5 min | Unfreezes Sprint 20 + 21 (news pipeline) | Run `pwm login`, edit `.env`, `pm2 restart claudeclaw-main --update-env` |
| Q5 | `EMERGENCY_KILL_PHRASE` in `.env` | 2 min | Closes kill-switch §3a fastest-halt path | Pick a phrase, add to `.env`, restart |
| Q6 | `.env.stale-2026-04-26.bak` rotation | 5 min | Closes 2026-04-26 leaked-key incident | Rotate Anthropic key, delete file |
| Q7 | `OPERATOR_EMAIL` in `.env` | 1 min | Unfreezes Sprint Email-A | Pick address, add to `.env` |
| Q8 | `POLY_RESEARCH_NOTEBOOK_ID` in `.env` | 5 min | Unfreezes Sprint 4.5 (NotebookLM auto-upload) | Create "ClaudeClaw Research" notebook, copy ID to `.env` |
| Q9 | **Path A / B / C decision for Box 2** | 5 min reading + 1 min decision | Replaces "structural blocker" with a real target date | Pick Path A, B, or C (this plan recommends A) |

Total: ~25 min. Each is independent: pick any subset.

**Q9 is the single decision that determines whether this plan has a 2026-07-15 finish line or a 2026-10-31 finish line.** It does not have to be answered today; it must be answered before Sprint S2 ships.

---

## 8. Master timeline (assuming Path A approved this week)

```
Week of 2026-05-12 (this week):
  Mon 2026-05-12 ✓ Box-3 clock starts. plan written. d220fe2 + 03f717e shipped.
  Tue 2026-05-13   Sprint S1 begins (Sharpe instrumentation). Operator clears Q1-Q9.
  Wed 2026-05-14   S1 in progress.
  Thu 2026-05-15   S1 ships. Codex review.
  Fri 2026-05-16   S2 begins (TTL filter shadow). Sprint S5 (codex CLI) optional fill.
  Sun 2026-05-17   S1 cron fires for first time. Sharpe row populates.

Week of 2026-05-19:
  Mon 2026-05-19   S2 ships in shadow mode. 14-day shadow window opens.
  Tue 2026-05-20   First pkl-retrain window opens (Sprint S3 watch period).
  Wed 2026-05-21   ★ BOX 1 CLOSES (30-day clock) ★ assuming no unplanned restart.
  Thu/Fri          S3 fresh-retrain verification.

Week of 2026-05-26:
  S3 closes (Bug 2 verification complete).
  S2 shadow data accumulating.

Week of 2026-06-02:
  S2 shadow comparison report due 2026-06-03.
  Sprint S4 (Path A flag-flip) decision 2026-06-05.

Week of 2026-06-09:
  Path A active. Filtered scanner mode in production.
  First short-dated resolutions begin landing.

Week of 2026-06-16:
  Box 2 progress: target 5-10 resolved.

2026-07-11: ★ BOX 3 CLOSES (60-day Sharpe) ★ assuming positive Sharpe.

Week of 2026-07-14:
  Box 2 progress: target 30-40 resolved if Path A working as projected.
  Decision point: extend Path A or fall back to B/C if not.

2026-07-30: ★ BOX 2 CLOSES (50 resolved + positive P&L) ★ if Path A's math holds.

2026-08-01 (give or take a week):
  All 7 boxes CLOSED.
  Operator signs MISSION.md real-money authorization line.
  Real-money switch flips.
```

**Calendar floor (regime-trader alone, no Path A required):** ~2026-07-15 (Path C variant).
**Calendar floor (all 7 boxes, Path A working):** ~2026-08-01.
**Calendar floor (all 7 boxes, Path B status quo):** ~2026-10-31 minimum.

Reality margin: timeline assumes nothing breaks. Bug 2 surfacing as a real segfault, a P0/P1 codex finding on S1/S2, or an unplanned restart in the next 9 days could each add 1-4 weeks.

---

## 9. Definition of Done (this plan)

This plan is "executed" when MISSION.md's real-money gate has all 7 boxes marked `[x]` and the operator has added a sign-off line authorizing real-money trading on one or both systems.

This plan is "abandoned" if any of:
- Operator rejects Path A, B, AND C, and proposes nothing in their place.
- Sprint S1 fails codex review with a P0 finding that cannot be fixed.
- Sprint S2's shadow comparison shows zero or negative lift from Path A AND operator declines fallback paths.
- A bright-line `TRUST.md` violation is required to make this plan work (none anticipated).

This plan is "replaced" if:
- Operator picks Path C (regime-trader-only): the post-Box-3 sections of this plan get rewritten to drop Box 2 from the gate.
- A material new fact about Polymarket structure (Polymarket pulls a category, regulatory change, etc.) makes the Box 2 framework obsolete.

---

## 10. Anti-patterns explicitly banned

Lessons from the last 21 days, codified into rules this plan enforces:

1. **No sprint ships that doesn't name a gate box and a quantified movement.** Selection rule §5.
2. **No sprint that depends on a PROPOSED operator item ships before that item resolves.** Freeze list §5.
3. **No infrastructure "improvements" sneak in as `[chore]` commits that wouldn't survive the §5 acceptance test if framed as a sprint.** Including this would catch most of Sprints 22, 24, 25, 27 from the last cycle.
4. **No flag-flip on `POLY_REFLECTION_ENABLED`, `POLY_EXIT_ENABLED`, `POLY_EXPOSURE_AWARE_SIZING` until ≥15-20 resolved trades exist.** A2 already says this; codifying as a hard rule.
5. **No claudeclaw restart between today and 2026-05-21 unless it's an operator-directed deploy of S1.** Preserves Box 1's 30-day clock.

---

## 11. Risks worth naming

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bug 2 surfaces hard on 2026-05-18 retrain | medium | Box 3 clock could reset | Sprint S3 watch; fall back to stashed `cb2b282` fix if needed |
| Path A doesn't accelerate Box 2 enough | medium | timeline slips to Path B | 14-day shadow gives early warning; operator can fall back |
| Unplanned claudeclaw restart in 9 days | low | Box 1 resets to Day 0 | minimize edits; codex S1; don't touch trading code |
| Sprint S1 introduces a P1 codex finding | low | one-sprint delay | small surface, additive only, regression test required |
| Operator never decides Path A/B/C | high if no forcing function | plan has no target | this plan IS the forcing function |
| Polymarket category change voids existing opens | medium | could subtract from open-count base | already saw 21 voided since 2026-04-21; live with it |

---

## 12. Status & ownership

| Component | Owner | Status |
|---|---|---|
| This plan | Bot proposes, operator approves or amends | Draft 2026-05-12 |
| Sprint S1 | Bot | Pending operator green-light |
| Sprint S2 | Bot | Pending operator Path A approval (Q9) |
| Sprint S3 | Bot | Pending 2026-05-18 retrain window |
| Sprint S4 | Operator (Tier 3 flag-flip) | Pending S2 shadow data |
| Sprint S5 | Bot (harness-side, optional) | Available any time |
| Q1-Q9 operator queue | Operator | Pending |

Plan committed to git as a frozen snapshot. To revise: edit this file, commit with `[chore] plan:` prefix, link the change in MISSION.md sign-off log.
