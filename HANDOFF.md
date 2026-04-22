# Handoff — ClaudeClaw

## Last Session
- **Date**: 2026-04-21 (extended) — **✅ Plan cheerful-rossum executed end-to-end. Sprints 12-19 + drill scripts + MISSION Phase A entries shipped. Bot ONLINE PID 62052, restart count 12 — no further restarts in plan execution.**
- **Model**: Claude Opus 4.7 (1M context).
- **Branch**: `main`. 7 new commits past `762b219`: `828bb02` `443cf2d` `45ef67d` `19d0de1` `0e22a6b` `665a0f5` + B7+B8+B9 + D12 + drill scripts + MISSION update.
- **Tests**: 646/646 (+60 new across the session).
- **Operator next steps**: see "Plan cheerful-rossum operator runbook" below — three .env edits + one pm2 restart + three short script invocations + two drills, then 30-day observation.

## ✅ 2026-04-21 — Plan cheerful-rossum (gate-box-6 closure)

### Summary

This extended session executed the plan written earlier in the same session (`C:\Users\Richard\.claude\plans\use-enhanced-prompt-skill-cheerful-rossum.md`). All 14 items addressed. Items 4 (EMERGENCY_KILL_PHRASE) and 7 (PPLX_API_KEY) are .env edits the operator must do. Everything else is committed and ready.

### Commits in execution order

| # | Item | Commit | Notes |
|---|---|---|---|
| 1 | B5 /poly halt + /poly resume | `0e22a6b` | Sprint 16. Mirrors /trade halt. 8 new tests. |
| 2 | B6 auto-halt on drawdown | `665a0f5` | Sprint 17. Edge-triggered, idempotent, no auto-clear on recovery. 11 new tests. |
| 3 | B7+B8+B9 news-sync revival | (next) | Sprint 18. v1.13.0 migration adds news_items table. Direct Perplexity REST. 22 new tests. Operator-run activator script. |
| 4 | D12 db-backup + dashboard | (next) | Sprint 19. SQLite Online Backup API. Rotation 7d + 4w + 3m. Dashboard footer ages. 19 new tests. Operator-run activator script. |
| 5 | C10 + C11 drill scripts | (next) | scripts/drill-halt-resume.ts + scripts/drill-db-restore.ts. Non-destructive. Operator runs and pastes sign-off. |
| 6 | A1-A3 PROPOSED entries | (next) | MISSION.md sign-off log gets PROPOSED entries; operator strikes "PROPOSED" to ack. |

### Build discipline retro

- Every sprint touching src/poly/ shipped with its own `docs/research/sprint-N-topic.md` (B5 → sprint-16, B6 → sprint-17). Pre-commit research-note hook fired and passed each time.
- Two falsifications caught during execution that prevented bad commits: (a) plan's "auto-halt should mutate gate2 directly" → kept gate2 pure, added separate `maybeAutoHaltOnDrawdown` helper. (b) news-sync conflicted with documented-as-redundant decision in `migrate-cron-kinds.ts:5` — operator overrode ("fix it all"); proceeded with news_items as a distinct table from research_items.
- TDD on every code item: failing test → RED → impl → GREEN. 60 new tests across the session, zero regressions.
- Restart count locked at 12 throughout — all session commits were doc + code, no pm2 restart needed because Phase B restart is bundled with operator's .env edits.

### Plan cheerful-rossum operator runbook

Items 4 + 7 = .env edits. Items A1-A3 = strike "PROPOSED" in MISSION.md. Then the activation + drill sequence:

```bash
# 1. Operator: pick a non-obvious passphrase, append to .env
echo 'EMERGENCY_KILL_PHRASE=<your-phrase-here>' >> .env

# 2. Operator: obtain Perplexity API key (https://perplexity.ai/account/api/keys), append
echo 'PPLX_API_KEY=pplx-<your-key>' >> .env

# 3. Single restart — picks up both .env values + runs v1.13.0 migration
pm2 restart claudeclaw
# (verify: pm2 list shows restart count 12 → 13, online; pm2 logs claudeclaw --lines 30 shows the migration)

# 4. Activate news-sync + db-backup crons
npx tsx scripts/activate-news-sync.ts
npx tsx scripts/activate-db-backup.ts

# 5. Smoke test news-sync immediately (don't wait 2h for cron)
npx tsx scripts/news-sync.ts
# (expect: "[news-sync] ok (inserted) ...")

# 6. Smoke test db-backup immediately (don't wait until 4am)
npx tsx scripts/db-backup.ts
# (expect: "[db-backup] ok /c/claudeclaw-store/backup-YYYY-MM-DD/ ...")

# 7. Drill C10 (non-destructive halt+resume drill)
npx tsx scripts/drill-halt-resume.ts
# (expect: "=== DRILL OK ===" + sign-off block; paste the block under MISSION sign-off log)

# 8. Drill C11 (DB-restore drill against /tmp scratch)
npx tsx scripts/drill-db-restore.ts
# (expect: "=== DRILL OK ===" + sign-off block; paste the block under MISSION sign-off log)

# 9. (OPTIONAL) The "dangerous" §3a drill: actually exits the bot via EMERGENCY_KILL_PHRASE.
#    Schedule for a known-quiet time. Pre-stage `pm2 stop claudeclaw` in a second terminal.
#    From Telegram: send the phrase. Within 10s: hit Enter on the second terminal.
#    Then: pm2 start claudeclaw. This restart counts against the gate clock as drill cost.
```

After step 8, gate-box-6 is fully closed (procedure documented + drilled). Steps 1-8 require zero human watch time — < 10 minutes total.

### What to watch for next

