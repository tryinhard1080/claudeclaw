# Handoff -- ClaudeClaw

## Last Session
- **Date**: 2026-03-31
- **Model**: Claude Opus 4.6 (1M context)
- **Previous session**: 2026-03-30 (planning only), 2026-03-29 (initial setup)

## What Changed (2026-03-31)
- Set up pm2 process management for ClaudeClaw (Step 1 of approved plan)
- Diagnosed and fixed 409 Telegram polling conflict: root cause was `telegram@claude-plugins-official` plugin spawning 6+ bun zombie pollers per Claude Code session, all competing for the same bot token
- Disabled Claude Code Telegram plugin in `~/.claude/settings.json` (`"telegram@claude-plugins-official": false`)
- Killed 6 zombie bun processes that were holding the token
- Reduced grammy long-poll timeout from 30s to 10s in `src/index.ts` for faster 409 recovery
- Extracted `bot.start()` options to `startOptions` const with explicit types
- Registered ClaudeClaw in pm2 with `--exp-backoff-restart-delay=3000 --max-restarts=10`
- Saved pm2 state (`pm2 save`)

## What Changed (2026-03-30)
- Created full implementation plan at `~/.claude/plans/reflective-floating-floyd.md`

## What Changed (2026-03-29)
- Initial setup: npm install, .env, Windows spawn fix, Telegram polling fix, first boot

## Current State
- **Working**: Bot online via pm2, 0 restarts, responds to DMs, dashboard at localhost:3141
- **Running in**: pm2 (persistent, auto-restart on crash with exponential backoff)
- **Telegram plugin**: Disabled globally -- ClaudeClaw owns the bot token exclusively
- **Not configured yet**: CLAUDE.md personalization, user skills, voice, crons, OneDrive safety

## Approved Plan (remaining steps)
**Plan file**: `~/.claude/plans/reflective-floating-floyd.md`
**Completed**: Step 1 (pm2)
**Remaining**: Step 4 (OneDrive fix) -> 2 (CLAUDE.md) -> 3 (skills fix) -> 9 (skill registration) -> 6 (crons) -> 7 (dashboard docs)

## Next Steps
1. Move `store/` off OneDrive to `C:\claudeclaw-store\` (Step 4)
2. Personalize CLAUDE.md -- replace [YOUR NAME] -> Richard, vault path, etc. (Step 2)
3. Fix settingSources to re-enable user skills without Telegram conflict (Step 3)
4. Register installed skills with the bot (Step 9)

## Gotchas & Notes
- **Claude Code Telegram plugin is the #1 409 source**: Each CC session spawns a bun process that polls the same TELEGRAM_BOT_TOKEN. Plugin is now disabled globally. If re-enabled, ClaudeClaw will crash-loop with 409s.
- OpenClaw pm2 processes were auto-respawning and stealing the bot token -- deleted from pm2
- Windows `Start-Process` strips PATH, so `claude.exe` needs full path via `pathToClaudeCodeExecutable`
- `settingSources: ['project']` means the bot's Claude subprocess won't load user-level skills/plugins -- only project CLAUDE.md
- Project lives on OneDrive -- if SQLite lock errors appear, move `store/` to a local path outside OneDrive
- grammy long-poll timeout reduced to 10s (from 30s default) so pm2 backoff recovers faster from transient 409s
