import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  ttlDays,
  partitionByTtl,
  summarizeTick,
  recordTtlShadowTick,
  summarizeTtlShadowWindow,
} from './ttl-filter.js';
import type { Market } from './types.js';

const DAY = 86400;
const NOW = 1_780_000_000; // 2026-05-29 16:26:40 UTC, fixed for determinism

function mkMarket(slug: string, ttlDays: number, nowSec = NOW): Market {
  return {
    slug,
    conditionId: `cond-${slug}`,
    question: `q-${slug}`,
    outcomes: [
      { label: 'Yes', tokenId: `tok-yes-${slug}`, price: 0.5 },
      { label: 'No', tokenId: `tok-no-${slug}`, price: 0.5 },
    ],
    volume24h: 50_000,
    liquidity: 25_000,
    endDate: nowSec + Math.round(ttlDays * DAY),
    closed: false,
  };
}

describe('ttlDays', () => {
  it('returns positive days for future endDate', () => {
    const m = mkMarket('a', 10);
    expect(ttlDays(m, NOW)).toBeCloseTo(10, 6);
  });

  it('returns 0 for endDate at exactly now', () => {
    const m: Market = { ...mkMarket('b', 0), endDate: NOW };
    expect(ttlDays(m, NOW)).toBe(0);
  });

  it('returns negative days for past endDate (already-resolved markets)', () => {
    const m = mkMarket('past', -3);
    expect(ttlDays(m, NOW)).toBeCloseTo(-3, 6);
  });
});

describe('partitionByTtl', () => {
  it('returns three empty buckets for empty input', () => {
    const p = partitionByTtl([], { minDays: 1, maxDays: 30 }, NOW);
    expect(p.pass).toHaveLength(0);
    expect(p.filteredMin).toHaveLength(0);
    expect(p.filteredMax).toHaveLength(0);
  });

  it('places markets correctly by TTL', () => {
    const markets = [
      mkMarket('soon', 0.5),       // < 1 day → filteredMin
      mkMarket('inside-low', 1),    // exactly 1 day → pass (inclusive)
      mkMarket('inside-mid', 15),   // → pass
      mkMarket('inside-high', 30),  // exactly 30 days → pass (inclusive)
      mkMarket('long', 60),         // > 30 days → filteredMax
      mkMarket('political', 365),   // → filteredMax
    ];
    const p = partitionByTtl(markets, { minDays: 1, maxDays: 30 }, NOW);
    expect(p.pass.map(m => m.slug)).toEqual(['inside-low', 'inside-mid', 'inside-high']);
    expect(p.filteredMin.map(m => m.slug)).toEqual(['soon']);
    expect(p.filteredMax.map(m => m.slug)).toEqual(['long', 'political']);
  });

  it('treats already-resolved markets as filteredMin', () => {
    const p = partitionByTtl([mkMarket('past', -1)], { minDays: 1, maxDays: 30 }, NOW);
    expect(p.filteredMin).toHaveLength(1);
    expect(p.pass).toHaveLength(0);
  });

  it('all-pass when band is wide', () => {
    const markets = [mkMarket('a', 5), mkMarket('b', 50), mkMarket('c', 500)];
    const p = partitionByTtl(markets, { minDays: 0, maxDays: 1000 }, NOW);
    expect(p.pass).toHaveLength(3);
    expect(p.filteredMin).toHaveLength(0);
    expect(p.filteredMax).toHaveLength(0);
  });

  it('all-filtered when band excludes everything', () => {
    const markets = [mkMarket('a', 5), mkMarket('b', 50)];
    const p = partitionByTtl(markets, { minDays: 100, maxDays: 200 }, NOW);
    expect(p.pass).toHaveLength(0);
    expect(p.filteredMin).toHaveLength(2);
  });

  it('preserves input order within each bucket', () => {
    const markets = [
      mkMarket('a-pass', 5),
      mkMarket('b-fail', 100),
      mkMarket('c-pass', 10),
    ];
    const p = partitionByTtl(markets, { minDays: 1, maxDays: 30 }, NOW);
    expect(p.pass.map(m => m.slug)).toEqual(['a-pass', 'c-pass']);
    expect(p.filteredMax.map(m => m.slug)).toEqual(['b-fail']);
  });
});

