# Sprint — Ambient-service flag-gate (MEMORY_ENABLED / VOICE_ENABLED)

## 1. Existing-code audit

- `src/index.ts:13` imports `cleanupOldUploads` from `./media.js` — called line 171, FS cleanup, no billing.
- `src/index.ts:14` imports `runConsolidation` from `./memory-consolidate.js`.
- `src/index.ts:15` imports `runDecaySweep` from `./memory.js`.
- `src/index.ts:148-169`: main-process-only block that calls `runDecaySweep()` immediately + schedules a 24-hour `setInterval`, AND starts a 30-minute `setInterval` calling `runConsolidation(ALLOWED_CHAT_ID)` when both `ALLOWED_CHAT_ID` and `GOOGLE_API_KEY` are set.
- `src/memory-consolidate.ts:1` imports `generateContent` from `./gemini.js` — line 92 calls `generateContent(prompt)` per consolidation cycle. This is the Gemini billing surface.
- `src/memory-consolidate.ts:10` imports `embedText` from `./embeddings.js` — per-memory embedding calls (also Gemini).
- `src/bot.ts:51-53` imports `voiceCapabilities`, `synthesizeSpeechLocal`, `UPLOADS_DIR` from `./voice.js`; line 628 calls `voiceCapabilities()` in the hot path of every inbound text message to decide whether to reply with TTS.
- `src/voice.ts:205` posts to `https://api.groq.com/openai/v1/audio/transcriptions` (Whisper). Line 300 posts to ElevenLabs TTS. Line 336 posts to Gradium TTS fallback.

No existing `MEMORY_ENABLED` or `VOICE_ENABLED` flag in `src/config.ts`. Feature-gating pattern established by `POLY_ENABLED`, `POLY_EXPOSURE_AWARE_SIZING`, `POLY_REFLECTION_ENABLED`, `POLY_EXIT_ENABLED` — all read with the same `process.env.X || envConfig.X || 'false'` fallback chain.

## 2. Literature / NotebookLM finding

Standard technique (feature flag pattern). No literature needed.

The only external-facing constraint: the 2026-04-13 "trading-only pivot" in `MISSION.md` and `SOUL.md` declares personal-assistant features out of scope. Memory consolidation and voice were PA-era subsystems kept alive by their startup-wired imports. This sprint aligns runtime behavior with declared scope.

## 3. Duplicate / complement / conflict verdict

**Complement.** Adds no new behavior — it adds guards around existing behavior. Both flags default `false` so the post-deploy state matches the MISSION.md scope declaration (PA features off). Operator can re-enable by flipping env vars; reversible without code.

Not duplicate (no existing gate exists for these subsystems). Not conflict (the guarded code paths still work unchanged when flag is on). Not novel (matches the `POLY_*` flag pattern already in `src/config.ts`).

## 4. Why now

**Metric that improves**: monthly Gemini API spend drops from "≥~192 calls / 48h from the 30-min `runConsolidation` cron × ongoing" to **zero** when `MEMORY_ENABLED=false`. Combined with Stage 2 (GLM 5.1 migration for strategy modules), this eliminates all non-subscription LLM billing in the claudeclaw service.

**Timeline**: effect on next pm2 restart after flags are added to `.env`. No backfill needed.

**Trigger**: 2026-04-18 $150 Anthropic API spend incident + operator directive "switch to subscription based solutions for all the data feeds." The ambient Gemini leak was a parallel (smaller) burn to the $150 Anthropic burn; both must be closed before restart.

## 5. Out of scope

- **NO module deletions.** `memory.ts`, `memory-consolidate.ts`, `voice.ts`, `gemini.ts`, `embeddings.ts`, `learning.ts`, `media.ts` stay in the repo. Reversibility > purity.
- **NOT changing the guarded code paths' internal logic.** If an operator sets `MEMORY_ENABLED=true` later, the 30-min consolidation resumes as before.
- **NOT migrating Gemini to a subscription-based alternative.** If memory is re-enabled down the line, that conversation happens then.
- **`media.ts::cleanupOldUploads`** — stays unconditional (filesystem cleanup, no billing).

## 6. Risk

**Zero blast radius on trading paths.** Memory and voice have no consumers on the trading hot path (per audit). Flagging them off eliminates billing without affecting signal generation, risk gates, sizing, execution, or Telegram output beyond voice replies (which were already optional per-chat).

Rollback: single env flag flip + pm2 restart. No schema, no committed secrets, no state migration.

## 7. Verification plan

After Stage 1 is deployed (but before full claudeclaw restart per Stage 4 sign-off):

- Grep `pm2 logs claudeclaw` for `Memory consolidation enabled (every 30 min)` — this log line in `src/index.ts:165` must NOT appear on startup when `MEMORY_ENABLED=false`.
- Grep for "consolidation" in the startup logs — expect zero matches.
- Optional: trace a voice message attempt in a test chat — voice capability check should short-circuit with `VOICE_ENABLED=false`.

Thirty-day metric: compare Google AI Studio billing console month-over-month — expect a drop to ~$0 for the claudeclaw project after the flag-gate ships and the subsequent bot restart lands.
