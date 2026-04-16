# Handoff — ClaudeClaw

## Last Session
- **Date**: 2026-04-15 evening — **Audit remediation run, 7 phases headless**
- **Model**: Claude Opus 4.6 (1M context)
- **Branch**: `fix/audit-remediation` (6 commits, not yet merged to main). Main branch unchanged from morning Sprint 9.

## Audit Remediation — 2026-04-15 evening

Read the audit diagnostic in session transcript; 10 findings ranked H/M/L. Executed 7-phase remediation plan headless.

**Phase 0 — Bot status check.** Scans healthy (544 runs, 18 signals/hr). **Telegram in 409 zombie loop** — multiple getUpdates conflicts. Not fixed this run; noted. Weekly crons never fired (bot hasn't been continuously running a full week yet).

**Phase 1.5 — Discipline scaffolding** (commit `c53b9e5`):
- `scripts/pre-commit-research-check.sh` — blocks src/poly + src/trading commits without a matching `docs/research/sprint-*.md` or `docs/plans/sprint-*.md`. Escape tags `[retro]` `[hotfix]` `[chore]` `[audit]` in commit message.
- `.git/hooks/pre-commit` + `commit-msg` delegate to the script.
- `docs/research/TEMPLATE-sprint.md` — 7-section required note.
- `CLAUDE.md` gains "Build Discipline" section + 30-min speed tripwire.
- `feedback_full_autonomy.md` memory amended: autonomy = scope, NOT process.
- Weekly adversarial cron (`2c87cdca`) extended to audit sprint-vs-note pairing.

**Phase 1 — Research backfill** (commit `caf8acf`):
- `sprint-9-exposure-aware-sizing.md` — verdict **complement, not duplicate**. Minor `maxDeployedPct` ceiling misalignment; fold into flag-enable commit.
- `regime-status-2026-04-15.md` — 35% NULL regime_label was a bug; threshold retune deferred until 30d + 3 distinct labels + 50 resolved trades.
- `sprints-1-through-8-retro.md` — catalog stub.

**Phase 2 — Regime NULL root cause fix** (commit `6dc9a6d`):
- `regime.ts`: export `UNKNOWN_REGIME_TAG = 'vunk_bunk_yunk'`.
- `strategy-engine.ts`: both signal-insert paths fall back to UNKNOWN_REGIME_TAG instead of NULL (lines 379, 402).
- Test flipped to assert tag + no NULL rows.
- `scripts/backfill-null-regime.ts` — applied: **626 NULL rows → `vunk_bunk_yunk`**.

**Phase 3 — Trading revival** (commit `05f3116`):
- `state-poller.ts`: new `instance_stale` event fires when state.json mtime > 1h (configurable). Fires exactly once per stale window; re-arms after fresh.
- `alerts.ts` + `types.ts`: INSTANCE STALE alert type.
- `index.ts`: wires event → Telegram alert.
- `state-poller.test.ts`: **6 new tests** (first tests ever in src/trading/).
- **Operator action owed**: restart regime-trader Python — `cd C:/Projects/regime-trader; python main.py --paper --instance spy-aggressive` (and spy-conservative). state.json mtime is 2026-04-11 → INSTANCE STALE alert will fire on next bot restart.

**Phase 4 — PA surface gated** (commit `232c733`):
- `POLY_PERSONAL_ASSISTANT_ENABLED=false` default.
- `/wa`, `/slack`, `/profile` commands + WhatsApp/Slack state machines gated.
- `/help` trimmed to trading commands.
- `src/slack-cli.ts` deleted.
- `voice.ts` + `loadProfile()` kept (partnership context).
- **Phase 4b owed**: full strip of whatsapp.ts/slack.ts/profile.ts modules (tendrils through db.ts, memory.ts, registry.ts, auto-delegate.ts, dashboard-html.ts). Dedicated future sprint.

**Phase 5 — Memory hygiene**: `project_architecture.md` memory fully refreshed to reflect trading-only post-pivot state.

**Phase 6 — Resolution analysis** (commit `3883283`): `docs/research/resolution-rate-analysis.md`. 0.39% approval rate, 0 paper resolutions yet, 11 market-level resolutions. Recommend **hold parameters**; re-check 2026-04-29. Parameter changes are Tier 3.

**Phase 7 — Wrap**: typecheck clean, full test suite 533/534 (one pre-existing schedule-cli isolation flake). dist rebuilt.

## Still owed (operator decisions)

1. **Restart regime-trader Python** — file-IPC partner has been down 4 days. See Phase 3 command above.
2. **Fix Telegram 409 zombie loop** — multiple getUpdates. Check `tasklist | grep node`, kill duplicates.
3. **Merge `fix/audit-remediation` → main** — no pushed commits yet. 6 commits ahead.
4. **Phase 4b** — full strip of whatsapp/slack/profile modules.
5. **Enable `POLY_EXPOSURE_AWARE_SIZING`?** — Tier 3. Sprint 9 audit says complement with one ceiling-misalignment fix owed.

## Branch state
`fix/audit-remediation`: 6 commits ahead of main. Typecheck clean. 533/534 tests pass. Ready to merge.

## Current State (end of 2026-04-15)

**Bot:** pm2 id 5, online, Phase C. Scans every 5 min, ~24 signals/hr evaluated. 6 approved signals cumulative, 4 trades open, 2 voided, 0 resolved yet.

**Tests:** 518/518 green (excluding 3 pre-existing flaky schedule-cli tests that fail when pm2 holds the DB lock — orthogonal bug, not today's regressions). Typecheck + build clean.

**Migration state:** v1.2.0 → v1.8.0 all applied. No new migrations this session (all three sprints were zero-migration).

**Active crons (4):**
- news-sync (2h cadence) — task `3d623e0e`
- research-ingest Sun 06:00 ET — task `3de52de7`
- resolution-fetch Sun 07:00 ET — task `a6e080bd` (new this session)
- adversarial-review Sun 18:00 ET — task `2c87cdca`

**Flag-gated features awaiting operator enable (all default off):**
- `POLY_REFLECTION_ENABLED=false` — Sprint 2.5 second-LLM critic. 2× LLM call volume when on.
- `POLY_EXIT_ENABLED=false` — Sprint 8 intraday take-profit (+30%) / stop-loss (-50%). Changes trade close semantics. Tier 3.

**Live DB snapshot** (via `npx tsx scripts/bot-stats.ts`):
- 1573 signals (6 approved, confidence mix: 1 high / 3 medium / 2 low)
- 4 open paper trades, 2 voided, 0 resolved
- 0 poly_resolutions (cron fires first time Sun 07:00 ET 2026-04-19)
- 0 calibration snapshots (waits on resolutions)

## Next Steps (ranked by unblocked marginal P&L)

1. **Observation window** — first real data arrives Sun 2026-04-19 when resolution-fetch cron runs. Calibration + A/B Brier become meaningful only after ~5-20 resolved markets. Revisit all flag-gated sprints with actual numbers.
2. **Operator decision — enable POLY_REFLECTION_ENABLED?** Doubles LLM call volume. Worth flipping once there's a first resolved batch to measure against.
3. **Operator decision — enable POLY_EXIT_ENABLED?** Suggest validating 30%/50% thresholds by looking at any of the 4 open positions' price history first. Tier 3.
4. **Sprint 9 candidates** (execution-side, unblocked):
   - **Category-conditioned calibration** — by-category Brier buckets, surfaces where the LLM has edge (politics vs sports vs crypto). ~2 hrs.
   - **Reflection-driven trust score into Kelly** — if v3 and v3-reflect disagree by >10pp, shrink size beyond the confidence multiplier. Compounds 2.5 + 7.
   - **Position re-evaluation on new info** — re-run the primary evaluator on open positions every N hours; if probability drops below entry price, exit. Costs 4× LLM calls per scan.
5. **Sprint 4.5 — NotebookLM upload wiring** — blocked on operator creating trading notebook + setting `POLY_RESEARCH_NOTEBOOK_ID`. Code path shipped.
6. **Sprint Email-A** — blocked on `OPERATOR_EMAIL`.

Selection rule: bot picks based on dependency order × marginal P&L impact (per `feedback_full_autonomy.md`). Default first-move on next session: run `npx tsx scripts/bot-stats.ts` to check what the weekend's cron produced, then pick a category-conditioned measurement sprint vs observation vs enabling a flag.

## What Changed (2026-04-15 Sprint 8)

**Sprint 8 shipped — Price-based position exits (take-profit + stop-loss).**
- First execution-side sprint after eight measurement/infra sprints. The bot could enter positions but only exit on resolution — if a YES bought at 0.3 moved to 0.7 intraday, we couldn't book the 40c/share. Now we can.
- `shouldExit` pure fn (paper-broker.ts): `{ entryPrice, currentPrice, takeProfitPct, stopLossPct }` → `{ reason: 'take_profit' | 'stop_loss' } | null`. Take-profit precedes stop-loss on ambiguous tick. Zero/negative thresholds disable that side. Degenerate entryPrice returns null.
- `exitPosition(db, tradeId, exitPrice, reason)` writes status='exited', realized_pnl = shares * (exitPrice - entryPrice), voided_reason='exit:<reason>'. Transactional. `WHERE status='open'` guard for concurrent-resolver double-close protection.
- `PnlTracker` constructor gained `opts: { exitEnabled, takeProfitPct, stopLossPct }`, all falling back to config. `runOnce` now returns `{ updatedOpen, resolved, exited }`. Resolution check runs first — if a market closed, that wins over any exit threshold.
- New event `position_exited` with `{ tradeId, slug, outcomeLabel, reason, entryPrice, exitPrice, realizedPnl }`.
- `getDailyRealizedPnl` now includes status='exited' so Gate 2 (daily loss floor) sees real intraday P&L.
- **Calibration + A/B Brier auto-exclude exited trades**: existing queries filter `status IN ('won','lost')` — an early exit has no counterfactual binary outcome, so excluding preserves Brier math integrity.
- **Defaults (flag-gated)**: `POLY_EXIT_ENABLED=false`, `POLY_TAKE_PROFIT_PCT=0.30`, `POLY_STOP_LOSS_PCT=0.50`. Operator enables after validating thresholds against 3-5 resolved markets.
- **Tests**: 518/518 green (+18 new: 8 `shouldExit` + 4 `exitPosition` + 6 `PnlTracker` integration). Typecheck + build clean. Zero migration.

## What Changed (2026-04-15 Sprint 7)

**Sprint 7 shipped — Confidence-weighted Kelly + resolution-fetch cron.**
- `confidenceMultiplier(conf, mults)` — pure map of `low/medium/high` → fraction, clamped to [0,1]. NaN / negative / zero → 0.
- `computeKellySize` takes optional `confidenceMult` param (defaults 1 for backward compat). Zero multiplier short-circuits to 0 before edge math.
- `StrategyEngine` reads `POLY_KELLY_LOW_MULT=0.3`, `POLY_KELLY_MED_MULT=0.7`, `POLY_KELLY_HIGH_MULT=1.0` (defaults discount low aggressively — also scales down Sprint 2.5 contradictions which force confidence=low).
- Engine passes `est.confidence` through to Kelly sizing so low-conf signals get ~30% the position of high-conf at identical edge.
- `scripts/bot-stats.ts` — quick inventory script (signals by approved/version/confidence, trades by status, resolution count, edge distribution). Promoted from a throwaway query.
- **Cron registered**: weekly resolution-fetch `0 7 * * 0` ET (task `a6e080bd`). Populates `poly_resolutions` so calibration + Sprint 2.5 A/B Brier have data once markets close. Four live crons now: news-sync (2h), research-ingest (Sun 06:00), resolution-fetch (Sun 07:00), adversarial-review (Sun 18:00).
- **Tests**: 500/500 green (+4 new: 3 Kelly-multiplier + 1 engine end-to-end showing low < med < high at identical edge). Typecheck + build clean.
- **Live DB snapshot that drove this sprint**: 1573 signals, 6 approved (1 high, 3 medium, 2 low confidence), 4 trades open + 2 voided, 0 resolutions yet, 0 calibration snapshots. Mixed confidence on approvals meant Kelly was over-sizing low-conf positions relative to their trust signal.

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

_(The consolidated Current State / Next Steps now live at the top of this file. Historical per-sprint diffs remain above as a running log.)_

## Gotchas & Notes

- **Codex CLI is flaky on Windows PowerShell.** Crashed mid-stream twice this session reading skill/AGENTS files. Workaround: use `--commit HEAD` in shorter passes; if still fails, self-review small modules and document in commit message. Don't block on codex review for advisory-only code (offline scripts, pure math); do block for risk-gates / paper-broker / pnl-tracker changes.
- **`CLAUDE.md` is in `.gitignore` BUT also tracked** (legacy from public-template phase). Edits commit fine; just confusing. Backlog: clean up `.gitignore` entry someday.
- **Partial blocker tracking in BACKLOG.md.** AgentMail key arrived but `OPERATOR_EMAIL` still missing. BACKLOG documents this so a future session doesn't try to ship Sprint Email-A without asking.
- **`docs/news/` is gitignored.** News cron writes there but content auto-prunes at 7 days. Don't surprise yourself by looking for these files in git history.
- **Model identity tagged on every signal as `claude-opus-4-6`.** Pulled from `POLY_MODEL` config which defaults to that. If we ever switch models, A/B compare must respect the new value.
- **Stale-training-data rule (memory `feedback_news_sync_2h`):** Claude 4.6 cutoff is ~May 2025; today is 2026-04-13. ~11 months of drift. Search-before-assert on anything time-sensitive.
- **Two pasted credentials in `.env` this session.** Both private repo, both gitignored, both confirmed loaded. Bot will not echo or persist beyond `.env`.
