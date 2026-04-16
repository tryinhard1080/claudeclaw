# Phase 4b — Full PA module strip

> Completes the 2026-04-13 trading-only pivot. Phase 4 gated commands behind a flag; 4b removes the modules and their data-layer tendrils entirely.

## 1. Existing-code audit

Tendrils discovered in Phase 4:

- `src/bot.ts` — imports `loadProfile`, `getProfileSummary`, `formatProfileForTelegram` (profile.ts); `getSlackConversations`, etc. (slack.ts); `getWaChats`, etc. (whatsapp.ts); and `lookupWaChatId`/`saveWaMessageMap` from db.ts. Gated command handlers behind `PERSONAL_ASSISTANT_ENABLED`.
- `src/db.ts` — defines `saveWaMessageMap`, `lookupWaChatId`, probably a `wa_message_map` table.
- `src/memory.ts` — references wa or slack message shapes.
- `src/registry.ts` — PA commands registered.
- `src/auto-delegate.ts` — routing logic that may route to PA.
- `src/dashboard-html.ts` — dashboard UI showing wa/slack conversations.
- `src/context-builder.ts` — injects profile context.
- `src/routines.ts` — may call loadProfile.

## 2. Literature / NotebookLM finding

Not applicable. This is dead-code removal, not algorithm design.

## 3. Duplicate / complement / conflict verdict

**Neither — removal.** The PA scope was declared out of scope by SOUL.md line 25, MISSION.md "Out of Scope" section, and the 2026-04-13 operator pivot. These modules are pure drift. Phase 4 gated them; 4b deletes them.

**Exceptions kept (per operator 2026-04-15):**
- `voice.ts` — trade dictation is trading-relevant.
- `loadProfile()` context injection in bot.ts line ~475 — profile-as-agent-context is partnership-relevant, not PA-feature. But stays only if we can separate the "profile context" data from the `/profile` PA command. If loadProfile pulls from the same data store as the /profile interview, decide case-by-case.

## 4. Why now

The 2026-04-15 audit found residual PA code was the largest charter-drift finding (Severity High). Leaving it in tree indefinitely risks re-activation on accident (flag flip, env typo) or creep-back during future sessions. Delete removes the attack surface entirely.

Measurable improvement: reduces `src/` LOC by ~1000, reduces bot.ts command surface, eliminates `POLY_PERSONAL_ASSISTANT_ENABLED` from the feature-flag list.

## 5. Out of scope

- `voice.ts` — keep.
- Deleting agent-SDK tooling (orchestrator, registry, hive-mind) — those are trading-agent infra, not PA.
- Refactoring memory.ts / db.ts beyond removing wa/slack-specific pieces.

## 6. Risk

Blast radius: **medium-high.** bot.ts is the main entry point. Breaking an import chain means Telegram goes dark.

Mitigations:
- Work on a feature branch.
- `npx tsc --noEmit` after each file edit to catch broken imports early.
- Full test suite + `npm run build` before merge.
- Smoke-test: pm2 restart, verify bot sends a startup message to Telegram.

## 7. Verification plan

- Typecheck clean.
- Tests: pass (except pre-existing schedule-cli flake).
- Build: clean.
- Post-restart: bot sends /start response to Richard's Telegram; /help shows only trading commands; /wa /slack /profile return "Unknown command" (standard grammy default).

[audit]
