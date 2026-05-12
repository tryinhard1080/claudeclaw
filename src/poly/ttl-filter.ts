import type Database from 'better-sqlite3';
import type { Market } from './types.js';

/**
 * Sprint S2 TTL filter (shadow mode).
 *
 * Pure functions partition the scanner's candidate set by time-to-resolution
 * (days). The live pipeline does NOT use the partition to exclude markets in
 * shadow mode — the partition is recorded so a 14-day comparison can answer
 * "what would the approval rate look like with this band active?" before
 * Sprint S4 (Tier-3 flag-flip).
 *
 * See docs/research/sprint-s2-ttl-filter-shadow.md.
 */

export interface TtlBand {
  /** Minimum days-to-resolution. Markets resolving sooner than this are filtered. */
  minDays: number;
  /** Maximum days-to-resolution. Markets resolving later than this are filtered. */
  maxDays: number;
}

export interface TtlPartition<T> {
  /** Markets inside [minDays, maxDays] band, inclusive. */
  pass: T[];
  /** Markets resolving in less than minDays. */
  filteredMin: T[];
  /** Markets resolving in more than maxDays. */
  filteredMax: T[];
}

export interface TtlTickStats {
  candidatesTotal: number;
  candidatesTtlPass: number;
  filteredMin: number;
  filteredMax: number;
  /** Mean TTL days of the pass set. null when the pass set is empty. */
  avgTtlPass: number | null;
  /** Mean TTL days across both filtered sets. null when both filtered sets are empty. */
  avgTtlFiltered: number | null;
}

/**
 * Compute days-to-resolution for a market. Returns negative numbers for
 * markets whose endDate is in the past (already-resolved), which the caller
 * may treat as filteredMin (resolves sooner than the band's lower bound).
 */
export function ttlDays(market: Market, nowSec: number): number {
  return (market.endDate - nowSec) / 86400;
}

/**
 * Partition markets into pass / filteredMin / filteredMax buckets relative
 * to the TTL band. Inclusive on both ends: a market resolving exactly at
 * minDays passes; one resolving exactly at maxDays passes. Pure function.
 */
export function partitionByTtl<M extends Market>(
  markets: M[],
  band: TtlBand,
  nowSec: number,
): TtlPartition<M> {
  const pass: M[] = [];
  const filteredMin: M[] = [];
  const filteredMax: M[] = [];
  for (const m of markets) {
    const d = ttlDays(m, nowSec);
    if (d < band.minDays) {
      filteredMin.push(m);
    } else if (d > band.maxDays) {
      filteredMax.push(m);
    } else {
      pass.push(m);
    }
  }
  return { pass, filteredMin, filteredMax };
}

function meanTtl(markets: Market[], nowSec: number): number | null {
  if (markets.length === 0) return null;
  let sum = 0;
  for (const m of markets) sum += ttlDays(m, nowSec);
  return sum / markets.length;
}

/**
 * Aggregate a partition into per-tick counts and average TTLs. avgTtlPass
 * is null when no markets pass; avgTtlFiltered is null when both filtered
 * buckets are empty (e.g. all candidates pass the band).
 */
export function summarizeTick(
  p: TtlPartition<Market>,
  nowSec: number,
): TtlTickStats {
  const candidatesTotal = p.pass.length + p.filteredMin.length + p.filteredMax.length;
  const filteredAll = p.filteredMin.length + p.filteredMax.length;
  return {
    candidatesTotal,
    candidatesTtlPass: p.pass.length,
    filteredMin: p.filteredMin.length,
    filteredMax: p.filteredMax.length,
    avgTtlPass: meanTtl(p.pass, nowSec),
    avgTtlFiltered: filteredAll === 0 ? null : meanTtl([...p.filteredMin, ...p.filteredMax], nowSec),
  };
}

/**
 * Persist a single tick's TTL shadow stats. Uses INSERT OR REPLACE on the
 * UNIQUE(scan_tick_at) constraint so a re-run with the same tick timestamp
 * is idempotent (rare; protects against double-fire during scanner-restart
 * windows). Caller wraps in try/catch — a shadow-write failure must not
 * break the trading-critical scan path.
 */
