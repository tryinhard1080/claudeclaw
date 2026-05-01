# Sprint 22 — Cron prompt audit

**Verdict:** novel (no prior tooling for prompt-drift detection in this repo)
**Track:** Polymarket — `src/poly/news-sync.ts`, `src/poly/strategies/ai-probability.ts`
**Tier:** 2 (no risk-gates.ts or paper-broker.ts touched; new script + snapshot files only)

## Problem

The two production-critical prompts in this codebase are:

| Prompt | Source | Visibility |
|---|---|---|
| `NEWS_SYNC_PROMPT` | `src/poly/news-sync.ts:25` | exported plain string |
| `SYSTEM_PROMPT` (+ `USER_PROMPT_SKELETON`) for ai-probability | `src/poly/strategies/ai-probability.ts:10`, `:32` | module-internal; collapsed into exported `PROMPT_TEMPLATE_HASH` (`:72`) |

A silent edit to either drifts model behavior without any signal in the surrounding system. There is no PR check, no test, no monitor that fires on drift. The risk: someone "tightens up" a prompt to fix a typo and inadvertently shifts probability calibration mid-soak. The 30-day clock would be running on a different signal than the operator thought.

## Existing-code audit

- `PROMPT_TEMPLATE_HASH` already exists in `ai-probability.ts:72` for cache invalidation. It hashes `${PROMPT_VERSION}|${SYSTEM_PROMPT}|${USER_PROMPT_SKELETON}`. Any edit to the system prompt or skeleton automatically changes the hash.
- `PROMPT_VERSION = 'v3'` is the operator-controlled label for prompt generations.
- No prior `docs/prompts/` directory or any scripts/ tooling for prompt audit. Verdict: **novel, no duplication.**

## Design

Two snapshot files, one drift-check script, one test file.

### Snapshots (committed)

- `docs/prompts/snapshots/news-sync.txt` — verbatim copy of `NEWS_SYNC_PROMPT`. Drift = textual diff.
- `docs/prompts/snapshots/ai-probability.hash` — two lines, `version=v3` and `hash=<16-char hex>`. Drift = either field changes.

Why a hash file for ai-probability and not the full prompt text: the system prompt is not exported. The hash is. Snapshotting the hash is the cheapest way to detect any change without restructuring the module exports — and the developer who edits the prompt sees the test/script fail immediately, with a clear path (run with `--update`) to update the snapshot intentionally.

### Script: `scripts/check-prompt-drift.ts`

- Imports `NEWS_SYNC_PROMPT`, `PROMPT_VERSION`, `PROMPT_TEMPLATE_HASH` from `dist/`.
- Reads the two snapshot files.
- Compares; on drift, prints a human-readable report (unified diff for news-sync, before/after for ai-probability hash + version).
- Exit 0 on no drift, 1 on drift.
- `--update` flag: rewrites snapshots from current runtime values. For when an edit is intentional.

### Tests: `scripts/check-prompt-drift.test.ts`

- Pure-function unit tests on a `compareSnapshot()` helper exported from the script. Covers: identical inputs, drifted inputs, missing snapshot file (treated as first-run, drift detected with full body printed), `--update` write path against a tmpdir.

## Wiring

Once the script is shipped, it can be added to the scheduler as a shell-kind task:

```
node dist/schedule-cli.js create-shell "scripts/check-prompt-drift.ts" "0 8 * * *"
```

The non-zero exit + Telegram failure path (already present in `runShellTask` via `updateTaskAfterRun(... 'failed')`) gives operator-visible drift alerts. Wiring into the scheduler can land in this same sprint or in a follow-up; the script alone is the load-bearing piece.

## How this changes our code/strategy

Closes a silent-failure surface that would otherwise be only caught after P&L noise was visible. Adds zero runtime cost to the bot itself (audit runs out-of-band as a scheduled shell task). Snapshot files commit a permanent record of what the prompts were on each release date — useful for retrospectives.
