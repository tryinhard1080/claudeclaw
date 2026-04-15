# Handoff — ClaudeClaw

## Last Session
- **Date**: 2026-04-15 (Sprint 2.5 reflection pass shipped)

## What Changed (2026-04-15 Sprint 2.5)

**Sprint 2.5 shipped — Reflection pass (second-LLM critic).**
- `src/poly/strategies/ai-probability-reflect.ts` — pure critic system prompt + `composeCriticUser` + `parseCriticResponse` + `applyReflectionRule` (confirm/revise/contradiction with midpoint-pull on contradictions). Async `runCritic` + `evaluateWithReflection` wrappers. `REFLECT_PROMPT_VERSION='v3-reflect'`.
- `src/poly/strategy-compare.ts` — new `compareStrategiesOnResolutions(db, vA, vB)` that joins poly_signals ↔ poly_resolutions directly (not via paper_trade_id). Shadow signals participate in Brier math.
- `src/poly/strategy-engine.ts` — new opts `reflectionEnabled` + injectable `critic`. After primary `insertSignal`, if enabled, `writeShadowReflection` logs a second row tagged v3-reflect with approved=0, rejection_reasons='shadow:reflect', paper_trade_id NULL. Shadow runs even when primary is gate-rejected (so reflection data accumulates on the full signal distribution).
- `src/config.ts` — `POLY_REFLECTION_ENABLED=false` default. Enable via `.env` + pm2 restart.
- `/poly reflect` Telegram command — shows reflection pair count, mean |shift|, live A/B Brier on resolved markets, top-5 largest recent shifts.
- **Tests**: 496/496 green (+22 new: 12 reflect pure-fn + 5 A/B resolution + 5 engine dual-write). Typecheck + build clean.
- **Zero-migration** sprint: no new tables. Reuses existing poly_signals + poly_resolutions schemas.
- **Design note**: contradiction path pulls probability to midpoint(initial, ask) rather than collapsing to market. Full-collapse would zero-edge every contradiction and structurally bias the A/B Brier toward v3; midpoint preserves gradient so the delta means something.

## Previous Session (2026-04-13, multi-sprint day)

## What Changed (2026-04-13 Sprint 1.5)

**Sprint 1.5 shipped — Drift dashboards.**
- `migrations/v1.8.0/v1.8.0-scan-runs.ts` — `poly_scan_runs` (started_at, duration_ms, market_count, status, error). One row per tick.
- `src/poly/drift.ts` — pure `percentile`, `latencyStats`, `rejectionMix`, `marketCountTrend` (baseline excludes latest), `composeDriftReport`, `formatDriftReport`. 13 unit + 2 migration tests.
- `market-scanner.runOnce` writes ok/error rows every tick, wrapped in try/catch.
- `/poly drift` — 24h p50/p95/p99 + market count trend + rejection mix by gate.
- Live render surfaces the data: `signal_quality: 668 (99%), position_limits: 5 (1%)` — Sprint 5's long-shot bias now visible at operator glance.
- 474 tests. pm2 restarted.

## What Changed (2026-04-13 Sprint 6)

**Sprint 6 shipped — Adversarial review cron.** No code, pure scheduling.
- Registered weekly Sunday 18:00 ET schedule (task `2c87cdca`).
- Prompt instructs agent to answer four evidence-backed questions each week: worst trade, false-negative rejection, miscalibrated regime/category, drift concern. Output appended to `docs/research/weekly-adversarial-YYYY-MM-DD.md` + Telegram summary.
- Skill: `adversarial-review` (or equivalent skeptical-QA analysis).
- **Three weekly/periodic crons now live**: news-sync (2h, `3d623e0e`), research-ingest (Sun 06:00, `3de52de7`), adversarial-review (Sun 18:00, `2c87cdca`). First adversarial review fires 2026-04-19.

## What Changed (2026-04-13 Sprint 5.5)

**Sprint 5.5 shipped — Market-price band filter.** Strategy-level fix surfaced by Sprint 5 backtest.
- `src/poly/strategy-engine.ts` `selectCandidates`: filters out markets where YES price is outside `[POLY_MIN_MARKET_PRICE, POLY_MAX_MARKET_PRICE]` (defaults 0.15/0.85).
- `src/config.ts`: `POLY_MIN_MARKET_PRICE=0.15`, `POLY_MAX_MARKET_PRICE=0.85`.
- Test coverage: long-shot (0.02) + near-cert (0.95) + in-band (0.4) → only in-band market evaluated.
- **Expected effect**: signal count per scan drops sharply but each remaining signal has potential for real edge. Measure over 7 days via `/poly signals`.
- pm2 restarted. 459 tests. Commit: sprint 5.5 in HANDOFF above.
- **Model**: Claude Opus 4.6 (1M context)
- **Previous session**: 2026-04-13 earlier (trading-only pivot + Sprints 1 & 2)