export function recordTtlShadowTick(
  db: Database.Database,
  stats: TtlTickStats,
  band: TtlBand,
  scanTickAtSec: number,
): void {
  ensureTable(db);
  db.prepare(`
    INSERT OR REPLACE INTO poly_ttl_shadow_ticks (
      scan_tick_at, candidates_total, candidates_ttl_pass,
      filtered_min, filtered_max, avg_ttl_pass, avg_ttl_filtered,
      band_min_days, band_max_days, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    scanTickAtSec,
    stats.candidatesTotal,
    stats.candidatesTtlPass,
    stats.filteredMin,
    stats.filteredMax,
    stats.avgTtlPass,
    stats.avgTtlFiltered,
    band.minDays,
    band.maxDays,
    Date.now(),
  );
}

/**
 * Idempotent table creation. Mirrors the pattern in `news-sync.ts` and
 * `strategy-engine.ts` that ensures the table exists when a fresh deploy
 * lands before the migrator runs.
 */
function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS poly_ttl_shadow_ticks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_tick_at        INTEGER NOT NULL,
      candidates_total    INTEGER NOT NULL,
      candidates_ttl_pass INTEGER NOT NULL,
      filtered_min        INTEGER NOT NULL,
      filtered_max        INTEGER NOT NULL,
      avg_ttl_pass        REAL,
      avg_ttl_filtered    REAL,
      band_min_days       REAL    NOT NULL,
      band_max_days       REAL    NOT NULL,
      created_at          INTEGER NOT NULL,
      UNIQUE(scan_tick_at)
    );
    CREATE INDEX IF NOT EXISTS idx_poly_ttl_shadow_ticks_at
      ON poly_ttl_shadow_ticks(scan_tick_at DESC);
  `);
}

export interface TtlShadowSummary {
  windowStartSec: number;
  windowEndSec: number;
  ticksObserved: number;
  meanCandidatesTotal: number;
  meanCandidatesTtlPass: number;
  meanFilteredMin: number;
  meanFilteredMax: number;
  /** Fraction of candidates that would pass the band, weighted by tick. */
  passRate: number;
  /** Mean of avgTtlPass across non-null tick rows. null if no tick had a pass set. */
  meanAvgTtlPass: number | null;
  /** Mean of avgTtlFiltered across non-null tick rows. */
  meanAvgTtlFiltered: number | null;
  /** Most-recent band snapshot in the window — surfaced so the report can flag
   *  if the operator changed env vars mid-window. */
  bandMinDaysLast: number;
  bandMaxDaysLast: number;
}

interface TickRow {
  scan_tick_at: number;
  candidates_total: number;
  candidates_ttl_pass: number;
  filtered_min: number;
  filtered_max: number;
  avg_ttl_pass: number | null;
  avg_ttl_filtered: number | null;
  band_min_days: number;
  band_max_days: number;
}

/**
 * Aggregate `poly_ttl_shadow_ticks` over a [startSec, endSec] window for the
 * Sprint S2 day-14 comparison report. Pure-ish: caller supplies the DB; this
 * does no I/O beyond the single SELECT.
 *
 * Returns null when the window contains zero ticks — caller should print a
 * "no shadow data yet" message rather than emit zeroes that look meaningful.
 */
export function summarizeTtlShadowWindow(
  db: Database.Database,
  startSec: number,
  endSec: number,
): TtlShadowSummary | null {
  const rows = db.prepare(`
    SELECT scan_tick_at, candidates_total, candidates_ttl_pass,
           filtered_min, filtered_max, avg_ttl_pass, avg_ttl_filtered,
           band_min_days, band_max_days
      FROM poly_ttl_shadow_ticks
     WHERE scan_tick_at >= ? AND scan_tick_at <= ?
     ORDER BY scan_tick_at ASC
  `).all(startSec, endSec) as TickRow[];

  if (rows.length === 0) return null;

  let sumTotal = 0, sumPass = 0, sumFMin = 0, sumFMax = 0;
  let sumAvgPass = 0, nAvgPass = 0;
  let sumAvgFiltered = 0, nAvgFiltered = 0;
  for (const r of rows) {
    sumTotal += r.candidates_total;
    sumPass += r.candidates_ttl_pass;
    sumFMin += r.filtered_min;
    sumFMax += r.filtered_max;
    if (r.avg_ttl_pass !== null) { sumAvgPass += r.avg_ttl_pass; nAvgPass += 1; }
    if (r.avg_ttl_filtered !== null) { sumAvgFiltered += r.avg_ttl_filtered; nAvgFiltered += 1; }
  }
  const last = rows[rows.length - 1]!;
  return {
    windowStartSec: startSec,
    windowEndSec: endSec,
    ticksObserved: rows.length,
    meanCandidatesTotal: sumTotal / rows.length,
    meanCandidatesTtlPass: sumPass / rows.length,
    meanFilteredMin: sumFMin / rows.length,
    meanFilteredMax: sumFMax / rows.length,
    passRate: sumTotal === 0 ? 0 : sumPass / sumTotal,
    meanAvgTtlPass: nAvgPass === 0 ? null : sumAvgPass / nAvgPass,
    meanAvgTtlFiltered: nAvgFiltered === 0 ? null : sumAvgFiltered / nAvgFiltered,
    bandMinDaysLast: last.band_min_days,
    bandMaxDaysLast: last.band_max_days,
  };
}
