# Codex review — Sprint S2 (TTL filter shadow mode) — 2026-05-12

**Reviewer:** `feature-dev:code-reviewer` agent (codex CLI 0.130.0 stdin regression still unfixed; agent is the documented working path per 2026-05-12 full-project review).
**Commit reviewed:** Sprint S2 ship (HEAD on `main` after the push of the TTL-filter shadow-mode files).
**Verdict:** **0 P0 / 0 P1 / 1 P2 (FIXED) / 1 P3 (no action)**

---

## Files in scope

- `migrations/v1.16.0/v1.16.0-ttl-shadow-ticks.ts`
- `migrations/version.json`
- `src/poly/ttl-filter.ts`
- `src/poly/ttl-filter.test.ts`
- `src/poly/market-scanner.ts` (the S2-shadow block lines 120-128)
- `src/config.ts` (POLY_MIN_MARKET_TTL_DAYS, POLY_MAX_MARKET_TTL_DAYS additions)
- `.env.example`
- `scripts/poly-ttl-shadow-report.ts`
- `docs/research/sprint-s2-ttl-filter-shadow.md`

## Shadow isolation — confirmed clean

Candidate list is not mutated. `partitionByTtl` is pure (returns a new partition object, does not modify input). `scanWrite(this.db, markets, candidates, ...)` runs at `market-scanner.ts:113` BEFORE the shadow block at lines 120-128. The try/catch at lines 120-128 wraps all three shadow calls (`partitionByTtl`, `summarizeTick`, `recordTtlShadowTick`) — a failure anywhere is caught, logged at `warn` level, and cannot propagate to `recordScanRun` or the outer scan path.

TRUST.md Tier-3 surface check:
- `risk-gates.ts`: 0 TTL/shadow hits
- `paper-broker.ts`: 0 hits
- `pnl-tracker.ts`: 0 hits
- `strategy-engine.ts`: 10 hits — all pre-existing weather/reflection shadow refs from prior sprints, **zero S2 edits**

## P2 — `created_at` stored as ms, not unix seconds (FIXED in same session)

**Location:** `src/poly/ttl-filter.ts:136` (in `recordTtlShadowTick`).

**Issue:** `Date.now()` (milliseconds, ~1.78e12) was passed where the project convention is unix seconds (`Math.floor(Date.now() / 1000)`, ~1.78e9). Stored value would represent year ~58000. The convention is explicit in `src/memory.ts:136` and consistently followed by `paper-broker.ts`, `calibration.ts`, `regime.ts`, `strategy-engine.ts`. The `poly_ttl_shadow_ticks.created_at` column is `INTEGER NOT NULL`.

**Functional impact in shadow mode:** zero today. `summarizeTtlShadowWindow` windows on `scan_tick_at` only; the report script never reads `created_at`. The bug grows risk if any future sprint adds pruning (`DELETE WHERE created_at < cutoff`), freshness checks, or JOINs against other tables' `created_at`.

**Fix (committed as `[hotfix]` immediately after the codex finding):**
```ts
// src/poly/ttl-filter.ts line 136
- Date.now(),
+ Math.floor(Date.now() / 1000),
```

**Regression test** added at `src/poly/ttl-filter.test.ts` — asserts `created_at` lands in unix-seconds range (`< 1e11`) and within `[before, after]` of the wall clock at write time.

**Existing-row backfill:** none required. The hotfix lands BEFORE the first pm2 restart that activates the new scanner block, so no production rows are written with the bad value.

## P3 — `ensureTable` called every scan tick (no action)

**Location:** `src/poly/ttl-filter.ts:119` (in `recordTtlShadowTick`).

**Issue:** `recordTtlShadowTick` calls `ensureTable(db)` unconditionally on every invocation, issuing a two-statement DDL string (`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`) ~96 times per day at the default 15-min interval.

**Why no action:** consistent with the established project pattern. `src/poly/news-intersection.ts` calls an identical `ensureTable` at the top of both `findIntersections` and `recordAlert`. SQLite's `IF NOT EXISTS` is a fast catalog lookup after first creation. No measurable cost; refactor only if the pattern is changed project-wide.

## Boundary and logic verification (all passed)

- **`partitionByTtl` inclusive boundaries.** Strict `<` and `>` comparisons mean exactly-`minDays` and exactly-`maxDays` land in `pass`. Tests at `ttl-filter.test.ts:59-68` verify.
- **Negative TTL (already-resolved markets).** `d < minDays` (default minDays=1) catches negative d → `filteredMin`. Test at line 72 verifies.
- **`meanTtl` null guard.** Returns `null` when `markets.length === 0`. `avgTtlFiltered` guarded by `filteredAll === 0 ? null`. No division-by-zero possible.
- **`summarizeTtlShadowWindow` division-by-zero.** `rows.length === 0` returns `null` early; subsequent divisions use `rows.length >= 1`. `passRate` returns `0` when `sumTotal === 0`. Safe.
- **Env var non-numeric values.** `num()` helper at `config.ts:219-223` returns the default (1 or 30) when `Number.isFinite(n)` fails.
- **Migration DDL vs `ensureTable` DDL.** Identical columns, constraints, index. No drift.
- **`version.json`.** Correctly registered as `"v1.16.0": ["v1.16.0-ttl-shadow-ticks"]`.
- **Report script.** `{ readonly: true }` at `scripts/poly-ttl-shadow-report.ts:106`. Cannot write to the production DB.
- **`tickSec` semantics.** `Math.floor(started / 1000)` = scan start epoch, matches `recordScanRun`'s `startedAt`.

## Cross-reference to prior P3

The 2026-05-12 full-project review filed a P3: "market-scanner.ts topN-before-TTL ordering note for Sprint S2 implementation." The shipped code partitions the post-topN candidate set, not the full market universe. This is correct for shadow mode — the comparison reflects what the TTL filter would have done to the same markets the strategy evaluates, keeping S4's impact projection accurate. If S4 applies TTL before the topN cap, the shadow data will slightly undercount the final pass set; surface at S4 design time. Not an S2 defect.

## Findings table (for findings.md)

| Date | Sprint | Severity | Finding | Status | Commit |
|---|---|---|---|---|---|
| 2026-05-12 | S2 (TTL shadow) | P2 | `src/poly/ttl-filter.ts:136` `recordTtlShadowTick` stored `Date.now()` (ms) as `created_at` instead of unix seconds. No reader queries the column today; zero functional impact. Existing rows: none (fix landed before first scanner-block activation). | FIXED same-session | `<hotfix commit>` |
| 2026-05-12 | S2 (TTL shadow) | P3 | `src/poly/ttl-filter.ts:119` `ensureTable` called per-tick. Consistent with `news-intersection.ts` pattern. | NOTE (no action) | — |

---

## Box-5 implications

This pass is the codex-review re-run trigger called out in `findings.md` last-pass note ("ship of Sprint S2 (TTL filter shadow mode)"). With the P2 fixed and the P3 filed-no-action, **Box 5 stays ackable** (0 P0 / 0 P1 outstanding).

The next codex re-run trigger remains: any Phase 7 flag-flip; any subsequent edit to a TRUST Tier-3 surface; ship of Sprint S4 (TTL flag-flip from shadow to active); OR codex CLI 0.130.0 stdin fix that allows a formal codex run.
