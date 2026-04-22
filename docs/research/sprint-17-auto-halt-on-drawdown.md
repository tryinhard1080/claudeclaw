# Sprint 17 — Auto-halt poly.halt flag on drawdown transition

## 1. Existing-code audit

Prior art:

- `src/poly/risk-gates.ts:103-119` — `gate2PortfolioHealth` already detects `totalDrawdownPct >= haltDdPct` and returns a `passed: false` rejection. **Pure function, no DB access.**
- `src/poly/risk-gates.ts:39, 42-50` — `haltDdPct` reads `POLY_HALT_DD_PCT` (default 0.2 = 20% per `src/config.ts:229`).
- `src/poly/strategy-engine.ts:271-274` — `onScanComplete` short-circuits when `poly.halt='1'` is set. **Read-only on the flag at this point.**
- `src/poly/strategy-engine.ts:336` — `buildPortfolioSnapshot()` called once per candidate inside the eval loop (line 336 inside per-candidate iteration). Computes `totalDrawdownPct` at the moment of evaluation.
- `src/poly/strategy-engine.ts:263-267` — `isHalted()` returns `value === '1'`.
- `src/poly/telegram-commands.ts:HALT_KEY/writeHaltFlag` (Sprint 16, just shipped) — write primitive that takes `'0' | '1'` and UPSERTs into `poly_kv`.
- `src/poly/risk-gates.test.ts` — extensive existing test coverage of all three gates as pure functions.

Reusable primitives:

- `defaultGateConfig()` from `risk-gates.ts:42` — already returns `haltDdPct`.
- The UPSERT SQL from `telegram-commands.ts` is a duplicate of `index.ts:39` `polyKvSet`. Both are inline.

## 2. Literature / NotebookLM finding

None. Standard threshold-transition state machine (one bit, two states, edge-triggered write).

## 3. Duplicate / complement / conflict verdict

**Novel.** No existing code writes the `poly.halt` flag from anywhere except the new `setHalt`/`clearHalt` Telegram handlers (Sprint 16) and the original `polyKvSet` helper called at Polymarket init. Auto-write on drawdown is a new behavior.

**Critical design constraint** (per Plan-agent finding cheerful-rossum): the write must be **transition-only** — only when `previously not halted AND now over threshold`. Otherwise:

- Every tick post-halt rewrites the flag (cosmetic churn).
- Future "halt was newly set" detection (e.g., for a Telegram alert on first auto-halt) becomes ambiguous because every tick looks like a "new" halt.
- Race with operator's `/poly resume` — operator clears flag mid-tick, gate2 re-writes it next tick before operator gets time to investigate.

The transition rule means: gate sees DD over threshold → reads current flag → if flag is `'0'` or null, write `'1'` AND emit a "halt newly engaged" log line; if flag is already `'1'`, no-op.

**Where the function lives:** in `risk-gates.ts` next to `gate2PortfolioHealth`, but as a SEPARATE function because gate2 is pure (no `db` arg) and we don't want to break that contract. Function name: `maybeAutoHaltOnDrawdown(db, portfolio, config?)`. Returns `{ wrote: boolean, prior: '0' | '1' | null, current: '0' | '1' }` for testability.

**Where it's called:** `strategy-engine.ts onScanComplete`, ONCE per tick, after the `isHalted()` early-exit and before the candidate loop. Uses a single fresh `buildPortfolioSnapshot()` for that tick's drawdown reading.

## 4. Why now

- **Plan dependency**: B6 in plan cheerful-rossum. Ships in the same restart batch as B5 (`/poly resume`) so the operator has a recovery path when auto-halt fires.
- **Currently broken safety**: at 20% drawdown today, the bot keeps trying to open positions every tick — they get rejected by gate2, but the bot wastes CLOB queries and signal-eval cycles fighting a circuit it can't break. Setting the flag turns the futile reject loop into a clean short-circuit.
- **Dashboard signal**: existing `renderStatus` (`telegram-commands.ts:182`) and the dashboard's open-positions card both already read `poly.halt`. Auto-write means both surfaces show "Halt: YES" the moment the threshold trips, without operator action.
- **Cost**: ~25 lines new code + 1 line in engine + 5-6 unit tests. No new dependencies.

