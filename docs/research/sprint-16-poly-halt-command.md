# Sprint 16 — /poly halt + /poly resume Telegram commands

## 1. Existing-code audit

Prior art:

- `src/poly/strategy-engine.ts:28` — `HALT_KEY = 'poly.halt'` constant.
- `src/poly/strategy-engine.ts:263-267` — `isHalted()` reads `poly_kv.value === '1'`.
- `src/poly/strategy-engine.ts:271-274` — `onScanComplete` short-circuits when halted (logs "halt flag set, skipping cycle"). No engine changes needed.
- `src/poly/index.ts:34-41` — `polyKvGet` / `polyKvSet` helpers (NOT exported). Pattern: `INSERT ... ON CONFLICT(key) DO UPDATE SET value=excluded.value`.
- `src/poly/index.ts:66` — `poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)` schema.
- `src/poly/telegram-commands.ts:24-53` — switch dispatch over 12 existing subcommands. Each case follows `return void await ctx.reply(truncateForTelegram(renderX(db)).text)`.
- `src/poly/telegram-commands.ts:170` — `renderStatus` already inlines `SELECT value FROM poly_kv WHERE key='poly.halt'` for display.
- `src/trading/telegram-commands.ts:103-122` — `/trade halt` + `/trade resume` reference pattern. Differs in mechanism (writes a lock file via `controller.haltAll()` / `controller.haltInstance(name)`); semantics match (idempotent set/clear, plus user-facing reply).

Reusable primitives:

- `truncateForTelegram` from `./format.js` — already used by every existing case.
- The inlined UPSERT SQL from `polyKvSet` is the right write primitive.

## 2. Literature / NotebookLM finding

None needed. Pure CRUD on a single key.

## 3. Duplicate / complement / conflict verdict

**Complement.** All halt-flag plumbing already exists (engine read at `strategy-engine.ts:271`, status display at `telegram-commands.ts:170`, schema at `index.ts:66`). What's missing:

- A `case 'halt':` branch in the `/poly` switch dispatch that writes `poly.halt='1'`.
- A `case 'resume':` branch that writes `poly.halt='0'`.
- HELP text update.

Not duplicate (no existing Telegram command sets the flag — only direct SQL does). Not novel (write semantics are stock UPSERT). Not conflict (additive switch cases; existing read paths unchanged).

## 4. Why now

- **Operational**: kill-switch runbook (`docs/runbooks/kill-switch-drill.md` §3b) currently instructs operator to run a raw `node -e` shell command to set the flag. That's incident-time friction. A Telegram command removes it.
- **Gate dependency**: Sprint 17 (auto-halt on drawdown, B6 in plan cheerful-rossum) writes the flag from `gate2PortfolioHealth` on transition. Without `/poly resume`, the only recovery path after auto-halt fires is the same raw SQL — defeating the point of automation.
- **Mirror equity strategy**: `/trade halt` + `/trade resume` already exist for the regime-trader bridge. Polymarket should match for operator muscle memory.
- **Cost**: ~30 lines code, no new dependencies, single TDD pass.

## 5. Out of scope

- NOT modifying `polyKvSet` / `polyKvGet` to be exported from `src/poly/index.ts` — keeps the change surface to `src/poly/telegram-commands.ts` only. Inline UPSERT matches the existing `renderStatus` style.
- NOT auto-clearing a flag set by Sprint 17's auto-halt on `/poly resume` — that's a UX decision (operator may want explicit acknowledgment first). Defer to followup if requested.
- NOT changing `isHalted()` semantics (still strict `=== '1'`).
- NOT adding a "force" variant or partial-halt by strategy. Single global flag.
- NOT touching `/trade halt` or its file-lock mechanism. Different code path, different subsystem.

## 6. Risk

Zero blast radius for existing trading logic. Read-only on engine internals. Failure modes:

- **Concurrent set + read race**: SQLite serializes via the file lock, single-statement UPSERT is atomic. Read at `strategy-engine.ts:264` happens at start of next `onScanComplete` — guaranteed to see the latest committed value.
- **Halt set, but tick already in flight**: `this.running` guard at `:270` means the in-flight tick finishes; the next tick (5 min later) honors the halt. Acceptable for paper trading.
- **Operator confusion** ("I sent /poly halt, why are positions still open?"): expected and documented in the reply text — halt stops new signals, doesn't close positions. Reply explicitly says "next tick will short-circuit" and "open positions remain open."

## 7. Verification plan

- **Unit**: new test file `src/poly/telegram-commands.test.ts` (or extend existing if present). Cases:
  - `setHalt(db)` writes `poly.halt='1'` to `poly_kv`.
  - `clearHalt(db)` writes `poly.halt='0'`.
  - `setHalt` is idempotent — second call doesn't error, value stays `'1'`.
  - `clearHalt` is idempotent — second call doesn't error, value stays `'0'`.
  - `clearHalt` from no-row state (poly_kv has no `poly.halt` row) — UPSERT inserts the row with `'0'`.
  - Reply text contains "Halt SET" / "Halt cleared" + reminder about next-tick semantics.
- **Live**: after Phase B restart, send `/poly halt` from `ALLOWED_CHAT_ID`, then `/poly status` — should show "Halt: YES". Send `/poly resume`, then `/poly status` after one tick — should show "Halt: no". Combined with the kill-switch drill (Phase C10).
- **Engine integration**: not touching engine; engine's existing `isHalted()` read continues to work (verified in audit). No new test for engine integration needed.

## 8. Followups (not this sprint)

- Sprint 17 (B6 in plan cheerful-rossum) — auto-halt on drawdown writes the same flag.
- Possible future sprint: dashboard "halt is active" badge that pulls from same `poly_kv` read.
- Possible future sprint: `/poly halt --reason "<text>"` to record why halt was set, surfaced in dashboard + Telegram digest.
