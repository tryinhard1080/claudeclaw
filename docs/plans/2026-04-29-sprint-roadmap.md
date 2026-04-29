# ClaudeClaw Sprint Roadmap — 2026-04-29

## Purpose

A complete enumeration of every sprint, chore, and operational unblocker known to the bot as of 2026-04-29. The roadmap does not commit to an order; selection rule below lets the bot self-prioritize based on dependency and marginal-impact.

## Success criteria for this plan

The plan is "working" if all four hold:

1. Every shipped sprint (1 through 19) is listed with one-line status.
2. Every pending sprint has: ID, name, blocker, target metric, effort estimate, and research-note status.
3. Every blocker has a named unblocker (operator action, data window, or upstream sprint).
4. A future session, given only this file plus `MISSION.md` and `HANDOFF.md`, can pick the next sprint to work on without further operator input (subject to Tier-3 ask-first rules).

## Status snapshot (2026-04-29)

| Item | State |
|---|---|
| Bot | `claudeclaw-main` pm2 id 10, online, exec cwd `C:\Code\claudeclaw`, restarts=1, uptime ~2h |
| HEAD | `218621c` on `main`, in sync with `origin/main` |
| DB | `C:\claudeclaw-store\claudeclaw.db`, schema v1.13.0, ~10 open positions, halt cleared |
| Crons | 6 active: news-sync (3d623e0e), research-ingest (3de52de7), adversarial-review (2c87cdca), db-backup-nightly, resolution-fetch (a6e080bd), Phase-7 archival (c2acdc12) |
| OneDrive cutover Phase 7 | Not yet completed; see Track B below |
| Working-tree residues | `M .claude/settings.json` (harness $schema URL), `M src/poly/gamma-client.ts` (operator perf improvement, uncommitted), `?? .env.stale-2026-04-26.bak`, `?? docs/research/atlas-self-improving-trading-agents.md` |
| Real-money gate | 4 of 7 boxes still open (1 at day 8/30, 2 awaiting market resolution, 7 awaiting operator A1/A2/A3 acks) |

## Track A: Already shipped sprints (1 through 19)

For reference. Pulled from HANDOFF.md and git log. Each entry is a one-line capability summary.

| # | Topic | Status |
|---|---|---|
| 1 | Calibration tracker (Brier, log-loss, 10-bucket curve, daily snapshot) | shipped |
| 1.5 | Drift dashboards (scan latency, market-count, rejection mix) | shipped |
| 2 | Strategy versioning + A/B compare harness (paired Brier + paired t-test) | shipped |
| 2.5 | Reflection pass (second-LLM critic) | shipped, flag-gated off pending calibration |
| 3 | Regime tagging (VIX, BTC dom, 10y yield) on every signal | shipped |
| 4 | Research ingestion pipeline (RSS/Atom to research_items) | shipped |
| 5 | Backtesting harness (resolutions cache, simulateOutcome, min-edge sweep) | shipped |
| 5.5 | Market-price band filter (POLY_MIN/MAX_MARKET_PRICE 0.15/0.85) | shipped, live |
| 6 | Adversarial review cron (Sun 18:00 ET) | shipped, currently skips on auth-absent |
| 7 | Confidence-weighted Kelly + resolution-fetch cron | shipped |
| 8 | Price-based exits (take-profit + stop-loss) | shipped, flag-gated off pending calibration |
| 9 | Exposure-aware Kelly sizing | shipped, flag-gated off, ceiling refinement pending (see Sprint 25) |
| 10 | outcomePrices nullish in GammaMarketSchema | shipped, hotfix |
| 11 | Digest expansion (regime + calibration + positions detail) | shipped |
| 12 to 15 | Dashboard cards: P&L, sparkline, signal-reasoning expand, calibration + drift | shipped |
| 16 | /poly halt + /poly resume Telegram commands | shipped, drilled (C10) |
| 17 | Edge-triggered auto-halt on drawdown | shipped |
| 18 | News-sync revival (Perplexity REST, kind=shell) | shipped, currently 0 rows because PPLX key exhausted |
| 19 | Nightly DB backup + dashboard heartbeat | shipped |

## Track B: Pending sprints (capability work)

Each row: ID, capability, blocker, target metric, effort, research-note status. Effort is rough order of magnitude.

