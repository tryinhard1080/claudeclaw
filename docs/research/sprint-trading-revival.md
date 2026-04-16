# Sprint — `src/trading/` revival (audit remediation Phase 3)

> Charter revival: SOUL.md calls for two markets (equities via regime-trader, Polymarket native). Audit found state.json stale since 2026-04-11 (Python partner stopped) and zero tests on src/trading/ (650 LOC).

## 1. Existing-code audit

- `src/trading/state-poller.ts` — polls `instances/<name>/data/state.json` every 5s, detects regime changes + circuit-breaker activations. Catches read errors → emits `instance_error`.
- `src/trading/alerts.ts` — 15-min-throttled Telegram sender, types: regime_change, circuit_breaker, instance_down, instance_halted.
- `src/trading/instance-control.ts` — halt/resume wrappers.
- `src/trading/index.ts` — wires poller events → alert manager.
- `src/trading/types.ts` — InstanceState shape.
- `src/trading/telegram-commands.ts` — `/trade` Telegram surface.
- Zero test files. `find src/trading -name '*.test.ts'` returns nothing.

## 2. Literature / NotebookLM finding

Not applicable — this is plumbing, not strategy. The failure mode is "Python partner stopped, Node side reads frozen file forever." Standard file-IPC hazard; solution is a staleness check.

## 3. Duplicate / complement / conflict verdict

**Complement.** Existing poller detects (a) *file unreadable* (instance_error) and (b) *regime value changed* (regime_change). It does NOT detect (c) *file readable but stale*, which is exactly the Python-partner-crashed failure mode. New alert closes the gap.

## 4. Why now

Audit revealed state.json last-modified 2026-04-11 while the bot has been running normal Polymarket scans. The bot has been silently consuming a stale state file for 4 days. Without the staleness alert, this failure is invisible to the operator.

Metric: median time between Python crash and operator notification → goes from "indefinite" to "≤1 hour" (first alert after `stalenessMs` threshold).

## 5. Out of scope

- Restarting regime-trader from TS side (operator starts it; we only monitor).
- Schema changes to state.json.
- Adding new Telegram commands beyond existing `/trade` surface.
- Expanding test coverage to 100% of src/trading/ — focus on staleness path + existing event emission paths.

## 6. Risk

Blast radius: **low**. New emission path + threshold check in state-poller; does not touch strategy or execution. New tests green means no regression.

## 7. Verification plan

- Unit tests: staleness alert fires exactly once per threshold-cross, doesn't re-fire while stale, re-arms after state becomes fresh again.
- Live test: confirm alert fires on current stale state (file is already 4 days old, should alert on next poll cycle once deployed).

[audit]
