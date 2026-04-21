# Sprint scanner-bloat-fix — 2500x write reduction + index + WAL tuning

## 1. Existing-code audit

- `src/poly/market-scanner.ts::capturePrices` — previously wrote
  `outcomes.length` rows per Market × ~50,000 markets = ~100,000
  `poly_price_history` rows every 5-min tick.
- `src/poly/market-scanner.ts::pruneOldPrices` — hardcoded 36h cutoff,
  DELETE without retention parameter.
- `src/poly/market-scanner.ts::upsertMarkets/capturePrices/pruneOldPrices`
  — three separate `db.transaction()` invocations, no atomicity.
- `src/poly/strategy-engine.ts::selectCandidates` — private method that
  filters markets by volume/TTR/price-band/YES-outcome and slices to
  `topN=20`. The exact set we'd want to capture prices for.
- `src/db.ts` line 260 — only `journal_mode = WAL` pragma set. Default
  `wal_autocheckpoint = 1000 pages (~4 MB)`, `synchronous = FULL`.
- `migrations/v1.2.0/v1.2.0-poly.ts` — created `poly_price_history` with
  only composite PK `(token_id, captured_at)`. **No index on
  `captured_at` alone.**
- `src/poly/price-history.ts::getPriceApproxHoursAgo` — only consumer of
  `poly_price_history` outside the scanner itself. Used by the `/prices`
  Telegram command.

## 2. Literature / NotebookLM finding

Standard SQLite operational guidance. From the SQLite WAL docs
(https://www.sqlite.org/wal.html §7): "If the writing thread can generate
log pages faster than the checkpointer can clear them, the log will grow
without bound." And from better-sqlite3 performance notes: a secondary
index on a `WHERE ... < ?` column converts an O(n) full-table-scan DELETE
into an O(log n + k) range scan. No specialized research needed.

## 3. Duplicate / complement / conflict verdict

**Complement, with one extraction to prevent future drift.**

- The scanner's write lifecycle (B1, B3, B4) does NOT duplicate existing
  code. It narrows the write scope and makes the existing three writes
  atomic.
- `selectPriceCaptureCandidates` is extracted from
  `StrategyEngine.selectCandidates` so the scanner can reuse the SAME
  filter/sort/slice the engine uses. Eliminates the risk of "scanner
  captures X but engine evaluates Y" drift.
- The v1.10.0 index fills a gap in the original v1.2.0 schema, not a
  replacement. Defensive `CREATE INDEX IF NOT EXISTS` in `initPoly`
  mirrors the v1.5.0 / v1.8.0 precedent for upgraded installs.
- `db.ts` WAL pragma tuning does not change WAL semantics, only
  thresholds and sync mode. `synchronous=NORMAL` is safe under WAL.

## 4. Why now

- Diagnostic restart 2026-04-20 showed the scanner hung at the DB-write
  block with a 9.3 GB main file and 5.5 GB WAL (see
  `docs/research/sprint-scanner-instrumentation.md` for how we
  localized that). The root cause chain: no index on `captured_at` →
  prune is O(n) on ~43M rows → seconds of locked write per scan → WAL
  grows faster than checkpoint → each scan slower than the last →
  `if (this.scanning) return;` guard silently drops every tick. Scanner
  effectively never completes another cycle.
- Metric targets:
  - Per-tick `poly_price_history` writes: 100,000 → 40. (2500x reduction.)
  - Per-tick scan duration: 270-304s → < 2s after fetch (fetch itself
    remains ~30s on the Gamma side).
  - WAL steady-state size: 5.5 GB → < 10 MB.
  - DB growth per week: ~1.5 GB → ~1 MB.

## 5. Out of scope

- **Migration of historical `poly_price_history` rows.** Existing data
  covers every market; we don't retroactively prune non-candidate
  markets. The 24h retention window naturally drops them within a day
  post-deploy.
- **Per-token retention.** All rows use the same retention window. Fine
  for the current `/prices` use case.
- **Dashboard refactor.** Concurrent readers on `consolidations` etc.
  still exist; Part E of peaceful-turtle only drops the truly-unused
  `wa_*` / `slack_messages`.

## 6. Risk

- **Scan write atomicity change** (B4): previously `upsertMarkets` could
  succeed even if `pruneOldPrices` failed — scanner still committed
  market state. Now either all three apply or none. Net-positive for
  correctness, but if SQLite rollback behavior surprises, symptom would
  be "no new rows in poly_markets after error" which the scanner
  already handles (recordScanRun with status='error').
- **`synchronous=NORMAL`** (B5): on OS crash / power loss, last ~1s of
  WAL writes can be lost. Paper-trading tolerates this; a halt-and-revert
  just means the next scan re-captures the markets. `FULL` would flush
  after every commit but 2-3x slower writes.

## 7. Verification plan

- Unit tests added in `market-scanner.test.ts`:
  - `scanWrite` writes all markets + only candidate prices + prunes old
    rows in one transaction.
  - `scanWrite` rolls back cleanly on mid-transaction failure.
  - `pruneOldPrices(db, 24)` and `pruneOldPrices(db, 48)` honor
    the retention parameter.
- Unit tests added in `strategy-engine.test.ts`:
  - `selectPriceCaptureCandidates` filters closed/low-vol/too-soon/
    price-band/no-YES markets.
  - Sort-desc-by-volume + topN slicing works.
  - Drift check: `StrategyEngine.selectCandidates` still behaves the
    same (passes via existing `limits evaluation to topN` test).
- Post-deploy: watch WAL size hourly for 24h. Should plateau < 50 MB.
- 30-day window: `poly_scan_runs` rows continuously at configured
  cadence; no gap > 2 × interval.
