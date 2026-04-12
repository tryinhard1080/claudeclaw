# Handoff -- ClaudeClaw

## Last Session
- **Date**: 2026-04-12 (Polymarket bot — Phase A shipped, Phase C building blocks done through Task 14)
- **Model**: Claude Opus 4.6 (1M context)
- **Previous session**: 2026-04-11 (trading research deep dive, code review, regime-trader integration went live, Polymarket blueprint)

## What Changed (2026-04-12, Polymarket Phase A+C build)

### Completed: Tasks 0-14 of `docs/superpowers/plans/2026-04-12-polymarket-bot.md`

**Phase A (live + shippable):** scanner (15m interval), 5 `/poly` Telegram subcommands (`markets|market|trending|closing|status`), daily digest with timezone-aware gating. Wired into `src/index.ts` under `AGENT_ID === 'main'` via dynamic import. Gated by `POLY_ENABLED=true`.

**Phase C building blocks:** AI-probability strategy with persistent eval cache (`poly_eval_cache`, 2h TTL, auto-invalidating on prompt edit via `PROMPT_TEMPLATE_HASH`), three deterministic risk gates (position limits / portfolio health / signal quality — all pure, state passed in), transactional paper broker with drift-abort, hourly P&L tracker with injected market/midpoint fetchers for testability.

### New code
- `src/poly/`: types, gamma-client, clob-client, market-scanner, price-history, telegram-commands, format, digest, index, strategies/ai-probability, risk-gates, paper-broker, pnl-tracker (+ tests for each — ~60 tests passing).
- `migrations/v1.2.0/v1.2.0-poly.ts`: 6 `poly_*` tables, applied to DB.
- `src/db.ts`: new `getDb()` accessor for raw handle.
- `src/index.ts`: dynamic-import poly block under main-agent guard.
- `scripts/poly-probe.ts`: throwaway API-shape probe (documented real field types in top comment).

### Session commits (21 ahead of origin/main at push time)
See `docs/superpowers/plans/2026-04-12-polymarket-bot.md` Task Map for commit-per-task table. Plus codex-review fix `713bad5` (tsc rootDir exclude + `/poly markets` slug discoverability).

### Gotchas discovered and preserved in plan
- Gamma `/markets/{slug}` returns 422; must use `/markets/{id}`.
- `volume24hr`/`liquidity` come back as STRINGS from Gamma — schemas use `z.coerce.number()`.
- No native `resolution` field on Gamma; use `outcomePrices[i] === 1.0` to detect winner.
- `kv` table doesn't exist — poly module created its own `poly_kv` via `CREATE IF NOT EXISTS` in `initPoly()` (no new migration needed for a single table).
- Migration test file excluded from tsc (rootDir conflict) — vitest still runs it.

## Next Session Pickup — Task 15 (Strategy Engine)

**File to create:** `src/poly/strategy-engine.ts` + test.

**What it does:** Integration layer that ties Tasks 11-14 together into an actual trading loop.
1. Subscribes to `MarketScanner` `scan_complete` event (already emitted by Task 7).
2. Selects top-N markets by 24h volume (filter by `POLY_MIN_VOLUME_USD`, `POLY_MIN_TTR_HOURS`).
3. For each YES outcome: calls `evaluateMarket` (Task 11 — LLM + eval cache).
4. Computes `edgePct`, applies `POLY_KELLY_FRACTION` sizing, caps at `POLY_MAX_TRADE_USD`.
5. Builds `PortfolioSnapshot` by querying `poly_paper_trades` + `poly_positions` + `getDailyRealizedPnl`.
6. Calls `runAllGates(signal, snapshot, orderbookSnapshot)` (Task 12).
7. Inserts signal row into `poly_signals` (approved or rejected with reasons).
8. On approval: calls `execute()` (Task 13) → records `paper_trade_id` back on signal.
9. Honors `poly_kv['poly.halt']='1'` as kill switch (no new signals when halted).

**Then Tasks 16-18** (all light):
- 16: Alerts — Telegram wrappers for signal-created, trade-filled, position-resolved.
- 17: Phase C commands — `/poly signals`, `/poly positions`, `/poly pnl`.
- 18: Wire Phase C into `src/index.ts` — mount `StrategyEngine` + `PnlTracker` alongside existing poly wiring.

**Task 19** is human QA — run `POLY_ENABLED=true npm run start`, exercise `/poly` commands, wait for 1+ scan cycle, verify digest fires.

---

## Previous Session (2026-04-11, trading integration session)

