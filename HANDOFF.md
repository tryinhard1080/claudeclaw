# Handoff -- ClaudeClaw

## Last Session
- **Date**: 2026-03-29
- **Model**: Claude Opus 4.6 (1M context)

## What Changed
- Installed npm dependencies and compiled TypeScript (`npm install && npm run build`)
- Created `.env` with bot token, chat ID, Gemini key, dashboard token, DB encryption key
- Fixed Windows spawn issue: added `pathToClaudeCodeExecutable` in `src/agent.ts` so the Agent SDK can find `claude.exe` on Windows (Node's `spawn` can't resolve it from PATH alone)
- Fixed Telegram plugin conflict: changed `settingSources` from `['project', 'user']` to `['project']` in `src/agent.ts` so the SDK subprocess doesn't load the Telegram plugin and fight over `getUpdates`
- Removed `drop_pending_updates: true` from `src/index.ts` -- was silently discarding all messages on startup
- Added explicit `allowed_updates` array in `src/index.ts` for topic DM compatibility
- Stopped OpenClaw pm2 processes (`bot-manager`, `botman-gateway`) and deleted them from pm2 to free the bot token

## Current State
- **Working**: Bot online as `@CCbot1080bot`, responds to DMs, Claude Agent SDK queries succeed, memory extraction via Gemini, scheduler running, dashboard at localhost:3141
- **Running in**: A cmd window (`node dist/index.js`) -- must stay open
- **Not configured yet**: ElevenLabs voice, Slack, WhatsApp, sub-agents (comms/research/content/ops)

## Next Steps
1. Set up persistent process management (pm2 or Windows Task Scheduler) so bot survives reboots
2. Configure sub-agents (research, comms, content, ops) with separate bot tokens
3. Add ElevenLabs for voice responses
4. Customize `CLAUDE.md` personality and system prompt for the bot
5. Test dashboard at `http://localhost:3141?token=<DASHBOARD_TOKEN>`

## Gotchas & Notes
- OpenClaw pm2 processes were auto-respawning and stealing the bot token -- deleted from pm2, but may return if OpenClaw is reinstalled or pm2 dump is restored
- Windows `Start-Process` strips PATH, so `claude.exe` needs full path via `pathToClaudeCodeExecutable`
- Claude Code Telegram plugin (`bun.exe` processes) also conflicts -- don't use `--channels plugin:telegram` with the same bot token
- `settingSources: ['project']` means the bot's Claude subprocess won't load user-level skills/plugins -- only project CLAUDE.md. This is intentional to prevent the Telegram plugin conflict
- Project lives on OneDrive -- if SQLite lock errors appear, move `store/` to a local path outside OneDrive
- Telegram "Topics in DMs" adds `message_thread_id` to every message -- the bot handles this fine now