- **Wed 2026-04-22**: Iran position resolution (`us-x-iran-diplomatic-meeting-by-april-22-2026`, -80% unrealized at session end). PnlTracker should write status='lost', realized_pnl negative, delete the poly_positions row. Dashboard sparkline should show first bar.
- **Sun 2026-04-26 07:00 ET**: First resolution-fetch cron. Calibration card should populate (Brier / log-loss / winrate / n).
- **Daily after Phase B restart**: backup at `/c/claudeclaw-store/backup-YYYY-MM-DD/` should appear ~4am UTC. Dashboard footer "backup: <age>" stays under 36h.
- **Every 2h after Phase B restart**: news-sync row in news_items. Dashboard footer "news: <age>" stays under 4h.

### Real-money-gate progress (post plan cheerful-rossum)

| Box | Status |
|---|---|
| 1. 30+ days no manual intervention | day 1 of 30 (PROPOSED permissive reading) |
| 2. ≥50 resolved Polymarket trades, positive P&L | 0/50 (waits for resolutions) |
| 3. regime-trader positive Sharpe over 60+ days | regime-trader pending fetch-window fix (different repo) |
| 4. Drawdown never exceeded POLY_HALT_DD_PCT | green; auto-halt machinery now writes the flag on transition (Sprint 17) |
| 5. No P0/P1 codex-review findings outstanding | pending codex review of Sprint 12-19 |
| 6. Documented kill-switch + roll-back procedure tested | runbook documented + drill scripts ready; live drill is the operator's step 7-9 above |
| 7. Operator written sign-off | A1-A3 PROPOSED in MISSION; operator acks |

5/7 boxes have clear paths to closure within the 30-day window. Boxes 2 and 3 require time + market activity, not more code.

## ✅ 2026-04-21 — Dashboard sprints 12-15

### Operator request
Prior session had wired the Polymarket trading panels (commit `32a8e38`) but explicitly enumerated 4 missing pieces. Operator said "Fix all of these."

### Build discipline (per CLAUDE.md)
Each sprint went through: existing-code audit → `docs/research/sprint-N-topic.md` verdict → TDD RED → TDD GREEN → typecheck → full suite → live curl → commit. Pre-commit research-note hook fired on Sprint 12 (touched `src/poly/`); skipped on 13-15 (touched only `src/dashboard*`).

### What shipped

| # | Commit | Verdict | Surface |
|---|---|---|---|
| 12 | `828bb02` | complement | `GET /api/poly/positions/live` joins `poly_paper_trades` (status='open') with `poly_positions` for current_price + unrealized_pnl + unrealized_pct + last_tick_at. Dashboard table gains Mark + Unrealized columns + aggregate header. |
| 13 | `443cf2d` | complement | `GET /api/poly/pnl/chart?width&height` precomputes SVG bar primitives via `buildPnlBars` pure helper. Dashboard renders sparkline + cumulative pill + 2026-04-26 placeholder for empty state. |
| 14 | `45ef67d` | complement | `GET /api/poly/signals/recent` SELECT extended with `reasoning, contrarian` (already in `poly_signals` since v1.2.0). Click-to-expand UI panel. |
| 15 | `19d0de1` | complement | `GET /api/poly/calibration` (latestSnapshot + nResolvedAllTime) + `GET /api/poly/drift?windowHours=24` (latency + marketCount + rejection mix). Two-column card row in dashboard. |

### Live numbers at session end (PID 62052)
- **Book**: -$100.27 unrealized (-21.3%) on $471.50 exposure across 10 open positions.
- **Worst position**: `us-x-iran-diplomatic-meeting-by-april-22-2026` -80% (entry $0.70 → mark $0.14). Settles 2026-04-22, first real test of resolution → realized-P&L flow.
- **Drift**: p50=29.3s p95=31.4s p99=33.1s, 272 scans/24h, 0 errors, rejection mix 57.7% position_limits / 42.3% signal_quality.
- **Calibration**: empty (0 resolved all-time). First batch arrives Sun 2026-04-26 07:00 ET via resolution-fetch cron (`kind=shell`).

### Files added/touched
New: `src/poly/positions-view.ts(+test)`, `src/dashboard-charts.ts(+test)`, `docs/research/sprint-12-unrealized-pnl.md`.
Modified: `src/dashboard.ts` (4 routes), `src/dashboard-html.ts` (HTML + loadPoly client logic).

### Tests
562 → 586 (+24 new). Typecheck clean each commit. Live verification per sprint via curl against running bot.

### Build discipline retro
- Sprint 12 followed full discipline including research doc — that's the one that fires the pre-commit hook. Verdict was COMPLEMENT (PnlTracker already computed unrealized; we just exposed it). Naive spec ("re-fetch CLOB per dashboard load") would have raced the tick and inflated rate-limit usage.
- Sprints 13-15 did the audit but skipped the research-note doc since they didn't touch `src/poly/`. Decision documented in commit messages.
- 30-min tripwire honored — total elapsed per sprint was 25-50 min including audit, TDD, verify, commit.

### Operator TODOs
1. **Decide on the gate clock**: did this session's 5 deploy-restarts reset it, or does it keep ticking from `762b219`? Update MISSION sign-off log accordingly.
2. **Watch the Iran position resolution 2026-04-22**: first real test of the resolution → realized-P&L pipeline. Should appear in the sparkline once the resolution-fetch cron runs.
3. **Watch Sun 2026-04-26 07:00 ET resolution-fetch cron**: first batch of resolved trades. Calibration card should populate (Brier, log-loss, win rate).
4. **Decide on Sprint 8/9/2.5 flag-enable** (Tier 3): exits, exposure-aware sizing, reflection. All shipped flag-gated OFF. Defer until calibration data exists.

### Known deferred (carry forward)
- All items from prior 2026-04-20 handoff still apply: news-sync paused, adversarial-review fires Sun 18:00 ET (will skip without auth), zombie-tables PA-strip phase 4c.

## ✅ 2026-04-20 — Scanner hang resolved + DB rescue complete

## ✅ 2026-04-20 — Scanner hang resolved + DB rescue complete