### Equity Trading Research + Review + Integration (committed in ab4b6ce)
- **`docs/trading-research-2025-2026.md`**: Perplexity Deep Research across 245 sources. 20+ validated strategies (Oct 2025-Apr 2026), tier ranking, regime analysis, combinability matrix, implementation priority, 10 red flags.
- **`docs/mega-prompt-trading-bot.md`**: 3-phase mega prompt for integrating regime-trader with ClaudeClaw via file-based IPC.
- **Code review findings fixed** (7 items):
  - P0: busy-wait spin lock replaced with execSync (`src/index.ts`)
  - P0: Graceful shutdown aborts in-flight queries + drains queue (`src/index.ts`, `src/state.ts`, `src/message-queue.ts`)
  - P1: Scheduler replaced 60s polling with precision setTimeout (`src/scheduler.ts`)
  - P1: Idempotency guard via `claimTaskExecution` (`src/scheduler.ts`, `src/db.ts`)
  - P1: Dashboard rate limiter (60 req/min/IP, in-memory token bucket)
  - P1: pm2 ecosystem config + headless start scripts
  - P2: Decryption no longer silently returns ciphertext on format-matching failures
  - Bonus: `extractKeywords` now preserves hyphens (was breaking "stop-loss", "take-profit" in FTS5)
