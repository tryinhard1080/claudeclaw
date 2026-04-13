# Handoff — ClaudeClaw

## Last Session
- **Date**: 2026-04-13 (trading-only pivot + Sprints 1 & 2 shipped)
- **Model**: Claude Opus 4.6 (1M context)
- **Previous session**: 2026-04-12 (Polymarket Phase A+C tasks 0-14)

## What Changed (2026-04-13)

### Identity pivot — bot is now a trading-only partner
Operator directive: "make this a first-class trading bot, single focus." New project-root identity files (read in this order before substantive work):
- `TRUST.md` — partnership contract. Tier-2 default autonomy + Tier-3 ask-first list. Bright lines: no harm, no blackmail, no operator-data leak, no undisclosed real-money, no host-system file changes outside project scope, own-your-data clause. Decision hierarchy: TRUST > SOUL > operator > risk gates > MISSION gate > HEARTBEAT > CLAUDE.md > defaults.
- `SOUL.md` — identity. Partnership FIRST, world-class self-improving trading agent second. Family-stakes constraint informs every risk decision. Three-layer arch (strategy / risk gates / execution) must stay separated.
- `MISSION.md` — Q2 2026 objectives + real-money gate checklist + operator sign-off log.
- `HEARTBEAT.md` — operational rhythm (5-min scans, 60-min PnL reconcile, daily digest, daily calibration, 2h news sync, halt switches).
- `EVOLUTION.md` — 6-sprint self-improvement architecture (calibration → versioning → regime → ingestion → backtest → adversarial). Validated by Karpathy/Anthropic literature in `docs/research/self-improvement-loops.md`.
- `BACKLOG.md` — parked side-requests; bot owns prioritization.
- Project `CLAUDE.md` — rewritten to reflect trading-only mandate; old personal-assistant framing dropped.

### Sprint 1 shipped — Calibration tracker
- `migrations/v1.4.0/v1.4.0-calibration.ts` (actually v1.3.0 — see commits) — `poly_calibration_snapshots` table.
- `src/poly/calibration.ts` — Brier score, log loss, 10-bucket calibration curve, snapshot composer/persist/latest, alert helper. 220 lines, 34 tests.
- `/poly calibration` Telegram command + renderer.
- Daily cron in `initPoly` 5-min tick (gated by `poly_kv` last-run-ymd, stamp-on-send-success).
- Config: `POLY_CALIBRATION_HOUR=7`, `POLY_CALIBRATION_BRIER_ALERT=0.30`, `POLY_CALIBRATION_LOOKBACK_DAYS=30`.
- Codex review: 2 P1/P2 fixes applied (defensive `CREATE TABLE IF NOT EXISTS` + stamp-after-send-success).

### Sprint 2 shipped — Strategy versioning + A/B compare
- `migrations/v1.4.0/v1.4.0-strategy-versioning.ts` — adds `prompt_version` + `model` columns to `poly_signals` (idempotent, preserves existing data).
- `src/poly/strategy-compare.ts` — pure A/B compare with paired Brier deltas + two-tailed paired t-test (hand-rolled Lanczos ln-gamma + Lentz incomplete-beta — no stats lib). 222 lines, 15 tests.
- `scripts/poly-strategy-compare.ts` CLI — `npx tsx scripts/poly-strategy-compare.ts v3 v4`.
- Strategy engine writes `prompt_version='v3'` + `model='claude-opus-4-6'` on every new signal.
- Live-verified: signals 118-124 carry tags; older 117 stay NULL (no corruption).
- Self-audit fix: bucket key uses JSON tuple (collision-proof if slugs contain `|`).

### Operational additions
- 2-hour news-sync cron registered (`schedule-cli` task `3d623e0e`, fires `0 */2 * * *` from 8 AM).
- `docs/research/INDEX.md` + 2 research notes (self-improvement-loops, agent-mail-integration).
- `docs/news/` gitignored (transient cron output, auto-pruned at 7 days).
- `.env` carries `ANTHROPIC_API_KEY` + `AGENTMAIL_API_KEY` (both gitignored).

## Current State