describe('summarizeTick', () => {
  it('returns nulls for both averages when input empty', () => {
    const stats = summarizeTick({ pass: [], filteredMin: [], filteredMax: [] }, NOW);
    expect(stats.candidatesTotal).toBe(0);
    expect(stats.avgTtlPass).toBeNull();
    expect(stats.avgTtlFiltered).toBeNull();
  });

  it('avgTtlPass null when pass is empty but filtered is not', () => {
    const p = partitionByTtl([mkMarket('long', 100)], { minDays: 1, maxDays: 30 }, NOW);
    const stats = summarizeTick(p, NOW);
    expect(stats.avgTtlPass).toBeNull();
    expect(stats.avgTtlFiltered).toBeCloseTo(100, 5);
  });

  it('avgTtlFiltered null when nothing was filtered', () => {
    const p = partitionByTtl([mkMarket('a', 5), mkMarket('b', 10)], { minDays: 1, maxDays: 30 }, NOW);
    const stats = summarizeTick(p, NOW);
    expect(stats.avgTtlPass).toBeCloseTo(7.5, 5);
    expect(stats.avgTtlFiltered).toBeNull();
  });

  it('combines filteredMin and filteredMax for the filtered average', () => {
    const markets = [
      mkMarket('soon', 0.5),     // filteredMin
      mkMarket('long', 100),     // filteredMax
      mkMarket('mid', 15),       // pass
    ];
    const p = partitionByTtl(markets, { minDays: 1, maxDays: 30 }, NOW);
    const stats = summarizeTick(p, NOW);
    expect(stats.candidatesTotal).toBe(3);
    expect(stats.candidatesTtlPass).toBe(1);
    expect(stats.filteredMin).toBe(1);
    expect(stats.filteredMax).toBe(1);
    expect(stats.avgTtlPass).toBeCloseTo(15, 5);
    expect(stats.avgTtlFiltered).toBeCloseTo((0.5 + 100) / 2, 5);
  });
});