- **`src/trading/`** (6 files, ~600 LOC): Hub-and-spoke integration bridge to regime-trader
  - `types.ts` -- TS types mirroring state.json
  - `state-poller.ts` -- polls instances/*/data/state.json every 5s
  - `instance-control.ts` -- subprocess wrapper for instance_manager.py
  - `alerts.ts` -- rate-limited Telegram alert manager (15min/type/instance)
  - `telegram-commands.ts` -- 10 /trade subcommands
  - `index.ts` -- init + event wiring
- **`/health` endpoint**: DB quick_check + Telegram connection status (no auth)
- **Live confirmation**: Bot restarted via pm2, logs show "Trading integration initialized" + "Trading commands registered" for spy-aggressive and spy-conservative instances.

### Polymarket Trading Bot Blueprint

### Polymarket Trading Bot Blueprint
- **`docs/mega-prompt-polymarket-bot.md`** (new, 836 lines): Complete blueprint for multi-strategy Polymarket prediction market trading bot. 7 sections: Context/Calibration, Strategy Portfolio, Multi-Agent Architecture, Risk Management (hard rules), ClaudeClaw Integration, Implementation Phases, Reference Library
- **`docs/trading-research-2025-2026.md`** (extended, +96 lines): Added Category 6 (Prediction Market Strategies) with trader profiles (Domer, Theo, WindWalk3), ranked strategy table, key repos, threats, 20 new source citations
- **Triggered by**: Bullpen CLI video review (Sharbel A. tutorial) -- naive copy trading approach found insufficient
- **Architecture**: Multi-agent pipeline with bull/bear adversarial debate, fractional Kelly (1/4) sizing, 3 independent safety gates, multi-model LLM ensemble (Claude + Gemini + GPT)

### Trading Integration Committed (was uncommitted from prior work)
- Committed `src/trading/` regime-trader bridge (6 files, ~600 LOC)
- Committed 7 P0/P1 reliability fixes from `docs/mega-prompt-trading-bot.md`
- Committed pm2 ecosystem config + headless start scripts
- Committed video analysis notes (research notes from earlier trading bot tutorials)

### Housekeeping
- **`.gitignore`**: Added `.claude/settings.local.json` (user-specific permissions shouldn't be tracked)
- **Memory**: Added `project_polymarket_bot.md` to memory index

## Last Session (2026-04-09, session 2) -- preserved for context

## What Changed (2026-04-09, session 2)

### User Profile System (Phase 1)
- **`src/profile.ts`** (new): Profile CRUD with 60s cache TTL, loadProfile(), getProfileSummary(), updateProfile(), formatProfileForTelegram()
- **`C:/claudeclaw-store/profile/*.md`** (6 files): identity, projects, preferences, workflows, contacts, goals -- pre-populated with known data
- **`src/bot.ts`**: Profile injected on first turn of every session, `/profile` command (view/edit/refresh)
- **`src/registry.ts`**: Registered `/profile` command
- **`CLAUDE.md`**: Documented profile system and update instructions

### Proactive Routines (Phase 2)
- **`src/routines.ts`** (new): 5 routine definitions -- morning briefing (8am weekdays), evening wrap (6pm), weekly review (Mon 9am), inbox sweep (4h), project pulse (Wed 10am)
- **`scripts/seed-routines.ts`** (new): Idempotent seeder for scheduled_tasks table
- **`src/scheduler.ts`**: Dynamic prompt rebuild for system routines (fresh profile data at execution time)
- **`src/db.ts`**: Added `routine_type` column migration to scheduled_tasks

### Enhanced Context Injection (Phase 3)
- **`src/context-builder.ts`**: Added buildTimeContext() (date/time/period), buildMomentumContext() (today's conversation focus), detectActiveProject() (keyword match against profile projects), buildEnhancedContext() (orchestrator)
- **`src/bot.ts`**: Enhanced context injected every turn (both Telegram and dashboard paths)

### Autonomous Skills (Phase 4)
- **`src/auto-delegate.ts`** (new): Smart delegation detection by keyword patterns for research/comms/content/ops agents
- **`src/learning.ts`** (new): Auto-extracts correction lessons via Gemini, stores in store/profile/lessons.md, injects top 5 into context
- **`src/notifications.ts`** (new): Priority-based notification system with quiet hours (9pm-7am) and digest batching
- **`src/bot.ts`**: Learning extraction wired after saveConversationTurn (fire-and-forget)
- **`src/index.ts`**: Notification system initialized alongside scheduler

### New Project Skills (Phase 5)
- **`skills/daily-briefing/SKILL.md`**: Morning briefing aggregation
- **`skills/project-status/SKILL.md`**: Project health checks
- **`skills/quick-capture/SKILL.md`**: Fast Obsidian note capture

## Current State
- **Bot**: Online as @CCbot1080bot via pm2 (restarted this session with trading integration active)
- **Dashboard**: localhost:3141 (hardened + rate-limited + /health endpoint)
- **Scheduler**: Active (precision timer, was 60s polling). Routines NOT yet seeded -- need to run seed script.
- **Trading integration**: LIVE. Polling `C:\Projects\regime-trader\instances\spy-aggressive` and `spy-conservative` state.json every 5s. `/trade` commands registered (status, regime, pnl, halt, resume, start, stop, backtest, alerts).
- **Memory**: Consolidation working (verified in logs: memory ingested + consolidation complete)
- **Profile**: 6 sections populated at C:/claudeclaw-store/profile/
- **Tests**: 223/223 passing (14 test files) after all Phase 1 + 2 changes
- **Telegram plugin**: Disabled in settings.json. 3 zombie bun processes killed in prior session.

## Context Injection Stack (per message)
1. Agent system prompt (CLAUDE.md) -- first turn only
2. Runtime context (agent ID, model, uptime) -- first turn only
3. User Profile (identity, projects, preferences) -- first turn only (~500 tokens)
4. Enhanced context (time, momentum, project detection) -- every turn (~200 tokens)
5. Learned behaviors (correction lessons) -- every turn (~100 tokens)
6. Memory context (semantic + consolidations) -- every turn (variable)
7. Recent task outputs -- every turn if applicable
8. User message -- always last

## Next Steps
1. **Smoke test /trade commands**: Send `/trade status`, `/trade regime`, `/trade pnl` in Telegram. Confirm state.json reads are working. Verify alerts fire on next regime change in regime-trader.
2. **Start a regime-trader instance in paper mode** (if not already running): `cd C:\Projects\regime-trader && python instance_manager.py start spy-aggressive --mode paper`. Then `/trade status` in Telegram should show live equity.
3. **Polymarket bot Phase 0**: Clone `Polymarket/agents`, `Polymarket/py-clob-client`, `dylanpersonguy/Fully-Autonomous-Polymarket-AI-Trading-Bot` for study. Set up Polymarket account + dedicated wallet ($100-200 test funds). Install Bullpen CLI for prototyping.
4. **Seed routines** (still pending from last session): `STORE_DIR=C:/claudeclaw-store npx tsx scripts/seed-routines.ts`
3. Wire profile auto-update from memory-ingest.ts (detect profile-worthy info in conversations)
4. Write tests for security.ts, message-queue.ts (critical gaps from audit)
5. Limit getMemoriesWithEmbeddings() to recent 50 (O(n) scan)
6. Split bot.ts into smaller modules (now 1500+ LOC)
7. FTS5 query injection fix (db.ts)
8. Implement SDK Engine (RFC at docs/rfc-sdk-engine.md)

## Gotchas & Notes
- **Trading integration is file-based**: ClaudeClaw does NOT have trading logic. It polls `regime-trader/instances/*/data/state.json` and shells out to `instance_manager.py`. This keeps crash domains isolated -- either process can die without taking down the other.
- **Codex --full scope fails on OneDrive paths**: `node codex-review.js --full` errors out because of how PowerShell escapes paths with spaces. Works fine on commit/branch modes. For full-codebase reviews, dispatch Explore + code-reviewer agents manually.
- **Scheduler is no longer 60s polling**: It's a precision setTimeout that sleeps exactly until next due time (capped at 60s max). Tests in `src/scheduler.test.ts` still pass but mental model needs updating.
- **Telegram plugin auto-re-enables**: Must kill zombie bun processes AND set plugin to false in settings.json. This session had 3 zombie processes at PIDs 175872, 105492, 141624.
- **Profile lives off-repo**: Profile files at C:/claudeclaw-store/profile/ (same STORE_DIR as DB), NOT in project store/. This keeps them off OneDrive.
- **Routines rebuild prompts dynamically**: Even though seed script writes a prompt to DB, the scheduler rebuilds it at execution time for system routines (isSystemRoutine check). This ensures fresh profile data.
- **Enhanced context is every-turn**: Unlike profile (first turn only), time/momentum/project detection runs every message. Token cost is low (~200 tokens).