**Bot live (pm2 id 9, PID 21728):** Phase C running, scans every 5 min, ~24 signals/hour evaluated, 0 approvals so far (gates correctly blocking long-shot Polymarket markets). 745 pm2 restarts cumulative across all sessions.

**Test count:** 163/163 poly suite green. Typecheck clean. Build clean.

**Migration state:** v1.2.0 + v1.3.0 + v1.4.0 all applied to prod DB at `C:/claudeclaw-store/claudeclaw.db`.

**Branches:** Only `main`. Feature branches `feat/calibration-tracker` + `feat/strategy-versioning` merged FF + deleted.

## Inventory (delta from 2026-04-12)

- **Source files added:** calibration.ts, strategy-compare.ts, 2 migration files, 2 migration tests, 1 CLI script.
- **Tests added:** 18 sprint-1 + 18 sprint-2 = 36 net new tests (66 → 163 total cumulative).
- **Memory entries added (this session):** 9 new under `~/.claude/projects/.../memory/`:
  trading_pivot, research_first, superpowers_tdd, trust_and_autonomy, news_sync_2h, mega_prompt, full_autonomy, partnership_identity, dont_derail, host_environment, sprint1_calibration_shipped, sprint2_versioning_shipped.
- **Docs added:** TRUST/SOUL/MISSION/HEARTBEAT/EVOLUTION/BACKLOG (all project root), 2 research notes, 2 sprint plans.
- **Crons added:** 1 (news sync, task 3d623e0e).

## Next Steps

1. **Sprint 3 — Regime tagging.** Add a `regime_snapshots` table (VIX bucket, BTC dominance, US 10y yield, days-to-major-event); annotate each signal at creation with current regime; expose per-regime Brier breakdown in `/poly calibration`. Closes the third foundational layer of the self-improvement loop. Estimated 4-6 hrs.
2. **Sprint 1.5 (small) — Drift dashboards beyond Brier.** Scan latency, rejection mix drift, market-count drift. Early-warning signals before P&L surfaces drift. ~2 hrs. Can interleave with Sprint 3.
3. **Sprint Email-A** — outbound AgentMail integration (HTML daily reports, fallback alerts). **Blocker:** Richard must specify `OPERATOR_EMAIL` destination address before this can proceed. API key is already in `.env`.
4. **Sprint 2.5 — Reflection pass on signals** (second-LLM critic for self-contradiction detection). Build after Sprint 3 lands; measure Brier delta via Sprint 2's A/B harness.

Selection rule: bot picks based on dependency order × marginal P&L impact (per `feedback_full_autonomy.md`). Default next sprint is **#1 (regime tagging)**.

## Gotchas & Notes

- **Codex CLI is flaky on Windows PowerShell.** Crashed mid-stream twice this session reading skill/AGENTS files. Workaround: use `--commit HEAD` in shorter passes; if still fails, self-review small modules and document in commit message. Don't block on codex review for advisory-only code (offline scripts, pure math); do block for risk-gates / paper-broker / pnl-tracker changes.
- **`CLAUDE.md` is in `.gitignore` BUT also tracked** (legacy from public-template phase). Edits commit fine; just confusing. Backlog: clean up `.gitignore` entry someday.
- **Partial blocker tracking in BACKLOG.md.** AgentMail key arrived but `OPERATOR_EMAIL` still missing. BACKLOG documents this so a future session doesn't try to ship Sprint Email-A without asking.
- **`docs/news/` is gitignored.** News cron writes there but content auto-prunes at 7 days. Don't surprise yourself by looking for these files in git history.
- **Model identity tagged on every signal as `claude-opus-4-6`.** Pulled from `POLY_MODEL` config which defaults to that. If we ever switch models, A/B compare must respect the new value.
- **Stale-training-data rule (memory `feedback_news_sync_2h`):** Claude 4.6 cutoff is ~May 2025; today is 2026-04-13. ~11 months of drift. Search-before-assert on anything time-sensitive.
- **Two pasted credentials in `.env` this session.** Both private repo, both gitignored, both confirmed loaded. Bot will not echo or persist beyond `.env`.