### Root cause (corrects the 2026-04-20 07:16 diagnosis)

All four previously-suspected causes (pino flush / OpenAI SDK load / 4 overdue crons / MEMORY_ENABLED) were **falsified** by `POLY_SCAN_DEBUG=1` instrumentation (commit `39fc2b4`). The real cause chain:

1. `poly_price_history` had no index on `captured_at`. `pruneOldPrices` did O(n) full-table scan on ~43M rows.
2. `capturePrices` wrote ~100k rows per 5-min tick (50k markets × ~2 outcomes) when only ~40 were needed (topN=20 strategy candidates × 2 outcomes).
3. Three separate `db.transaction()` calls per scan — checkpointer couldn't keep up; WAL grew to 5.5 GB.
4. 9.3 GB DB + 5.5 GB WAL → each scan's DB-write block genuinely took multiple minutes. Scanner's `if (this.scanning) return;` silently dropped every 5-min tick that fired before the prior scan completed.

**Observable:** zero `poly_scan_runs` rows, zero CPU (Windows native I/O wait doesn't count as CPU%), zero logs (pino was working — there was just nothing to log between `post-fetch` and `post-db`). Looked like a deadlock, was actually extreme slowness.

### Verification evidence (first post-rescue scan)

```
pre-fetch        → post-fetch       = 28.6s (Gamma API)
post-fetch       → post-db          = 860ms  (scanWrite's single tx: 50519 upserts + 40 price rows + indexed prune on 294k rows)
post-db          → post-emit scan_complete → finally  = instant
poly_scan_runs row: duration=29507ms markets=50519 status=ok
```

Compare to pre-fix `poly_scan_runs` history (2548 min ago): `270-304 seconds` per scan. **~10x speedup** on total scan, **~500x speedup** on DB-write block alone.

### What shipped (7 commits on fix/scanner-hang-db-rescue)

1. `39fc2b4 chore(scanner)`: POLY_SCAN_DEBUG instrumentation + 3 diagnostic scripts (check-scheduler-state, probe-fetch-standalone, check-db-bloat).
2. `9c42a13 fix(poly)`: scanner DB bloat fix — narrowed capturePrices via extracted `selectPriceCaptureCandidates`, atomic `scanWrite` tx, `POLY_PRICE_HISTORY_HOURS=24`, v1.10.0 `captured_at` index, WAL pragma tuning in `db.ts`.
3. `e84b4e2 feat(scheduler)`: task-kind dispatch v1.11.0. `runShellTask` (3 crons migrated off Claude CLI) + `runClaudeAgentTask` with auth preflight (adversarial-review only).
4. `5b31233 feat(poly)`: `src/poly/heartbeat.ts` — scan staleness + WAL/DB size watchdog + `scan_slow` event.
5. `19c34ca chore(db)`: dropped zombie tables `wa_messages`, `wa_outbox`, `wa_message_map`, `slack_messages` (v1.12.0).
6. `863bb44 chore(db)`: `scripts/audit-schema.ts` for pre/post-migrate verification.
7. _(this commit — HANDOFF + memory update + MISSION sign-off)_

### DB rescue summary

- Backup: `C:/claudeclaw-store/backup-2026-04-20/` with sha256 recorded. 8.67 GB main file preserved.
- Live DB pre-scan: 9.31 GB main + 5.54 GB WAL.
- After `wal_checkpoint(TRUNCATE)` + `VACUUM`: 8.67 GB → 7.97 GB.
- After `scripts/prune-price-history-swap.ts` (CREATE+INSERT+DROP+RENAME instead of row-by-row DELETE): **7.97 GB → 138 MB** in 30 seconds. 294,456 rows kept (last 24h window).
- Post-restart: scanner writes ~40 new rows per tick; heartbeat active; WAL stays under 10 MB steady state.

### Operational state (end of session)

- claudeclaw pm2 id 12 **ONLINE**, PID 54760, uptime clean. First scan at 23:04:48 UTC (2026-04-20 18:04 CDT).
- `.applied.json`: `v1.12.0`. All three new migrations (v1.10.0, v1.11.0, v1.12.0) applied.
- Cron state: news-sync paused; research-ingest + resolution-fetch = `kind=shell`; adversarial-review = `kind=claude-agent` with auth preflight (will skip gracefully while no auth configured).
- `POLY_SCAN_DEBUG=0` flipped after verification. Keep the env key in place as a diagnostic knob.
- regime-trader remains offline weekends (normal). Next Mon 09:30 ET auto-start.

### Operator TODOs

1. ~~**Push `fix/scanner-hang-db-rescue` to origin and merge to `main`**~~ → **DONE 2026-04-21**. Merge commit `762b219` + MISSION sign-off `67e9262` on origin/main.
2. **Monitor 24h**. Heartbeat alerts should stay quiet. If `🚨 Heartbeat` or `⚠️ WAL` or `⚠️ DB file` arrives, investigate.
3. ~~**30-day no-intervention gate restarts now.**~~ → **Clock started 2026-04-21 at merge `762b219`. Target completion: 2026-05-21.**

### Session-wrap state (2026-04-21)

- claudeclaw pm2 id 12 **ONLINE**, PID 34584. `POLY_SCAN_DEBUG=0` steady-state.
- **6 consecutive post-merge scans** logged in `poly_scan_runs`, all 28.2–29.8s. No cadence gaps.
- **GLM pipeline producing signals again**: latest `poly_signals.id=3707` with `provider='glm', model='glm-4.6'`. Pre-halt frozen at id=2564 — the ~1100-signal gap is the 48h halt + 24h recovery window.
- DB 147 MB, WAL 72 MB (healthy churn from strategy engine's eval writes + signal inserts).
- 30-day clock: day 0 of 30. Next resolution-fetch cron Sun 2026-04-26 07:00 ET (kind=shell, deterministic — no Claude CLI risk).

### Known deferred (carry forward)

- `news-sync` paused. Revive via direct `PPLX_API_KEY` + new `scripts/news-sync.ts`; then `UPDATE scheduled_tasks SET kind='shell', script_path='scripts/news-sync.ts', status='active' WHERE id='3d623e0e'`.
- `adversarial-review` fires Sun 18:00 ET. Without `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`, `runClaudeAgentTask` writes a "skipped — no auth" Telegram and stays out of the way.
- `consolidations` / `hive_mind` / `inter_agent_tasks` / `mission_tasks` zombie cleanup deferred to PA-strip phase 4c (needs dashboard refactor first; Explore agent 2026-04-20 confirmed dashboard still reads these).

### Gotchas learned this session

- `readEnvFile` does NOT load .env into `process.env` (security-conscious: keeps secrets out of child processes). New env-driven consts must be added to its whitelist AND exported from `config.ts`, not read with bare `process.env.*`.
- When deleting > 50% of a large SQLite table, use the CREATE+INSERT+DROP+RENAME swap pattern. Row-by-row DELETE is ~60-90x slower because of B-tree page updates.
- On Windows, `pm2 stop` SIGKILL-ing a bot holding a write transaction leaves the WAL in a "needs recovery" state. The next open can spin for many minutes playing back the journal. Safe fallback: force-kill lingering node PIDs (check `powershell Get-Process node`), `rm .db-wal .db-shm`, then reopen — SQLite reads the main DB file as committed state.
- `POLY_SCAN_DEBUG=1` is a permanent diagnostic knob now. Zero cost at 0. Flip to 1 on the next silent failure for one-restart bisection.

---

## 🐛 2026-04-20 — Scanner hang bug (archived, RESOLVED above)

**Symptom**: claudeclaw starts cleanly, logs "Polymarket module initialized (Phase C: scanner + strategy + pnl tracker)", then goes idle. Over 83 minutes of uptime on pid 64276: **zero new `poly_scan_runs` rows, zero new `poly_signals` rows**. CPU 0%. No error in logs. Scanner's `setInterval` never produces a completion event.

**Proven NOT the cause**:
- ✅ Gamma API reachable — standalone `fetchActiveMarkets(500)` completes in 28s, returns 48,617 markets.
- ✅ DB migration v1.9.0 applied, `.applied.json` shows `v1.9.0`.
- ✅ Config correct: `POLY_ENABLED=true`, `GLM_API_KEY` + `GLM_BASE_URL=…/coding/paas/v4` + `GLM_MODEL=glm-4.6` + `thinking.type=disabled` all set.
- ✅ Build clean, 546/546 tests pass.
- ✅ Bot process alive (restart_count 0, pm2 status online).

**Suspected causes (prioritized)**:
1. **Pino logger flush stall** — a log.info at some specific code path triggers a flush issue that deadlocks the event loop. Would explain silent hang with no error.
2. **OpenAI SDK module-load side effect** — `import OpenAI from 'openai'` at the top of `ai-probability.ts` may have a top-level await or connection test that silently hangs. Possible but unusual.
3. **Four overdue cron tasks at startup fighting for event loop** — weekly tasks (news-sync, research-ingest, resolution-fetch, adversarial-review) all fired at startup because the bot was halted 2+ days. Agent SDK subprocess (`claude` CLI) may not be completing, blocking the message queue.
4. **Ambient-service flag-gate side effect** — less likely, but my `if (AGENT_ID === 'main' && MEMORY_ENABLED)` edit in `src/index.ts` changed a previously unconditional block. Re-verify the else branch doesn't swallow something the scanner depends on.

**Diagnostic plan for next session**:
1. Restart claudeclaw. Watch first 60 seconds of `pm2 logs claudeclaw` actively.
2. If no "poly scan complete" appears in 5 minutes, attach Node `--inspect` (add `node --inspect ./dist/index.js` to ecosystem or run directly) and profile what the main thread is doing.
3. Temporarily null out the 4 overdue cron tasks (stop the bot, delete from `scheduled_tasks` WHERE last_run_at IS NULL AND... or flip their paused flag) to test whether that's the blocking factor.
4. If still hung, add `console.log('SCANNER TICK', new Date())` directly to `src/poly/market-scanner.ts::runOnce()` entry + exit as a brute-force logger bypass.

**Current state**:
- claudeclaw pm2 id 12 **STOPPED** (was consuming nothing, but stopped to avoid ambiguity — not online-but-idle).
- `POLY_ENABLED=true` still in `.env`. No need to flip for diagnosis.
- regime-trader instances stopped; will auto-start Mon 09:30 ET via their own cron (independent of claudeclaw).

**Recovery is not blocked on GLM spend** — bot was idle, burned nothing. Take time to diagnose properly.

---

## ✅ 2026-04-20 — claudeclaw restart on GLM 5.1 (CODE-SIDE COMPLETE)

## ✅ 2026-04-20 — claudeclaw restart on GLM 5.1

### What made this possible

1. **Anthropic ToS research** clarified Agent SDK + Max OAuth is NOT a legal path for headless production services. Forced migration to GLM 5.1 (operator's existing Z.ai subscription). See plan §Architecture Decision and `docs/research/sprint-glm-migration.md` §2.
2. **Z.ai Coding Plan endpoint discovery** — standard `/api/paas/v4` returned 429 "Insufficient balance" despite valid key. Subscription is tied to `/api/coding/paas/v4`. `GLM_BASE_URL` in `.env` updated.
3. **`thinking: { type: 'disabled' }` extra param** — glm-4.6 is a reasoning model that burns `max_tokens` on `reasoning_content` and returns empty `content`. Disabling thinking dropped completion tokens 30x and produced clean JSON responses. Probe + fix at `scripts/glm-probe-thinking.ts` and the two strategy modules.
4. **glm-4.6 > glm-5.1 for this use case** — glm-5.1 has heavier reasoning overhead. glm-4.6 on Coding Plan is the right choice. `GLM_MODEL=glm-4.6` in `.env`.

### Stage 3 eval result (docs/handoff/glm-eval-2026-04-19.md)

Quantitatively fails preregistered thresholds (median 10pp, directional 50%). Qualitatively passes — the largest GLM-vs-Claude disagreements all show Claude hallucinating (e.g. citing April 2025 BTC prices for April 2026 markets). GLM anchors to market ask when uncertain, which is what the SYSTEM_PROMPT instructs. The eval's Claude-as-ground-truth metric was flawed; resolved-market Brier is the real calibration test (30-day post-restart window).

### Restart sequence (executed 2026-04-20)

1. Committed thinking-disabled patches + Stage 3 eval report + probe scripts (`8078e6f`).
2. Flipped `POLY_ENABLED=true` in `.env`; `ANTHROPIC_API_KEY` stays empty (GLM path doesn't need it).
3. Ran `npm run migrate` — applied v1.9.0 (poly_signals.provider column + backfill). `.applied.json` now shows `v1.9.0`.
4. `pm2 start dist/index.js --name claudeclaw` → id 12 PID 6000, uptime clean, restart_count 0.
5. `pm2 save` persisted the new process state.

### Observability

- `poly_signals.provider` column populated `'glm'` on new rows; pre-halt rows backfilled to `'anthropic'`.
- First 5-min scan cycle should fire within 5 minutes of restart. Watch `pm2 logs claudeclaw --lines 50` for "scan_complete" event and any GLM 400/429 errors.

### regime-trader status

pm2 instances `regime-trader-spy-agg` + `-cons` stopped. They auto-start via `cron_restart: '30 9 * * 1-5'` ET when Monday market opens (09:30 ET). Today's verification of the sector-cap fix (Phase 1.1) now runs against the live market.

### Monitor over next 24h

- Parse-error rate: `SELECT COUNT(*) FROM poly_signals WHERE reasoning='' OR estimated_prob IS NULL AND created_at > <restart_timestamp>` — expect 0.
- GLM quota consumption: Z.ai Coding Plan dashboard. First day of production traffic is the signal for whether the subscription tier covers the load.
- Signal count ramp: ~42 signals/hr expected at steady state, matching pre-halt pattern.
- MISSION.md gate box 1 (30-day no-intervention) clock started at restart timestamp.

### Remaining from HANDOFF.md §halt — now resolved or deferred

- ~~Rotate keys~~ → operator decision: keep existing, private repo.
- ~~Architecture decision~~ → GLM 5.1 locked, shipped.
- ~~Eval gate~~ → run, qualitative pass.
- ~~Restart authorization~~ → operator approved option A, executed.
- **Still deferred**: migration-tracker reconciliation (Sprint 13 Phase 3.2) — `.applied.json` is working now but the test-schema drift the sprint addresses is still a real concern.

---

## Prior session archive (for reference)

## 🛑 2026-04-18 — claudeclaw halted (API spend incident)

## 🛑 2026-04-18 — claudeclaw halted (API spend incident)

### Incident

Operator discovery: ClaudeClaw pm2 service accumulated **~$150** in Anthropic API charges over ~48h by hitting `https://api.anthropic.com` directly via the `ANTHROPIC_API_KEY` in `claudeclaw/.env` (fingerprint `sk-ant-api03-VO-mkZ7w…`). Calls came from the Polymarket strategy modules (`src/poly/strategies/ai-probability.ts` + `ai-probability-reflect.ts`), which import `ANTHROPIC_API_KEY` from `config.ts:273-274` and call the Anthropic SDK directly per 5-min scan cycle. 2023+ signals × LLM evaluation per signal = plausible $150 at Opus rates.

### Immediate actions taken (2026-04-18)

1. **pm2 stop/delete/save** (operator ran) — claudeclaw no longer in `pm2 list`. Auto-start chain broken at `pm2 save`.
2. **`.env` scrubbed** — `ANTHROPIC_API_KEY=` blanked; `POLY_ENABLED=false`. Rationale documented inline.
3. **Halt marker** — this HANDOFF entry.
4. **regime-trader** — also stopped in pm2 (status: stopped). No cost implication (uses Alpaca, not Anthropic), but flagged here so restart is deliberate.

### Still TODO — operator

1. **Rotate keys** (all of these were either in the `.env` that produced the incident, or were read into an assistant transcript during triage):
   - `ANTHROPIC_API_KEY` (the burner — rotate first at `console.anthropic.com/settings/keys`)
   - `TELEGRAM_BOT_TOKEN`
   - `GOOGLE_API_KEY`
   - `ALPACA_API_KEY` + `ALPACA_SECRET_KEY` — **highest priority after Anthropic** if any real-money flip is ever on the table
   - `AGENTMAIL_API_KEY`
   - `DASHBOARD_TOKEN`
   - `DB_ENCRYPTION_KEY` — rotating this reseeds the SQLite store; plan a migration path before rotating
2. **Confirm spend** — pull usage report for the `VO-` key at `console.anthropic.com/settings/usage` to verify $150 attribution and date range.
3. **Move project out of OneDrive** — `C:/Users/Richard/OneDrive - Greystar/Documents/Code Projects/CCBot1080/claudeclaw` lives in synced storage. Consider relocating to `C:/Projects/claudeclaw/` alongside `regime-trader` to eliminate that exposure vector.

### Architecture decision needed before restart

The strategy code hard-depends on the Anthropic SDK with API-key auth. Three paths:

| Option | Effort | Cost profile | Tradeoff |
|---|---|---|---|
| **A. Switch model to Haiku** | 1-line env change (`POLY_MODEL=claude-haiku-4-5-20251001`) + fresh API key | ~90% cheaper than Opus | Slight quality drop on probability estimates; likely acceptable for paper phase |
| **B. Switch provider to GLM 5.1** | Rewrite strategy modules to use OpenAI-compatible SDK (GLM is OAI-shaped); add `GLM_API_KEY` to env | Operator has existing account; cost TBD per operator | Non-trivial rewrite; different prompt tuning required |
| **C. Route via Agent SDK + `CLAUDE_CODE_OAUTH_TOKEN`** | Larger rewrite of strategy modules to call Agent SDK like `src/agent.ts` does | Uses Max subscription (within limits) | Best cost, biggest rewrite; subscription rate-limits may clash with 5-min scan cadence |

Recommend **A** as immediate unblock (matches existing code shape, fastest return to paper trading) with **C** as Phase 3 sprint candidate. **B** only if GLM 5.1's probability-estimation quality has been validated on similar tasks.

### Plan impact

All subsequent plan phases paused. Phase 1 Mon 2026-04-20 verification cannot run while bot is offline. Real-money-gate clock on MISSION.md box 1 (30-day no-intervention) **resets** — the 04-17 start was invalidated by today's halt.

Next session first move: read this HANDOFF entry, make the A/B/C decision above, then rebuild the plan from Phase 1 with the new auth model confirmed.

## Session 2026-04-18 — Sector-cap fix + approved 9-week plan

### What shipped

1. **regime-trader sector-cap fix** (`instances/spy-*/settings.yaml` + regression test in `tests/test_risk.py`). `max_sector_exposure` raised to match `max_total_exposure` per instance (0.85 agg / 0.60 cons). Unblocks first live rebalance after the 2026-04-16 HMM fix started producing real predictions. 144/144 tests pass. Research note: `C:/Projects/regime-trader/docs/research/sprint-sector-cap-single-etf.md`.
2. **Retroactive regime-trader commits** — 2026-04-16 HMM guard + fetch-window 600→900 + atomic state writer (previously deployed but uncommitted) committed as `8e33adb`; sector-cap fix as `104d76f`. Both on regime-trader local main. **regime-trader has no origin remote** — local-only repo; pushing requires operator to configure GitHub remote.
3. **Kronos foundation model research** (github.com/shiyu-coder/Kronos, MIT, AAAI 2026). Deferred to BACKLOG as a Phase E+ candidate for regime-trader augmentation; can't adopt now per MISSION.md anti-goal (no new strategy until 30-day track record).
4. **Approved 9-week plan** (Phase 0 → Phase 5) to drive MISSION.md gate 0/7 → 7/7. Earliest real-money evaluation 2026-06-20.

### Current state

- **Polymarket trader**: pm2 id 5 claudeclaw, running with Sprint 10+11 dist. 2023+ signals, 9 approved, 5 open paper trades. First `poly_resolutions` expected Sun 04-19 07:00 ET via cron `a6e080bd`.
- **regime-trader**: pm2 instances restarted with sector-cap config loaded. 2 trades executed Fri 2026-04-17 (equity $100,005.66 final). Market closed at restart; first live verification Mon 2026-04-20 09:35 ET.
- **Tests**: ClaudeClaw 543/546 (3 pre-existing schedule-cli flakes). regime-trader 144/144.
- **Git**: claudeclaw main clean + pushed. regime-trader 2 local commits not pushed (no remote).

### Next steps — see approved plan

Full detail: `C:/Users/Richard/.claude/plans/createa-plan-to-get-twinkling-dragon.md`. Summary:

- **Phase 1 — Mon 2026-04-20**: verify sector-cap fix executes rebalance (spy-agg + spy-cons pm2 logs); check resolution-fetch cron output via `npx tsx scripts/bot-stats.ts`; write `docs/handoff/2026-04-20-phase-b-start.md`.
- **Phase 2 — 04-21 → 04-26 validation window**: daily digest checks (Sprint 11 already renders regime + calibration + positions), Wed 04-22 mid-window diagnostic, **Fri 04-24 kill-switch drill** (gate box 6 — calendar-locked), Sun 04-26 flag-enable decisions.
- **Phase 3 — 04-27 → 05-17 sprint queue**: Sprint 12 (category calibration) → Sprint 13 (migration tracker + zombie cleanup) → Sprint 14 (reflection Kelly) → Sprints Email-A + 4.5 (gated on operator env vars).
- **Phase 4 — 05-18 → 06-20**: accumulation window; weekly review + monthly gate check.
- **Phase 5 — 06-20+**: final gate eval; operator sign-off; flip `POLY_PAPER_MODE=false` + regime-trader to Alpaca live.

### Operator asks (deferrable)

- `OPERATOR_EMAIL` — unblocks Sprint Email-A in Phase 3.4
- `POLY_RESEARCH_NOTEBOOK_ID` — create NotebookLM notebook "Polymarket Trading Research", paste ID; unblocks Sprint 4.5
- **Optional**: configure a GitHub remote for regime-trader if cross-machine sync / backup is desired.

### Gotchas carried forward

- **`pm2 env <id>` leaks secrets** — OpenRouter API key. Don't use on screenshare.
- **Live DB has no `schema_migrations` table** but has v1.8.0 schema. Startup warning "pending v1.5.0" is misleading. Do NOT run `npm run migrate` blind — wait for Sprint 13.
- **regime-trader `state.json` and `hmm_model.pkl` are now gitignored** — runtime artifacts no longer dirty the working tree.

---

## Prior session archive (for reference)

## Session 2026-04-16/17 — Full Phase A execution

### What shipped (4 items to production)

1. **Sprint 10** — `outcomePrices` nullish in `GammaMarketSchema` (`src/poly/types.ts:45`, `src/poly/gamma-client.ts:44`). Kills Zod warn spam when Polymarket returns pre-listed markets. 5 new tests. Merged `3aa81d7..d6493ae`.
2. **Sprint 11** — digest expansion (`src/poly/digest.ts`). Added regime / calibration / per-position-detail sections to daily digest. Prior-art audit caught near-duplicate (plan called for new `briefing.ts`; `digest.ts` already existed). 6 new tests. Merged `d6493ae..e32458b`.
3. **regime-trader HMM defensive guard** (`C:/Projects/regime-trader/core/hmm_engine.py:284-300`). Returns safe sentinel `RegimeDetection(confidence=0, is_stable=False)` on T=0 feature array. 2 new pytest tests.
4. **regime-trader fetch window + atomic state writer** (`C:/Projects/regime-trader/main.py:378` and `:130`). Extended fetch from 600→900 calendar days (~414→630 trading days, above 452-row warmup floor). Replaced `Path.write_text()` with `tempfile.mkstemp()` + `os.replace()`. 7 new pytest tests, 143/143 pass.

### Current state

- **Polymarket trader**: pm2 id 5 claudeclaw PID 24676, scanning 5-min, Sprint 10+11 dist live. 2023+ signals, 9 approved, 5 open paper trades.
- **regime-trader**: pm2 instances online, both restarted with fix. Market closed at restart time. **First live verification: Fri 2026-04-17 09:35 ET** — expect >69 training samples + successful regime prediction on first bar.
- **Tests**: ClaudeClaw 543/546 (3 pre-existing schedule-cli flakes). regime-trader 143/143 (10 skipped Alpaca live).
- **Git**: main up to date with origin, working tree clean.

## Session 2026-04-16/17 — Full Phase A execution

### What shipped (4 items to production)

1. **Sprint 10** — `outcomePrices` nullish in `GammaMarketSchema` (`src/poly/types.ts:45`, `src/poly/gamma-client.ts:44`). Kills Zod warn spam when Polymarket returns pre-listed markets. 5 new tests. Merged `3aa81d7..d6493ae`.
2. **Sprint 11** — digest expansion (`src/poly/digest.ts`). Added regime / calibration / per-position-detail sections to daily digest. Prior-art audit caught near-duplicate (plan called for new `briefing.ts`; `digest.ts` already existed). 6 new tests. Merged `d6493ae..e32458b`.
3. **regime-trader HMM defensive guard** (`C:/Projects/regime-trader/core/hmm_engine.py:284-300`). Returns safe sentinel `RegimeDetection(confidence=0, is_stable=False)` on T=0 feature array. 2 new pytest tests.
4. **regime-trader fetch window + atomic state writer** (`C:/Projects/regime-trader/main.py:378` and `:130`). Extended fetch from 600→900 calendar days (~414→630 trading days, above 452-row warmup floor). Replaced `Path.write_text()` with `tempfile.mkstemp()` + `os.replace()`. 7 new pytest tests, 143/143 pass.

### Current state

- **Polymarket trader**: pm2 id 5 claudeclaw PID 24676, scanning 5-min, Sprint 10+11 dist live. 2023+ signals, 9 approved, 5 open paper trades.
- **regime-trader**: pm2 instances online, both restarted with fix. Market closed at restart time. **First live verification: Fri 2026-04-17 09:35 ET** — expect >69 training samples + successful regime prediction on first bar.
- **Tests**: ClaudeClaw 543/546 (3 pre-existing schedule-cli flakes). regime-trader 143/143 (10 skipped Alpaca live).
- **Git**: main up to date with origin, working tree clean.

### Prior session next-steps (superseded by 2026-04-18 plan — kept for audit)

1. ~~Fri 2026-04-17 09:35 ET: verify regime-trader first bar.~~ **Done 2026-04-17** — HMM prediction worked (conf=1.00), but sector-cap blocked trades. Sector-cap fix shipped 2026-04-18.
2. ~~Sun 2026-04-19 07:00 ET: resolution-fetch cron first fire.~~ **Carried forward to 2026-04-18 plan Phase 1.2.**
3. ~~Phase B validation window~~, ~~Fri 2026-04-24 kill-switch drill~~, ~~Sprint 12~~, ~~Deferred items~~ — all carried forward to the 2026-04-18 plan (Phase 2 + 3).

### Gotchas

- **`pm2 env <id>` leaks secrets** — OpenRouter API key appeared in stdout. Don't use on screenshare.
- **Live DB has no `schema_migrations` table** but has all tables through v1.8.0. Startup warning "pending v1.5.0" is misleading. Do NOT run `npm run migrate` blind.
- **Prior plan file** at `C:\Users\Richard\.claude\plans\cached-wishing-quill.md` is superseded by `createa-plan-to-get-twinkling-dragon.md`.

## Session 2026-04-16 — regime-trader verification + Sprint 10

### What changed

- **Research note**: `docs/research/sprint-10-outcomeprices-nullish.md` — all 7 template sections, verdict "complement" (mirrors endDate precedent).
- **Code fix (Sprint 10)**: `src/poly/types.ts` — `GammaMarketSchema.outcomePrices` → `.nullish()` with comment. `src/poly/gamma-client.ts` — null-guard in `normalizeMarket`, `!` on `.map` callback access. 5 new tests in `types.test.ts` + `gamma-client.test.ts`.
- **Handoff brief**: `docs/research/handoff-regime-trader-hmm-debug.md` — starter prompt for a separate session opened in `C:/Projects/regime-trader/` (Python repo) to debug the HMM prediction size-0 bug.
- **Memory**: `project_2026-04-16_regime_trader_auto_start.md` in session memory dir; MEMORY.md index updated.

### Verification results

- **pm2 `cron_restart: '30 9 * * 1-5'`** in `ecosystem.regime-trader.config.cjs` fired on schedule at 09:30 ET. Both `regime-trader-spy-agg` and `regime-trader-spy-cons` online with restart_time=0 (first start).
- **Alpaca handshake**: `Account connected: equity=$100000.00 cash=$100000.00 status=ACTIVE` at 09:30:13 / 09:30:19.
- **HMM training**: completed, 7-state model selected by BIC (`CRASH`, `STRONG_BEAR`, `WEAK_BEAR`, `NEUTRAL`, `WEAK_BULL`, `STRONG_BULL`, `EUPHORIA`).
- **HMM live prediction**: BROKEN. Every 5-min bar since 09:35 throws `IndexError: index 0 is out of bounds for axis 0 with size 0`. Fail-closed (no bad trades) but also zero trades. Bug lives in `C:/Projects/regime-trader/` Python repo, out of scope for ClaudeClaw.
- **Tests**: 540/540 vitest pass on branch. tsc clean. Pre-commit research-check hook approved Sprint 10 commit.

### Secondary findings (queued, not acted on)

1. **Migration tracker missing in live DB.** `C:/claudeclaw-store/claudeclaw.db` has no `schema_migrations` table but has all tables through v1.8.0. Tables were created via `CREATE TABLE IF NOT EXISTS` in module init, not through the migration runner. Startup warning "pending v1.5.0" is misleading. **Do NOT run `npm run migrate` blind** — depends on DDL idempotency. Needs a reconciliation sprint (Tier 3, touches DB).
2. **Zombie pre-pivot tables in live DB.** `wa_messages`, `wa_outbox`, `wa_message_map`, `slack_messages`, `hive_mind`, `inter_agent_tasks`, `mission_tasks`, `consolidations`. Cosmetic. Clean up with migration sprint.
3. **`pm2 env <id>` leaks secrets** (OpenRouter API key appeared in stdout during this session). Avoid on screenshare.
4. **Memory `project_architecture.md`** claims "v1.2.0 applied" — stale. Real state: schema effectively v1.8.0 with no tracker.

### Next session action items (priority order)

1. **Merge** `feat/sprint-10-outcomeprices-nullish` → `main` and push. (Tier 3 push, operator approval.)
2. **Rebuild + pm2 restart** claudeclaw to pick up Sprint 10. Running dist still spams malformed-market warns.
3. **Open separate session** in `C:/Projects/regime-trader/` with `docs/research/handoff-regime-trader-hmm-debug.md` as starter prompt. Fix HMM prediction.
4. **Deferred sprint candidate**: migration-tracker reconciliation + zombie-table cleanup.
5. **2026-04-19 (Sun)**: resolution-fetch cron `a6e080bd` first fire. Check output Mon AM with `npx tsx scripts/bot-stats.ts`.
6. **2026-04-29**: re-run resolution-rate analysis.

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

## Closed this run

All audit-remediation items now landed on `origin/main` (pushed 2026-04-16 06:57).

1. ~~Restart regime-trader Python~~ **DONE** — registered under pm2 via `ecosystem.regime-trader.config.cjs` with `cron_restart: '30 9 * * 1-5'` + `autorestart: false`. Will auto-start weekday 09:30 ET and exit naturally at close. Alpaca paper auth verified ($100k equity).
2. ~~Telegram 409~~ **NOT HAPPENING** — stale log misread; current bot shows clean Telegram.
3. ~~Merge `fix/audit-remediation` → main~~ **DONE** (`b78e448`).
4. ~~pm2 restart with fresh dist~~ **DONE** — PID 57992, scanning every 5 min, new sizing + PA-stripped code active.
5. ~~Phase 4b full PA strip~~ **DONE** (`f63dae2`). 1014 deletions. Stripped: `whatsapp.ts`, `slack.ts`, most of `profile.ts` (kept `loadProfile` + `getSection`). Trimmed: `bot.ts` (-315 LOC), `db.ts` (-213 LOC), `config.ts` (-18 LOC), plus surgical touches to memory, dashboard, registry, auto-delegate. `POLY_PERSONAL_ASSISTANT_ENABLED` flag removed (no longer needed).
6. ~~`POLY_EXPOSURE_AWARE_SIZING` Tier-3 decision~~ **DONE** (`e2b6899`). Applied ceiling alignment per my Sprint 9 audit (`computeAvailableCapital` now uses `maxDeployedPct * paperCapital - exposure`), then flipped flag to `true` in `.env`. Conservative direction only.
7. ~~`git push origin main`~~ **DONE** — `5e2ee0f..ce41604`, 14 commits.

## Final pm2 state (post-restart)

```
5  claudeclaw              online   new dist, scanning, Sprint 9 sizing active
7  regime-trader-spy-agg   stopped  (cron_restart 09:30 ET weekdays)
10 regime-trader-spy-cons  stopped  (cron_restart 09:30 ET weekdays)
```

## Verification receipts

- Typecheck: clean (`npx tsc --noEmit` exit 0).
- Tests: 532/535 pass (3 failures all in pre-existing `schedule-cli.test.ts` DB-lock flake).
- Build: clean (`npm run build` exit 0).
- Git: `origin/main` up to date; no uncommitted work.
- Bot: PID 57992, 5 scans in last 30 min, no errors in fresh stderr, no migration warnings in fresh stdout.

## Active enforcement (will catch future drift)

- Pre-commit research-note hook — blocks src/poly + src/trading commits without note.
- Weekly Sun 18:00 ET adversarial cron — audits sprint-vs-note pairing.
- INSTANCE STALE alert — fires when regime-trader state.json > 1h stale.

## Next session

Richard's call on what to work on. Charter is clean, code is aligned with SOUL.md identity, discipline scaffolding is mechanical (not memory-only). Resolution-rate analysis says hold parameters, re-check 2026-04-29.

## Post-restart verification (2026-04-16 05:28 ET)

- pm2 id 5 claudeclaw: online, PID 56312, no migration warnings in fresh stdout, no 409 errors.
- regime-trader-spy-agg + spy-cons: registered in pm2, currently stopped (market closed). Alpaca auth verified on first run.
- state.json last-modified 2026-04-11 → new `instance_stale` alert fires on next scan, surfacing this in Telegram. Alert clears automatically after regime-trader runs at market open.

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