## What Changed (2026-04-13 Sprint 3)

**Sprint 3 shipped — Regime tagging + per-regime Brier.**
- `migrations/v1.5.0/v1.5.0-regime-tagging.ts` — new `poly_regime_snapshots` table + `regime_label` col on `poly_signals` + `by_regime_json` col on `poly_calibration_snapshots`. Idempotent, data-preserving, indexed.
- `src/poly/regime.ts` — pure bucket classifiers (`vixBucket`, `btcDomBucket`, `yieldBucket`), `composeRegimeTag`, composer/persistence DAO, `shouldRunRegimeSnapshot` gate, `fetchRegimeInputs` with per-upstream isolation. Free data sources: Yahoo `^VIX` + `^TNX`, CoinGecko `/global`. 27 tests.
- `src/poly/regime-migration.test.ts` — 4 tests (schema + column + idempotency + data preservation).
- Strategy engine writes `regime_label` from `latestRegimeSnapshot` on every signal. Null-safe on cold start.
- Calibration now carries `byRegime: [{regime, nSamples, brierScore}]`; `/poly calibration` renders top-5 regimes.
- `/poly regime` command shows latest snapshot (VIX / BTC dom / 10y yield + age).
- `initPoly` 5-min tick runs regime refresh gated by `POLY_REGIME_REFRESH_MIN=15`. Network errors isolated in `try/catch`.
- Config: `POLY_REGIME_REFRESH_MIN=15` added.
- **Live bug caught**: Yahoo `^TNX` format is percent-direct (4.3 = 4.3%), not `×10` as earlier-draft code assumed. Caught by real-network smoke test before shipping. Tests now match prod format.
- Migration applied to prod DB via `npm run migrate` (v1.4.0 → v1.5.0). pm2 restarted clean.

**Tests**: 458 total (+36 vs previous session). Typecheck + build clean.

## What Changed (2026-04-13 Sprint 4)

**Sprint 4 shipped — Research ingestion pipeline.**
- `migrations/v1.6.0/v1.6.0-research-ingest.ts` — `research_items` table with `UNIQUE(url)` dedupe + `upload_status` tracking. Indexed on fetched_at / source / upload_status.
- `src/poly/research-ingest.ts` — tolerant RSS 2.0 + Atom 1.0 regex parser (no XML dep), DAO, `validateFeedConfig`, `composeNoteContent`, `ingestFeed` orchestrator. HTTP fn injectable for tests. 15 tests + 3 migration tests.
- `docs/research/feeds.json` — 6 Tier-1 sources seeded (AQR, arXiv q-fin, Net Interest, Domer, Star Spangled Gamblers, Of Dollars and Data).
- `scripts/research-ingest.ts` CLI — `--tier N` / `--all-tiers` flags; writes run summary to `docs/research/ingestions/YYYY-MM-DD.md` (gitignored). Reads/writes prod DB.
- Optional NotebookLM upload path gated by `POLY_RESEARCH_NOTEBOOK_ID` env var (no-op until operator creates a trading notebook). Uses `nlm note create` via child_process.
- `/poly research` Telegram command shows last 10 ingested items.
- Weekly cron registered: task `3de52de7`, `0 6 * * 0` ET.
- Live smoke: 45 items ingested across arXiv q-fin, Net Interest, Of Dollars and Data. Second run: 0 new — UNIQUE dedupe confirmed.
- Known: AQR Insights + Star Spangled Gamblers feed URLs redirect to landing pages, not RSS. 0 items fetched. Operator can patch `docs/research/feeds.json` with working alternatives.

**Tests**: 441 total (earlier 458 count was stale — actual is 441). Typecheck + build clean.

## What Changed (2026-04-13 Sprint 5)

