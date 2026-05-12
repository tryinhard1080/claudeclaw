# Sprint S2 — Polymarket TTL filter (shadow mode)

**Date:** 2026-05-12 17:45 CT
**Author:** Bot (Opus 4.7)
**Closes (gate-box impact):** Box 2 (≥50 resolved Polymarket trades). Per `docs/plans/2026-05-12-real-money-gate-closure.md` §6 Sprint S2.
**Verdict:** **NOVEL** — no prior TTL band filter or shadow-comparison harness exists. Touches scanner-adjacent code but **not** any TRUST.md Tier-3 surface (`risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, `strategy-engine.ts`).

---

## 1. Why this sprint

`docs/plans/2026-05-12-real-money-gate-closure.md` §3 math:

```
Signals evaluated since 2026-04-21:           42,415
Signals approved (strategy + 3 risk gates):       31    (0.073%)
Approved trades that have resolved:                0
Approved trades currently open:                   10    (mostly long-dated political/event)
Approved trades voided (delisted):                21
```

Open approved positions are biased toward 2026-Q3/Q4/2027/2028 markets. Most won't resolve before the calendar Box-1 + Box-3 windows close. Constraining the time horizon at the scanner level is the smallest possible change that bends Box 2's curve. Path A authorized 2026-05-12 (`5c2bd2c`).

Shadow-first is mandatory: ship the filter alongside the existing pipeline, log "would-have-filtered" markets for 14 days, then operator decides flag-flip after comparison data lands (Sprint S4, Tier-3 strategy parameter change).

## 2. Existing-code audit

| Location | Current behavior | S2 hook |
|---|---|---|
| `src/poly/market-scanner.ts` `MarketScanner.runOnce` | Calls `selectPriceCaptureCandidates(markets, ...)` for the topN price-capture / strategy-eval set | Add a non-mutating partition-by-TTL pass after candidate selection; persist tick stats |
| `src/poly/strategy-engine.ts` `selectPriceCaptureCandidates` | Filters by `closed`, `volume24h`, `endDate >= nowSec + minTtrHours*3600`, yes-price band | TTL filter is the natural sibling of `minTtrHours` (lower bound). S2 adds an upper bound but **does not** mutate this function in shadow mode |
| `src/config.ts` | Holds `POLY_MIN_TTR_HOURS` etc. | Add `POLY_MAX_MARKET_TTL_DAYS` (default 30), `POLY_MIN_MARKET_TTL_DAYS` (default 1) |
| `src/poly/strategy-compare.ts` + `scripts/poly-strategy-compare.ts` | Brier-paired Strategy A/B comparison (resolution-based) | New report path is fundamentally different (no Brier-pairing); ship as a sibling `scripts/poly-ttl-shadow-report.ts` rather than overloading the existing CLI |
| `src/poly/types.ts` `Market` | `endDate: number` (unix sec) — already normalized | reused as-is |

`grep -E 'POLY_MAX_MARKET_TTL\|POLY_MIN_MARKET_TTL\|MARKET_TTL'` returns hits only in `MISSION.md`, `HANDOFF.md`, and the closure plan. **No code prior art.** NOVEL verdict confirmed.

## 3. Design

### 3.1 Pure module (testable, zero side effects)

`src/poly/ttl-filter.ts` (NEW):

```ts
export interface TtlBand { minDays: number; maxDays: number; }

export interface TtlPartition<T> {
  pass: T[];           // inside [minDays, maxDays] band
  filteredMin: T[];    // resolves too soon (< minDays)
  filteredMax: T[];    // resolves too late (> maxDays)
}

export function partitionByTtl(
  markets: Market[],
  band: TtlBand,
  nowSec: number,
): TtlPartition<Market>;

export interface TtlTickStats {
  candidatesTotal: number;
  candidatesTtlPass: number;
  filteredMin: number;
  filteredMax: number;
  avgTtlPass: number | null;       // null if pass set empty
  avgTtlFiltered: number | null;   // null if filtered sets both empty
}

export function summarizeTick(p: TtlPartition<Market>, nowSec: number): TtlTickStats;
```

Pure functions only. Caller passes `nowSec` so tests are deterministic.

### 3.2 Schema (migration v1.16.0)

`migrations/v1.16.0/v1.16.0-ttl-shadow-ticks.ts`:

```sql
CREATE TABLE IF NOT EXISTS poly_ttl_shadow_ticks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_tick_at       INTEGER NOT NULL,           -- unix sec, scan start
  candidates_total   INTEGER NOT NULL,           -- topN markets after current filters
  candidates_ttl_pass INTEGER NOT NULL,          -- subset inside TTL band
  filtered_min       INTEGER NOT NULL,           -- excluded for TTL too short
  filtered_max       INTEGER NOT NULL,           -- excluded for TTL too long
  avg_ttl_pass       REAL,                       -- mean TTL days of pass set; null if empty
  avg_ttl_filtered   REAL,                       -- mean TTL days of filtered set; null if empty
  band_min_days      REAL NOT NULL,              -- env var snapshot at tick time (audit trail)
  band_max_days      REAL NOT NULL,
  created_at         INTEGER NOT NULL,
  UNIQUE(scan_tick_at)                            -- one row per scan tick
);
CREATE INDEX IF NOT EXISTS idx_poly_ttl_shadow_ticks_at ON poly_ttl_shadow_ticks(scan_tick_at DESC);
```

`band_min_days` / `band_max_days` snapshotted per row so the report stays interpretable if the operator tunes the env vars mid-window.

### 3.3 Scanner wiring

`src/poly/market-scanner.ts` `runOnce`, after `selectPriceCaptureCandidates(...)`:

```ts
// Sprint S2 shadow: partition candidates by TTL band, persist tick stats.
// SHADOW ONLY — does NOT mutate the candidate list. Existing pipeline runs unchanged.
try {
  const partition = partitionByTtl(candidates, {
    minDays: POLY_MIN_MARKET_TTL_DAYS,
    maxDays: POLY_MAX_MARKET_TTL_DAYS,
  }, Math.floor(started / 1000));
  recordTtlShadowTick(this.db, summarizeTick(partition, Math.floor(started / 1000)), {
    minDays: POLY_MIN_MARKET_TTL_DAYS,
    maxDays: POLY_MAX_MARKET_TTL_DAYS,
  }, Math.floor(started / 1000));
} catch (e) {
  logger.warn({ err: String(e) }, 'recordTtlShadowTick failed');
}
```

Wrapped in try/catch so a shadow-write failure cannot break the trading-critical scan path. Same defensive pattern used by `recordScanRun` in this file.

### 3.4 Report script

`scripts/poly-ttl-shadow-report.ts` (NEW):

```
Usage: npx tsx scripts/poly-ttl-shadow-report.ts [--days N] [--band MIN MAX]
```

Reads `poly_ttl_shadow_ticks` over the last N days (default 14), aggregates:
- Total scan ticks observed.
- Mean candidates per tick: total vs TTL-pass.
- % of candidates that would be filtered (max + min split).
- Mean TTL of pass set vs filtered set.
- Naive "what-if" approval-rate uplift estimate: (current_approval_rate × candidates_ttl_pass / candidates_total) — read with caution because approval rate isn't uniform over TTL.
- Projected days-to-50-resolved at the new approval rate, assuming average resolution time of TTL-pass markets ≈ midpoint of band.

The script is read-only on the DB (`{ readonly: true }`). Output is human-readable; operator pastes into the Sprint S2 comparison report at `docs/research/sprint-s2-ttl-filter-comparison.md` on day 14.

### 3.5 Why a sibling script (not `--ttl-filter-shadow` flag)

The plan §6 said "add a `--ttl-filter-shadow` flag" to the existing strategy-compare CLI. On audit, that script's positional CLI is `<versionA> <versionB>` and its core function `compareStrategiesOnResolutions` does Brier-paired analysis on resolved trades. The TTL shadow report has no version-pairing concept and operates on tick-level data, not trade-level. Forcing both into one script muddies the Brier path and complicates testing. Ship as a sibling — same conventions, separate concern.

## 4. Definition of Done

- [ ] Migration v1.16.0 applied to live DB. `poly_ttl_shadow_ticks` table present.
- [ ] `src/poly/ttl-filter.ts` module landed with ≥10 unit tests covering: empty markets, all pass, all fail max, all fail min, mixed, exact-boundary, `nowSec` deterministic.
- [ ] Scanner writes one row per scan tick. `npm test` 813→820+ pass.
- [ ] Two new env vars in `src/config.ts`. `.env.example` updated if it tracks Polymarket vars (verify).
- [ ] `scripts/poly-ttl-shadow-report.ts` runs against live DB, prints a non-empty summary after at least one scan tick post-deploy.
- [ ] No edit to TRUST.md Tier-3 surfaces. No edit to existing risk gates or strategy. No mutation of the candidate list — shadow ONLY.
- [ ] Filter parameters are env-var driven; no recompile required to tune the band.
- [ ] Codex review trigger: yes — touches scanner code (strategy-adjacent). Run after ship.

## 5. Out of scope (not in S2)

- **Flag-flip from shadow to active.** That is Sprint S4, Tier-3, operator-only, gated on 14 days of shadow data showing positive lift.
- **Per-market TTL annotation on `poly_signals`.** Possible future work if the report needs per-signal TTL breakdown, but not required for the day-14 shadow comparison (tick-level stats are sufficient).
- **Touching `selectPriceCaptureCandidates`.** Tempting to add `maxTtrHours` symmetric to `minTtrHours` here, but in shadow mode the filter must NOT exclude markets from the live pipeline. Keep the partition externally; refactor into the selector only when the flag flips.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| TTL filter has zero candidates inside band on most ticks | medium | comparison report would show "no markets in band" → Path A doesn't help | shadow mode's explicit purpose is to detect this before flag-flip. Default 30-day max chosen because political/event markets dominate the long tail; weather/sports/crypto-resolution markets cluster in the <30-day band |
| Live shadow-write failure breaks scan tick | low | one missed scan, no trade impact | wrapped in try/catch; same defensive pattern as `recordScanRun` |
| Migration v1.16.0 collides with another in-flight schema change | low | migration retry / manual rollback | nothing else in flight per `migrations/version.json` HEAD = v1.15.0 |
| Operator forgets the flag-flip is still Tier-3 after 14 days | low | premature flag-flip without comparison | `.env.example` + commit message + plan §6 Sprint S4 explicitly call out the gate |

## 7. Ship target

Per plan §8: shadow ship by 2026-05-20, comparison report by 2026-06-03, active-flip authorization by 2026-06-05 (operator-only).

This sprint: shadow shipping today (2026-05-12), 8 days ahead of plan, because the existing-code audit revealed a small surface (one new module, one migration, one new script, one wire-in point in scanner). All discipline gates honored.
