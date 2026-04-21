# Sprint scanner-instrumentation — POLY_SCAN_DEBUG trace markers

## 1. Existing-code audit

- `src/poly/market-scanner.ts::MarketScanner.runOnce` — the only scan entry point.
  Logs via `pino` with one `logger.info('poly scan complete')` line per successful cycle.
- `src/logger.ts` — pino with `pino-pretty` transport in non-production; the
  worker-thread transport is a known source of silent stalls under pm2 on
  Windows when the downstream pipe buffers fill.
- No existing `process.stdout.write` bypass anywhere in the scan path.

## 2. Literature / NotebookLM finding

Standard diagnostic technique — direct `process.stdout.write` is synchronous
and bypasses transports, so it still produces output when pino's worker has
stalled. No special literature needed.

## 3. Duplicate / complement / conflict verdict

**Complement.** The existing `logger.info('poly scan complete')` only fires
once per successful scan. It's useless for diagnosing hangs mid-scan because
it never runs. The new `[SCAN ...]` markers trace six points inside
`runOnce`, giving us a bisectable signal: whichever marker fails to appear
localizes the hang to a known line range.

## 4. Why now

Phase 0.5 GLM restart (2026-04-20) went silent 83 minutes in with zero
`poly_scan_runs` rows, zero CPU, and zero pino-visible logs. Four handoff
hypotheses (pino flush / OpenAI SDK load / overdue crons / MEMORY_ENABLED)
were all plausible but unfalsifiable from logs alone. First restart with
`POLY_SCAN_DEBUG=1` falsified all four in one pass and localized the hang
to the synchronous DB-write block between `post-fetch` and `post-db`. This
immediately led to the 9.3 GB DB / 5.5 GB WAL discovery and drove the
twinkling-dragon Phase 0.75 (peaceful-turtle) remediation plan.

Metric: time-to-diagnose reduced from "2 days of speculation" to "one
restart cycle." Keep the knob landed so the next silent failure is
equally quick to localize.

## 5. Out of scope

- No scanner-logic change. Markers are observation-only.
- No retention of markers in pino/DB. They go to stdout (pm2 log file) only.
- No automated alerting. That's Part D of peaceful-turtle.

## 6. Risk

None. Zero behavior change when `POLY_SCAN_DEBUG=0` (the default — the
`scanTrace` function early-returns on the flag). When enabled, adds ~6
stdout writes per scan (~1 KB), which is negligible.

## 7. Verification plan

- Flag off: `POLY_SCAN_DEBUG=0`, restart, confirm no `[SCAN` lines in
  `~/.pm2/logs/claudeclaw-out.log`.
- Flag on: `POLY_SCAN_DEBUG=1`, restart, confirm six markers per scan
  (entry, pre-fetch, post-fetch, post-db, post-emit, finally). Runtime
  overhead ≤ 5 ms per scan.

This is permanent infrastructure. Do not revert.