**Sprint 5 shipped — Backtesting harness.**
- `migrations/v1.7.0/v1.7.0-resolutions-cache.ts` — `poly_resolutions` (slug PK, closed, outcomes_json, fetched_at, resolved_at). Cache populated on-demand.
- `src/poly/backtest.ts` — `simulateOutcome` reuses `classifyResolution` from pnl-tracker for won/lost/voided semantics. YES-only BUY P&L math: won = shares×(1-entry), lost = -shares×entry, voided/open = 0. `runBacktest` aggregates. `composeMinEdgeSweep` runs across a threshold list. 14 unit tests + 3 migration.
- `scripts/fetch-resolutions.ts` — iterates distinct slugs in poly_signals, rate-limited to ~10 req/sec, UPSERTs cache.
- `scripts/backtest.ts` — loads + prints sweep table. `--from/--to/--kelly/--max-trade/--thresholds` flags.
- **Insight the backtester surfaced**: 639 historical signals fall in edge range 0.1-2.5pp; none reach the production 8pp threshold. Sample rows show `p=0.005, mp=0.003` — long-shot tail markets where the LLM has near-zero informational edge. Strategy-level follow-up: add midpoint-price band filter (prefer 0.2-0.8 markets).
- 13 distinct slugs in poly_signals (bot scans same top-volume markets repeatedly). 0 closed yet (~1 week of data — normal).

**Tests**: 458 total (+17 net). Typecheck + build clean. v1.7.0 applied to prod DB.

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

1. **Sprint 5.5 — Market-price band filter.** Strategy-level fix for the long-shot tail bias the backtester exposed. Add `POLY_MIN_MARKET_PRICE` / `POLY_MAX_MARKET_PRICE` (defaults 0.15 / 0.85) to the candidate selector so we stop evaluating markets where the LLM has no meaningful informational edge. ~1 hr. **Highest-impact next sprint** — the bot will start generating actionable signals instead of 639 near-zero-edge ones.
2. **Sprint 6 — Adversarial review cron** (EVOLUTION.md §4 #6). Weekly red-team report on recent decisions via `adversarial-review` skill. ~2-3 hrs.
3. **Sprint 2.5 — Reflection pass on signals.** Second-LLM critic for self-contradiction detection. Measure Brier delta via Sprint 2's A/B harness. ~1 day.
4. **Sprint 1.5 — Drift dashboards beyond Brier.** Scan latency, rejection mix drift, market-count drift. ~2 hrs. Interleaves.
5. **Sprint 4.5 — NotebookLM upload wiring.** Operator creates a trading notebook, sets `POLY_RESEARCH_NOTEBOOK_ID`, research-ingest auto-uploads. Code path shipped.
6. **Feed URL cleanup** (AQR, Star Spangled Gamblers). Low priority.
7. **Sprint Email-A** — still blocked on `OPERATOR_EMAIL`.

Selection rule: bot picks based on dependency order × marginal P&L impact (per `feedback_full_autonomy.md`). Default next sprint is **Sprint 1.5 (drift dashboards)** or **Sprint 2.5 (reflection pass)** — both ~2-hr, both compound with measurement infra already in place.

**Operational watch items:**
- Regime snapshots in `poly_regime_snapshots` every 15 min.
- Weekly research ingest fires Sun 06:00 ET (task 3de52de7).
- Resolution cache: refresh via `npx tsx scripts/fetch-resolutions.ts` before each backtest run. Consider scheduling weekly once closed-count > 20.

## Gotchas & Notes

- **Codex CLI is flaky on Windows PowerShell.** Crashed mid-stream twice this session reading skill/AGENTS files. Workaround: use `--commit HEAD` in shorter passes; if still fails, self-review small modules and document in commit message. Don't block on codex review for advisory-only code (offline scripts, pure math); do block for risk-gates / paper-broker / pnl-tracker changes.
- **`CLAUDE.md` is in `.gitignore` BUT also tracked** (legacy from public-template phase). Edits commit fine; just confusing. Backlog: clean up `.gitignore` entry someday.
- **Partial blocker tracking in BACKLOG.md.** AgentMail key arrived but `OPERATOR_EMAIL` still missing. BACKLOG documents this so a future session doesn't try to ship Sprint Email-A without asking.
- **`docs/news/` is gitignored.** News cron writes there but content auto-prunes at 7 days. Don't surprise yourself by looking for these files in git history.
- **Model identity tagged on every signal as `claude-opus-4-6`.** Pulled from `POLY_MODEL` config which defaults to that. If we ever switch models, A/B compare must respect the new value.
- **Stale-training-data rule (memory `feedback_news_sync_2h`):** Claude 4.6 cutoff is ~May 2025; today is 2026-04-13. ~11 months of drift. Search-before-assert on anything time-sensitive.
- **Two pasted credentials in `.env` this session.** Both private repo, both gitignored, both confirmed loaded. Bot will not echo or persist beyond `.env`.
