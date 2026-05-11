import type Database from 'better-sqlite3';

/**
 * Sprint 27 — resolution-cache coverage helpers.
 *
 * The bot opens paper trades on Polymarket markets but the resolution-fetch
 * cron (scripts/fetch-resolutions.ts) historically pulled slugs from
 * poly_signals only. Audit 2026-05-11 found 20 of 31 lifetime trades had
 * no cache row. This module supplies:
 *
 *   - buildSlugPriorityQueue: open-trade slugs first, signal slugs after.
 *   - computeCoverage: ratio of open-trade slugs that have a cache row.
 *   - shouldAlarmCoverage: fires only after two consecutive sub-threshold
 *     measurements, matching the heartbeat-alarm shape in news-sync.ts.
 *   - load/saveCoverageHistory: poly_kv-backed history, capped at 5 entries.
 *   - formatCoverageLog / formatCoverageAlarm: stdout/stderr lines the
 *     scheduler-shell-runner forwards to Telegram.
 *
 * No new migration: poly_kv is created on demand by initPoly / StrategyEngine
 * with (key TEXT PRIMARY KEY, value TEXT NOT NULL). This module assumes the
 * table is already present; callers are responsible for ensuring it (the
 * cron script does so before invoking).
 */

export const COVERAGE_KEY = 'poly.coverage.history';
export const COVERAGE_HISTORY_MAX = 5;
export const COVERAGE_ALARM_THRESHOLD_PCT = 80;
export const COVERAGE_TARGET_PCT = 95;

export interface CoverageResult {
  totalOpenTrades: number;
  tradesWithCache: number;
  coveragePct: number;
}

export interface CoverageHistoryEntry {
  ts: number;
  pct: number;
}

interface SlugRow {
  market_slug: string;
}

interface CountRow {
  n: number;
}

interface KvRow {
  value: string;
}

export function buildSlugPriorityQueue(db: Database.Database): string[] {
  const openRows = db.prepare(
    `SELECT DISTINCT market_slug FROM poly_paper_trades WHERE status = 'open'`,
  ).all() as SlugRow[];
  const signalRows = db.prepare(
    `SELECT DISTINCT market_slug FROM poly_signals`,
  ).all() as SlugRow[];

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const r of openRows) {
    if (!seen.has(r.market_slug)) {
      seen.add(r.market_slug);
      ordered.push(r.market_slug);
    }
  }
  for (const r of signalRows) {
    if (!seen.has(r.market_slug)) {
      seen.add(r.market_slug);
      ordered.push(r.market_slug);
    }
  }
  return ordered;
}

export function computeCoverage(db: Database.Database): CoverageResult {
  const totalOpenTrades = (db.prepare(
    `SELECT COUNT(DISTINCT market_slug) AS n FROM poly_paper_trades WHERE status = 'open'`,
  ).get() as CountRow).n;

  if (totalOpenTrades === 0) {
    return { totalOpenTrades: 0, tradesWithCache: 0, coveragePct: 100 };
  }

  const tradesWithCache = (db.prepare(
    `SELECT COUNT(DISTINCT t.market_slug) AS n
       FROM poly_paper_trades t
       INNER JOIN poly_resolutions r ON r.slug = t.market_slug
      WHERE t.status = 'open'`,
  ).get() as CountRow).n;

  const coveragePct = (tradesWithCache / totalOpenTrades) * 100;
  return { totalOpenTrades, tradesWithCache, coveragePct };
}

export function shouldAlarmCoverage(history: CoverageHistoryEntry[]): boolean {
  if (history.length < 2) return false;
  const last2 = history.slice(-2);
  return last2.every(h => h.pct < COVERAGE_ALARM_THRESHOLD_PCT);
}

export function loadCoverageHistory(db: Database.Database): CoverageHistoryEntry[] {
  const row = db.prepare(`SELECT value FROM poly_kv WHERE key = ?`).get(COVERAGE_KEY) as
    | KvRow
    | undefined;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is CoverageHistoryEntry =>
      typeof e === 'object' && e !== null
      && typeof (e as { ts?: unknown }).ts === 'number'
      && typeof (e as { pct?: unknown }).pct === 'number',
    );
  } catch {
    return [];
  }
}

export function saveCoverageHistory(
  db: Database.Database,
  history: CoverageHistoryEntry[],
): void {
  const trimmed = history.slice(-COVERAGE_HISTORY_MAX);
  db.prepare(
    `INSERT INTO poly_kv(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(COVERAGE_KEY, JSON.stringify(trimmed));
}

function fmtPct(p: number): string {
  return `${p.toFixed(1)}%`;
}

export function formatCoverageLog(c: CoverageResult): string {
  return `[coverage] ${c.tradesWithCache}/${c.totalOpenTrades} open-trade slugs cached `
    + `(${fmtPct(c.coveragePct)}, target=${COVERAGE_TARGET_PCT}%)`;
}

export function formatCoverageAlarm(history: CoverageHistoryEntry[]): string {
  const last2 = history.slice(-2);
  const samples = last2.map(h => fmtPct(h.pct)).join(', ');
  return `[coverage-alarm] resolution-cache coverage <${COVERAGE_ALARM_THRESHOLD_PCT}% `
    + `for 2 consecutive cycles: ${samples}. Fetcher may be missing open-trade slugs.`;
}
