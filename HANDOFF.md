# Handoff -- ClaudeClaw

## Last Session
- **Date**: 2026-04-09
- **Model**: Claude Opus 4.6 (1M context)
- **Previous session**: 2026-04-08 (deployment, pm2 setup, CLAUDE.md personalization)

## What Changed (2026-04-09)

### Infrastructure (carried from 2026-04-08 work)
- STORE_DIR configurable via .env (`C:/claudeclaw-store`), off OneDrive
- settingSources reverted to `['project']` (Telegram plugin keeps re-enabling)
- Registry scans project `skills/` + user `~/.claude/skills/`
- Personalized `~/.claudeclaw/CLAUDE.md` created (Richard, Claw, vault path)
- 10 zombie bun Telegram plugin processes killed
- Telegram plugin disabled in `~/.claude/settings.json`

### Security Fixes (from 5-agent ultrathink audit)
- **PIN brute-force lockout**: 5 failed attempts triggers 5min cooldown (`security.ts`)
- **AES key validation**: Fixed `hex.length < 64` (was `< 32`, would accept 16-byte keys) (`db.ts`)
- **Dashboard timing-safe auth**: `crypto.timingSafeEqual` + Bearer header support (`dashboard.ts`)
- **Dashboard hardened**: Localhost-only bind, restricted CORS, security headers (`dashboard.ts`)
- **SEND_FILE path validation**: Allowlist check (project root + /tmp/) prevents traversal (`bot.ts`)

### Bug Fixes
- **Atomics.wait crash**: Replaced with safe busy-wait in PID lock (`index.ts`)
- **streamingEnabled TDZ**: Moved declaration before `onProgress` closure (`bot.ts`)
- **Embedding model mismatch**: Uses `EMBEDDING_MODEL` constant, not hardcoded `'embedding-001'` (`db.ts`, `embeddings.ts`)
- **ESM __dirname crash**: Added `fileURLToPath` to `registry.ts`

### Test Fixes
- `env.test.ts`: Rewritten to mock `fs.readFileSync` (old tests mocked `process.cwd()` but code uses `__dirname`)
- `scheduler.test.ts`: Fixed truncation test (4000 chars, not 500)
- `bot.test.ts`: Updated file send test paths to use `/tmp/` (allowlist)

## Current State
- **Bot**: Online as @CCbot1080bot via pm2, 0 restarts, responding to Telegram DMs
- **Dashboard**: localhost:3141 (hardened: localhost-only, timing-safe auth)
- **Scheduler**: Active (60s polling)
- **Memory**: Consolidation enabled (30min cycle), Gemini model verified working
- **Store**: `C:/claudeclaw-store/claudeclaw.db` (off OneDrive)
- **Tests**: 223/223 passing (14 test files)

## Ultrathink Audit Summary
5 specialist agents analyzed the full 14.5k LOC codebase:
- **Architecture**: Sound design, few coupling issues (bot.ts god module, scheduler<->bot circular dep)
- **Security**: 2 critical + 5 high + 8 medium findings. Top 5 fixed this session.
- **Code Quality**: 4 real bugs found and fixed (Atomics.wait, TDZ, key validation, embedding model)
- **Tests**: Critical gaps in security.ts (0 tests), message-queue.ts (0 tests), formatForTelegram (untested)
- **Performance**: ~$0.01/message, O(n) embedding scan needs limiting, consolidation runs too often

## Next Steps
1. Write tests for `security.ts` (PIN lock, brute-force lockout, kill phrase)
2. Write tests for `message-queue.ts` (FIFO ordering, error isolation)
3. Limit `getMemoriesWithEmbeddings()` to recent 50 memories
4. Add `user_invocable: true` to project skill SKILL.md files
5. Split `bot.ts` into smaller modules (formatting, commands, handlers)
6. FTS5 query injection fix (escape `"` in keywords, `db.ts:691`)

## Gotchas & Notes
- **Telegram plugin auto-re-enables**: Between sessions, `telegram@claude-plugins-official` keeps getting set back to `true` in `~/.claude/settings.json`. Must stay `false` or ClaudeClaw 409s.
- **settingSources must stay `['project']`**: Cannot include `'user'` while Telegram plugin exists. Skills must be discovered via project `skills/` directory or registry scan.
- **`gemini-3-flash-preview` IS valid**: Code reviewer flagged it as nonexistent (stale training data). Verified working via real API call.
- **Dashboard queue bypass was already fixed**: `processMessageFromDashboard` already routes through `messageQueue.enqueue()`.
