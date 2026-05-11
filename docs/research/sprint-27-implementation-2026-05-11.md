# Sprint 27 — Resolution-Backfill Implementation (2026-05-11)

> Companion to `sprint-27-resolution-backfill-audit-2026-05-11.md` (the audit). This note covers the code change.

## Verdict on prior art

**NOVEL.** Existing-code audit:

- `scripts/fetch-resolutions.ts:38-41` — slug pool is hard-coded to `SELECT DISTINCT market_slug FROM poly_signals`. No priority queue, no open-trade preference, no coverage metric, no alarm.
- `src/poly/backtest.ts:208 persistResolution` — UPSERT helper. Untouched by this sprint (already correct).
- `src/poly/pnl-tracker.ts` — consumer of cache. Untouched (would be Tier-3 to edit).
- No prior coverage-metric or alarm code in the repo. `grep -ri "coverage" src/poly/` returns nothing related.

Conflict: none. Complement: extends the existing fetcher script with two pure helpers and a poly_kv-backed history.

## Scope

Per audit (Finding 2: 20 of 31 lifetime trades have no cache row):

1. **Priority queue.** Modify `scripts/fetch-resolutions.ts` to fetch open-trade slugs first, then signal-evaluated slugs. Preserves the `--limit` and `--closed-only` flags.
2. **Coverage metric.** Compute `coveragePct = tradesWithCache / totalOpenTrades * 100` after each fetch run. Persist last 5 measurements in `poly_kv` under key `poly.coverage.history` (JSON).
3. **Alarm.** Fire when last 2 consecutive coverage measurements are both `< 80%`. Alarm = stderr line with a `[coverage-alarm]` prefix so the cron-shell-runner routes it to Telegram (same pattern news-sync uses).
4. **Regression test.** Tests in new file `src/poly/resolution-coverage.test.ts` cover: priority queue ordering + dedup, coverage formula edge cases (zero trades, full coverage, partial), alarm threshold logic (one fire below 80% does not alarm; two consecutive does).

## Non-goals

- No new DB migration. `poly_kv` exists with `(key TEXT PRIMARY KEY, value TEXT NOT NULL)` schema (created on-demand by `initPoly` / `StrategyEngine`). The coverage helper uses the same on-demand-create pattern, no `updated_at` column.
- No Tier-3 surface touched. Files in the change list: `scripts/fetch-resolutions.ts` (script), `src/poly/resolution-coverage.ts` (new module), `src/poly/resolution-coverage.test.ts` (new test). None of `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, `strategy-engine.ts` are touched.
- No cron-schedule change. Existing task `a6e080bd` (kind=shell, script_path=`scripts/fetch-resolutions.ts`) continues firing on its current cadence.
- No change to `persistResolution` or any UPSERT semantics.

## Why the alarm threshold is 80% (not the 95% target)

The audit recommends 95% target with 80% alarm. The gap exists so a single missed cycle doesn't fire — only sustained degradation does. 95% target means "we want this every cycle"; 80% alarm means "tell the operator if it stays bad for two cycles." Same shape as the production heartbeat alarms in `news-sync.ts`.

## Test plan (TDD order)

1. RED: write priority-queue test (open-trade slugs first, dedup), run, fail.
2. GREEN: implement `buildSlugPriorityQueue`, pass.
3. RED: coverage formula test (4 cases: 0/0, 5/5, 3/5, 0/5), run, fail.
4. GREEN: implement `computeCoverage`, pass.
5. RED: alarm test (history length <2: no alarm; one fire <80%: no; two consecutive <80%: yes; mix: no), run, fail.
6. GREEN: implement `shouldAlarmCoverage`, pass.
7. Wire `scripts/fetch-resolutions.ts` to use the new module. No new tests for the script itself (thin wrapper).

## Acceptance

- All new tests pass.
- `npm test` total stays ≥733 (was 733 at session start; adds ~8-10 tests).
- `npm run typecheck` clean.
- `npm run build` clean.
- pm2 `claudeclaw-main` restart count increments by 1 only.
- Manual fetcher run (`npx tsx scripts/fetch-resolutions.ts --limit 20`) emits a final `[coverage]` line and (when coverage is below 80% and history allows) a `[coverage-alarm]` line.

## How this changes our code/strategy

The fetcher will now prioritize the bot's actual exposure rather than the entire scanner-evaluated universe. When Polymarket starts resolving any of the 10 open positions, the cache will already have the row, so `pnl-tracker` transitions the trade on the same cycle instead of waiting for the next cron fire. Coverage history in `poly_kv` gives the daily digest something to reference. Long-term: the coverage metric becomes a leading indicator for Box-2 P&L lag — if coverage stays ≥95% but resolutions don't increment, that's a Polymarket-side delay, not a bot-side delay.