### Sprint 20: News injection into ai-probability prompt
- **Capability**: variant strategy `ai-probability-news` reads last-N rows from `news_items` and injects them into the GLM prompt as a `# Recent context` section.
- **Blocker**: PPLX key replacement (cron writes 0 rows currently). Once key replaced, ~12 rows/day.
- **Target metric**: paired Brier delta `(v5-news-shadow) minus (v4)` of at most -0.01 over >=30 paired markets, paired t-test p<0.10.
- **Effort**: 3 to 5 hours (one new strategy file, one test file, one SQL helper).
- **Research note**: `docs/research/sprint-20-news-injection.md` (committed 2026-04-29).
- **Tier**: 2 ship, 3 flag-flip.

### Sprint 21: Telegram-intersection-alert revival (sister to Sprint 18)
- **Capability**: when a fresh `news_items` row's content references a category with an open paper position, post a one-line Telegram alert. Restores the consumer Sprint 18's port to kind=shell dropped.
- **Blocker**: PPLX key replacement (same as Sprint 20). Independent of Sprint 20 but shares the data pipe.
- **Target metric**: ratio of operator-acted-on alerts / total alerts (target >=10% to justify cost in attention).
- **Effort**: 2 to 3 hours (intersection logic in `news-sync.ts`, Telegram-post helper, one test).
- **Research note**: not yet drafted.
- **Tier**: 2.

### Sprint 22: Cron prompt versus execution alignment audit
- **Capability**: audit every row in `scheduled_tasks`. For `kind=shell` rows, the stored `prompt` is documentation only; flag any prompt that references behavior the shell script does not implement. For `kind=claude-agent` rows, confirm the prompt still matches the desired agent behavior. Update or rewrite stale prompts; add a `prompt_kind` discriminator if useful.
- **Blocker**: none.
- **Target metric**: zero stored prompts that describe behavior not implemented in the linked shell script.
- **Effort**: 1 to 2 hours (read all rows, compare to linked scripts, edit prompts).
- **Research note**: not yet drafted.
- **Tier**: 2. Could go in as `[audit]`.