describe('recordTtlShadowTick + summarizeTtlShadowWindow', () => {
  function makeDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    return db;
  }

  it('writes a row that summarizes back to the same stats', () => {
    const db = makeDb();
    const markets = [mkMarket('a', 15), mkMarket('long', 100), mkMarket('soon', 0.5)];
    const p = partitionByTtl(markets, { minDays: 1, maxDays: 30 }, NOW);
    const stats = summarizeTick(p, NOW);
    recordTtlShadowTick(db, stats, { minDays: 1, maxDays: 30 }, NOW);

    const summary = summarizeTtlShadowWindow(db, NOW - 60, NOW + 60);
    expect(summary).not.toBeNull();
    expect(summary!.ticksObserved).toBe(1);
    expect(summary!.meanCandidatesTotal).toBe(3);
    expect(summary!.meanCandidatesTtlPass).toBe(1);
    expect(summary!.passRate).toBeCloseTo(1 / 3, 5);
    expect(summary!.bandMinDaysLast).toBe(1);
    expect(summary!.bandMaxDaysLast).toBe(30);
    db.close();
  });

  // [hotfix 2026-05-12] codex P2: created_at must be unix seconds, not ms.
  it('persists created_at in unix seconds (not milliseconds)', () => {
    const db = makeDb();
    const stats = summarizeTick({ pass: [], filteredMin: [], filteredMax: [] }, NOW);
    const before = Math.floor(Date.now() / 1000);
    recordTtlShadowTick(db, stats, { minDays: 1, maxDays: 30 }, NOW);
    const after = Math.floor(Date.now() / 1000);
    const row = db.prepare(`SELECT created_at FROM poly_ttl_shadow_ticks WHERE scan_tick_at = ?`).get(NOW) as { created_at: number };
    expect(row.created_at).toBeGreaterThanOrEqual(before);
    expect(row.created_at).toBeLessThanOrEqual(after);
    // Sanity: must be in unix-seconds range (~1.78e9 in 2026), not ms (~1.78e12).
    expect(row.created_at).toBeLessThan(1e11);
    db.close();
  });

  it('INSERT OR REPLACE makes same-tick re-write idempotent', () => {
    const db = makeDb();
    const stats = { candidatesTotal: 5, candidatesTtlPass: 2, filteredMin: 1, filteredMax: 2, avgTtlPass: 10, avgTtlFiltered: 50 };
    recordTtlShadowTick(db, stats, { minDays: 1, maxDays: 30 }, NOW);
    // Re-write with different stats at same scan_tick_at — should overwrite.
    const stats2 = { candidatesTotal: 7, candidatesTtlPass: 3, filteredMin: 2, filteredMax: 2, avgTtlPass: 12, avgTtlFiltered: 60 };
    recordTtlShadowTick(db, stats2, { minDays: 1, maxDays: 30 }, NOW);
    const rows = db.prepare(`SELECT candidates_total FROM poly_ttl_shadow_ticks WHERE scan_tick_at = ?`).all(NOW) as Array<{ candidates_total: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.candidates_total).toBe(7);
    db.close();
  });

  it('summarizeTtlShadowWindow returns null when window has no ticks', () => {
    const db = makeDb();
    const stats = summarizeTick({ pass: [], filteredMin: [], filteredMax: [] }, NOW);
    recordTtlShadowTick(db, stats, { minDays: 1, maxDays: 30 }, NOW);
    const summary = summarizeTtlShadowWindow(db, NOW + 1000, NOW + 2000);
    expect(summary).toBeNull();
    db.close();
  });

  it('aggregates multiple ticks across a window', () => {
    const db = makeDb();
    for (let i = 0; i < 5; i++) {
      const stats = {
        candidatesTotal: 20, candidatesTtlPass: 4 + i, filteredMin: 1, filteredMax: 15 - i,
        avgTtlPass: 15, avgTtlFiltered: 90,
      };
      recordTtlShadowTick(db, stats, { minDays: 1, maxDays: 30 }, NOW + i * 60);
    }
    const summary = summarizeTtlShadowWindow(db, NOW, NOW + 5 * 60);
    expect(summary!.ticksObserved).toBe(5);
    expect(summary!.meanCandidatesTotal).toBe(20);
    expect(summary!.meanCandidatesTtlPass).toBeCloseTo((4 + 5 + 6 + 7 + 8) / 5, 5);
    expect(summary!.passRate).toBeCloseTo((4 + 5 + 6 + 7 + 8) / (20 * 5), 5);
    expect(summary!.meanAvgTtlPass).toBeCloseTo(15, 5);
    expect(summary!.meanAvgTtlFiltered).toBeCloseTo(90, 5);
    db.close();
  });

  it('handles ticks where avg_ttl_pass is null (no markets pass)', () => {
    const db = makeDb();
    const stats = {
      candidatesTotal: 5, candidatesTtlPass: 0, filteredMin: 2, filteredMax: 3,
      avgTtlPass: null, avgTtlFiltered: 75,
    };
    recordTtlShadowTick(db, stats, { minDays: 100, maxDays: 200 }, NOW);
    const summary = summarizeTtlShadowWindow(db, NOW - 60, NOW + 60);
    expect(summary!.meanAvgTtlPass).toBeNull();
    expect(summary!.meanAvgTtlFiltered).toBeCloseTo(75, 5);
    expect(summary!.passRate).toBe(0);
    db.close();
  });
});