## 5. Out of scope

- NOT modifying `gate2PortfolioHealth` itself. It stays pure. The reject-on-DD behavior is preserved for the case where the auto-halt write somehow doesn't take effect before the next signal eval (defense in depth).
- NOT auto-clearing on DD recovery. If DD drops back below threshold, the flag stays set until operator runs `/poly resume`. Rationale: if we hit 20% drawdown, that's a "stop and think" moment for the operator, not "keep going at 19.9%."
- NOT emitting a Telegram alert from the gate (would require alert-channel plumbing in a pure-ish helper). The "halt newly engaged" log line at WARN level is enough for now; alert wiring is a followup.
- NOT changing `POLY_HALT_DD_PCT` default (stays 0.2). Tunable via env.
- NOT touching `gate2PortfolioHealth` rejection-message format (tests downstream depend on it).

## 6. Risk

- **Boot-time stale-DD halt loop**: if PnlTracker's last-tick `unrealized_pnl` was stale at boot and showed apparent DD over threshold, gate would write halt on first tick. Mitigation: `buildPortfolioSnapshot` reads live data; first tick's snapshot is fresh. Also: write is transition-only — if the flag was already set pre-restart (operator-set or prior auto-halt), it stays set, no churn.
- **Idempotency failure**: implementation reads then writes; race between read and write means two ticks could both observe `prior='0'` and both write. Mitigation: SQLite serializes writes; second writer's UPSERT is a no-op semantically. Test covers this.
- **Operator clears, gate immediately re-sets**: if DD is still over threshold when operator runs `/poly resume`, the next tick will auto-halt again. This is correct behavior — operator should investigate before resuming if DD is genuinely over threshold. The Telegram reply for `/poly resume` already says "Engine resumes evaluation on the next tick" — operator knows what they're signing up for.
- **Test mocking risk**: Plan-agent flagged "no mocking when real DB is cheap." Tests use `:memory:` better-sqlite3 — same as Sprint 16.

## 7. Verification plan

- **Unit** (risk-gates.test.ts new section):
  - `maybeAutoHaltOnDrawdown` writes `'1'` and returns `{ wrote: true, prior: null, current: '1' }` when DD ≥ threshold and no prior flag row exists.
  - Same scenario but with prior `'0'` row: writes `'1'`, returns `{ wrote: true, prior: '0', current: '1' }`.
  - DD ≥ threshold AND prior row is `'1'`: NO write, returns `{ wrote: false, prior: '1', current: '1' }` (idempotent).
  - DD < threshold AND no prior row: NO write, returns `{ wrote: false, prior: null, current: '0' }` (no churn — does NOT seed a `'0'` row defensively).
  - DD < threshold AND prior row is `'1'` (operator manually halted): NO write, returns `{ wrote: false, prior: '1', current: '1' }` (don't auto-clear; operator-set flags are sacred).
  - DD < threshold AND prior row is `'0'`: NO write, returns `{ wrote: false, prior: '0', current: '0' }`.

- **Integration** (engine-side): one engine test that calls `onScanComplete` with a portfolio at 25% DD and asserts the flag is set in poly_kv afterwards. Optional — engine-level integration tests are heavier; if test budget tight, the unit tests + manual live verification at restart suffice.

- **Live**: deferred to Phase B end-of-batch restart (combined with Sprint 16 verification). The auto-halt path will only fire in production if DD legitimately crosses 20%, which will not happen in the next 30 days at current capital + position sizing.

## 8. Followups (not this sprint)

- Telegram alert on first auto-halt (require alert-channel plumbing).
- Dashboard "halt is active" badge with reason ("auto: drawdown" vs "manual").
- `/poly halt --reason "<text>"` to record manual-halt rationale (paired with auto-halt's implicit reason).
- Consider whether `gate2PortfolioHealth` rejection message should be augmented to mention "engine will auto-halt" as an explicit hint to log readers.