### Sprint 23: Claude-agent auth wiring for kind=claude-agent crons
- **Capability**: configure `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) in `.env` so that `kind=claude-agent` crons can spawn sessions instead of skipping. Currently `2c87cdca` (adversarial-review) and `c2acdc12` (Phase 7 archival) silently skip.
- **Blocker**: operator must source the token (Claude Code subscription provides one) and add it to `.env`. Tier 3 because it gives the bot autonomous spend authorization.
- **Target metric**: next adversarial-review cron fire writes a non-empty file in `docs/research/weekly-adversarial-YYYY-MM-DD.md`.
- **Effort**: 5 minutes ops, plus an audit of which crons depend on it before flipping (since enabling silently lets all dormant kind=claude-agent crons fire).
- **Research note**: not needed (config change, not strategy code).
- **Tier**: 3.

### Sprint 24: Eval-cache key recency-awareness
- **Capability**: extend the eval cache key in `src/poly/strategies/ai-probability.ts:189-201` from `(slug, outcome_token_id, day-bucket)` to include a `news_window_hash` or `news_max_fetched_at`, so a 9am cache hit does not serve an 8pm probability when news context has shifted.
- **Blocker**: only matters if Sprint 20 ships; can be folded into the same commit.
- **Target metric**: zero cache hits across a `news_items` row insert in a `news_window_hash` integration test.
- **Effort**: 1 hour, ride along with Sprint 20.
- **Research note**: covered in Sprint 20's note; standalone note not needed.
- **Tier**: 2.

### Sprint 25: Sprint-9 ceiling refinement
- **Capability**: change `computeAvailableCapital` in `src/poly/strategy-engine.ts:123-129` to use `maxDeployedPct * paperCapital - exposure` as the ceiling, so the sizer and gate-1 agree on the same frontier. Caught in `docs/research/sprint-9-exposure-aware-sizing.md` as a nit; kept out of Sprint 9 to keep that sprint surgical.
- **Blocker**: must land before any Sprint-9 flag-flip (Tier 3) so the flag-on behavior is internally consistent.
- **Target metric**: in a backtest where deployedUsd > 0.7 * maxDeployed, sizer output equals `min(kelly_size, gate_ceiling)`.
- **Effort**: 30 minutes plus a regression test.
- **Research note**: extension of existing sprint-9 note; one-paragraph addendum sufficient.
- **Tier**: 2 ship, 3 flag-flip (which is Sprint 9 flag-flip itself).

### Sprint 26: Phase 7 OneDrive archival re-issue
- **Capability**: re-execute the OneDrive cutover Phase 7 archival that `c2acdc12` was supposed to do but silently skipped. Move `C:\Users\Richard\OneDrive...\CCBot1080\claudeclaw\` to `C:\_archive\2026-04-26\claudeclaw-onedrive\`. Drop `stash@{0}`.
- **Blocker**: depends on either Sprint 23 (Claude auth, so c2acdc12 can fire next year) or operator manual run. Recommend operator manual since waiting a year is silly.
- **Target metric**: OneDrive parent dir does not contain `claudeclaw`; `_archive/2026-04-26/claudeclaw-onedrive/` exists; stash list is empty.
- **Effort**: 5 minutes (verification re-run + 3-line move + stash drop + commit).
- **Research note**: not needed (operational, not capability).
- **Tier**: 2.

### Sprint 27: Resolution-fetch backfill audit
- **Capability**: audit `poly_resolutions` for stuck or missing rows. Cross-check `poly_signals.slug` distinct count against `poly_resolutions` distinct count. Flag any markets that resolved on Polymarket but didn't make it into the cache.
- **Blocker**: needs >=20 closed markets for the audit to be meaningful. Per HANDOFF: "Consider scheduling weekly once closed-count > 20."
- **Target metric**: 100% of `poly_signals.slug` that have a Polymarket-resolved status appear in `poly_resolutions` with a non-null `resolved_at`.
- **Effort**: 1 hour.
- **Research note**: not yet drafted.
- **Tier**: 2.

### Sprint 4.5: NotebookLM upload wiring (already part-built)
- **Capability**: code path exists in `src/poly/research-ingest.ts` to call `nlm note create` when `POLY_RESEARCH_NOTEBOOK_ID` is set. Currently a no-op because operator hasn't set the env var.
- **Blocker**: operator creates a "ClaudeClaw Research" notebook in NotebookLM and sets `POLY_RESEARCH_NOTEBOOK_ID` in `.env`.
- **Target metric**: weekly research-ingest run uploads N items where N matches the new-rows count from that run.
- **Effort**: 0 (code shipped); 5 minutes operator ops.
- **Research note**: not needed.
- **Tier**: 2.

### Sprint Email-A: outbound email reports
- **Capability**: rich-HTML daily and weekly trading reports via AgentMail SDK.
- **Blocker**: `OPERATOR_EMAIL` not set. AGENTMAIL_API_KEY is in `.env` per HANDOFF.
- **Target metric**: first weekly digest email lands in operator inbox; operator confirms receipt.
- **Effort**: 3 hours (composer using existing `digest.ts` content + AgentMail send + cron).
- **Research note**: `docs/research/agent-mail-integration.md` already exists.
- **Tier**: 2.

### Sprint Email-B: inbound email handling
- **Capability**: parse brokerage confirmations and ingest newsletters via AgentMail webhook.
- **Blocker**: depends on Email-A (need outbound proven before inbound).
- **Target metric**: parses 1 sample confirmation correctly per parser test fixture.
- **Effort**: 4 hours.
- **Research note**: same as Email-A.
- **Tier**: 2.

## Track C: Pending sprints (flag-flip / Tier-3 only)

These are sprints where the code already shipped flag-gated. Flag-flip waits on calibration data and operator nod.

| Flag | Source sprint | Blocker | Decision window |
|---|---|---|---|
| `POLY_REFLECTION_ENABLED` | 2.5 | Need >=20 resolved trades to A/B v4 vs v4-with-reflection | Earliest decision: 2026-05-15 (assuming resolution rate steady) |
| `POLY_EXIT_ENABLED` | 8 | Need >=15 resolved trades to detect exit-vs-hold P&L delta | Earliest decision: 2026-05-15 |
| `POLY_EXPOSURE_AWARE_SIZING` | 9 | Same as Sprint 25 (ceiling refinement) plus calibration data | Sprint 25 first, then earliest 2026-05-15 |

All three are Tier 3. Flag-flip requires explicit operator nod in MISSION.md sign-off log.

## Track D: Real-money gate progression

Reproduced from `MISSION.md` for visibility. The bot can monitor and report; only the operator can sign off.

| Box | Status | Unblocker |
|---|---|---|
| 1. 30 days unattended paper | Day 8 of 30 (clock 2026-04-21 to 2026-05-21) | Time + zero unplanned restarts |
| 2. >=50 resolved trades, +EV | 0 of 50 resolved | Time + market activity (~3 to 6 weeks at current rate) |
| 3. regime-trader Sharpe >0 over 60 days paper | Pending fetch-window fix in different repo | External repo work |
| 4. Drawdown <= halt threshold | Green | Stay green |
| 5. No P0/P1 codex findings | Closed (commit `d186090`) | Maintain on each commit |
| 6. Kill-switch tested | Closed (drills C10 + C11 signed in MISSION) | Re-drill quarterly |
| 7. Operator written sign-off | A1, A2, A3 still PROPOSED in MISSION sign-off log | Operator strikes PROPOSED on each |

## Track E: Open chores (housekeeping)

Not capability work. These are corrections and cleanups that compound if neglected.

| Chore | Description | Effort | Tier |
|---|---|---|---|
| .gitignore extension | Add `.env*.bak` pattern so `.env.stale-*.bak` does not show as untracked | 30 sec | 2 |
| Anthropic key rotation | Rotate the leaked key per cutover plan deferred decision; then delete `.env.stale-2026-04-26.bak` | 5 min ops | 2 |
| PPLX key replacement | New key from `perplexity.ai/account/api/keys`, update `.env`, restart with `pm2 restart claudeclaw-main --update-env`. Unblocks Sprints 20 + 21 | 5 min ops | 2 |
| gamma-client perf commit | An uncommitted `M` modification on `src/poly/gamma-client.ts` exists (parallel page fetch, `fetchActiveMarkets` 400-600s to ~35s). Operator authored. Decide: commit, hold, or revert | 5 min review | 2 |
| atlas research note | `docs/research/atlas-self-improving-trading-agents.md` is untracked from an earlier session. Decide: commit, hold, or discard | 5 min review | 2 |
| Stash drop | `stash@{0}: pre-cutover stale tree 2026-04-26`. Drop after Sprint 26 (Phase 7) succeeds | 30 sec | 2 |
| Cron auto-cleanup | Delete `c2acdc12` from `scheduled_tasks` after Sprint 26 (or convert kind to shell so it can self-execute without auth) | 1 min | 2 |
| Resolution-cache scheduling | Per HANDOFF "Consider scheduling weekly once closed-count > 20"; add a recurring `npx tsx scripts/fetch-resolutions.ts` cron | 5 min | 2 |
| Settings.json $schema URL | Currently `M` from a harness auto-update. Decide: commit, leave, or revert | 30 sec | 2 |

## Track F: Selection rule

When the bot picks the next thing to do, the rule is:

1. Filter to sprints with all blockers resolved.
2. Among those, prefer ones that unblock OTHER pending sprints (dependency leverage).
3. Among the remaining, prefer ones with the highest expected marginal P&L impact (per `feedback_full_autonomy.md`).
4. Tie-break by effort: smaller first.
5. Tier 3 actions (flag-flips, capital changes, real-money) require explicit operator nod regardless of priority score.

For 2026-04-29 right now, applying the rule:

- **Highest leverage chore**: PPLX key replacement (5 min, unblocks Sprints 20 and 21 simultaneously).
- **Highest leverage sprint with all blockers resolved**: Sprint 22 (cron prompt audit, no blocker, prevents future drift like the Sprint 18 lost-consumer issue).
- **Cleanest one-shot**: Sprint 26 (Phase 7 archival, 5 minutes, finishes the cutover and lets the rollback target be retired).

If the operator does the PPLX key in 5 minutes, Sprint 20 becomes the highest-impact sprint (first capability addition that turns collected news data into trading signal).

## Track G: Open questions for the operator

Numbered for easy reference; answer in chat or directly in `MISSION.md`.

1. **A1, A2, A3 acks**: still PROPOSED in `MISSION.md` sign-off log. Required to close gate box 7.
2. **PPLX key**: do you want to rotate now, or defer Sprints 20 and 21 until later?
3. **CLAUDE_CODE_OAUTH_TOKEN**: do you want to add this to `.env` so `kind=claude-agent` crons can fire, or keep them in skip-mode (which is the safe default per A3 reasoning)?
4. **Phase 7 OneDrive archival**: manual run now, or wait for Sprint 23 then 2027 cron fire? Recommend manual now.
5. **gamma-client.ts**: who authored the `fetchActiveMarkets` parallelization, and is it ready to commit? Or is it work-in-progress?
6. **OPERATOR_EMAIL**: still missing. Required for Sprint Email-A.
7. **POLY_RESEARCH_NOTEBOOK_ID**: NotebookLM trading notebook still not created. Required for Sprint 4.5 to do anything beyond local DB writes.

## Verifiable success for this plan as a whole

This plan is delivered if all four hold (matching the success criteria stated upfront):

- [x] Every shipped sprint enumerated (1 through 19).
- [x] Every pending sprint has ID, blocker, target metric, effort.
- [x] Every blocker has a named unblocker.
- [x] A future session can pick the next sprint without operator input (within Tier 2; Tier 3 still asks).

---

Plan committed to git as a snapshot. Update by overwrite, not by appending; this file is a roadmap, not a journal.
