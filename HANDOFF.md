# Handoff -- ClaudeClaw

## Last Session
- **Date**: 2026-04-11 (Polymarket trading bot research + blueprint)
- **Model**: Claude Opus 4.6 (1M context)
- **Previous session**: 2026-04-09 (user profile + autonomous routines + learning loop)

## What Changed (2026-04-11)

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
- **Bot**: Online as @CCbot1080bot via pm2, stable (PID 78608)
- **Dashboard**: localhost:3141 (hardened)
- **Scheduler**: Active (60s polling). Routines NOT yet seeded -- need to run seed script.
- **Memory**: Consolidation working (verified in logs: memory ingested + consolidation complete)
- **Profile**: 6 sections populated at C:/claudeclaw-store/profile/
- **Tests**: 223/223 passing (14 test files)
- **Telegram plugin**: Disabled in settings.json. 3 zombie bun processes killed this session.

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
1. **Polymarket bot Phase 0**: Clone `Polymarket/agents`, `Polymarket/py-clob-client`, `dylanpersonguy/Fully-Autonomous-Polymarket-AI-Trading-Bot` for study. Set up Polymarket account + dedicated wallet ($100-200 test funds). Install Bullpen CLI for prototyping.
2. **Seed routines** (still pending from last session): `STORE_DIR=C:/claudeclaw-store npx tsx scripts/seed-routines.ts`
3. Wire profile auto-update from memory-ingest.ts (detect profile-worthy info in conversations)
4. Write tests for security.ts, message-queue.ts (critical gaps from audit)
5. Limit getMemoriesWithEmbeddings() to recent 50 (O(n) scan)
6. Split bot.ts into smaller modules (now 1500+ LOC)
7. FTS5 query injection fix (db.ts)
8. Implement SDK Engine (RFC at docs/rfc-sdk-engine.md)

## Gotchas & Notes
- **Telegram plugin auto-re-enables**: Must kill zombie bun processes AND set plugin to false in settings.json. This session had 3 zombie processes at PIDs 175872, 105492, 141624.
- **Profile lives off-repo**: Profile files at C:/claudeclaw-store/profile/ (same STORE_DIR as DB), NOT in project store/. This keeps them off OneDrive.
- **Routines rebuild prompts dynamically**: Even though seed script writes a prompt to DB, the scheduler rebuilds it at execution time for system routines (isSystemRoutine check). This ensures fresh profile data.
- **Enhanced context is every-turn**: Unlike profile (first turn only), time/momentum/project detection runs every message. Token cost is low (~200 tokens).
