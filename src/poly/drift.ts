import type Database from 'better-sqlite3';

/**
 * Sprint 1.5 — drift dashboards.
 *
 * Silent degradation typically shows up first in operational signals
 * (latency, market-count, rejection mix) before Brier catches it. This
 * module pulls those signals from poly_scan_runs + poly_signals and
 * renders them for /poly drift and future alarm hooks.
 */

export interface ScanRun {
  id: number;
  started_at: number;
  duration_ms: number | null;
  market_count: number | null;
  status: string;
  error: string | null;
}

export interface RecordScanArgs {
  startedAt: number;       // unix sec
  durationMs: number | null;
  marketCount: number | null;
  status: 'ok' | 'error';
  error?: string | null;
}

export function recordScanRun(db: Database.Database, a: RecordScanArgs): number {
  const info = db.prepare(`
    INSERT INTO poly_scan_runs (started_at, duration_ms, market_count, status, error)
    VALUES (?, ?, ?, ?, ?)
  `).run(a.startedAt, a.durationMs, a.marketCount, a.status, a.error ?? null);
  return Number(info.lastInsertRowid);
}

/**
 * Linear-interpolation percentile. Returns null on empty input so
 * callers can distinguish "no data" from "0 ms".
 */
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0]!;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

export interface LatencyStats {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  mean: number | null;
  count: number;
  errorCount: number;
}

export function latencyStats(db: Database.Database, nowSec: number, windowSec: number): LatencyStats {
  const since = nowSec - windowSec;
  const rows = db.prepare(`
    SELECT duration_ms, status FROM poly_scan_runs WHERE started_at >= ?
  `).all(since) as Array<{ duration_ms: number | null; status: string }>;
  const ok = rows.filter(r => r.status === 'ok' && r.duration_ms !== null).map(r => r.duration_ms!);
  const errorCount = rows.filter(r => r.status !== 'ok').length;
  if (ok.length === 0) return { p50: null, p95: null, p99: null, mean: null, count: 0, errorCount };
  const mean = ok.reduce((a, b) => a + b, 0) / ok.length;
  return {
    p50: percentile(ok, 0.5),
    p95: percentile(ok, 0.95),
    p99: percentile(ok, 0.99),
    mean,
    count: ok.length,
    errorCount,
  };
}

/**
 * Tally rejections by gate. Signals with approved=1 contribute nothing;
 * rejection_reasons JSON is `[{gate, reason}, ...]`.
 */
export function rejectionMix(db: Database.Database, fromSec: number, toSec: number): Map<string, number> {
  const rows = db.prepare(`
    SELECT rejection_reasons FROM poly_signals
     WHERE approved = 0
       AND rejection_reasons IS NOT NULL
       AND created_at >= ? AND created_at <= ?
  `).all(fromSec, toSec) as Array<{ rejection_reasons: string }>;
  const mix = new Map<string, number>();
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.rejection_reasons) as Array<{ gate?: string }>;
      for (const p of parsed) {
        if (typeof p.gate === 'string') {
          mix.set(p.gate, (mix.get(p.gate) ?? 0) + 1);
        }
      }
    } catch { /* malformed JSON — skip */ }
  }
  return mix;
}

export interface MarketCountTrend {
  latest: number | null;
  rollingAvg: number | null;
  deltaPct: number | null;
}

/**
 * Rolling avg EXCLUDES the latest row so the comparison is "latest vs
 * recent baseline" not "latest vs (latest-biased) avg". Useful for
 * detecting sudden drops (upstream Gamma truncation, rate-limit).
 */
export function marketCountTrend(db: Database.Database, nowSec: number, windowSec: number): MarketCountTrend {
  const rows = db.prepare(`
    SELECT market_count FROM poly_scan_runs
     WHERE status='ok' AND market_count IS NOT NULL AND started_at >= ?
     ORDER BY started_at DESC
  `).all(nowSec - windowSec) as Array<{ market_count: number }>;
  if (rows.length === 0) return { latest: null, rollingAvg: null, deltaPct: null };
  const latest = rows[0]!.market_count;
  const baseline = rows.slice(1);
  const avg = baseline.length > 0
    ? baseline.reduce((a, b) => a + b.market_count, 0) / baseline.length
    : null;
  const delta = avg !== null && avg > 0 ? ((latest - avg) / avg) * 100 : null;
  return { latest, rollingAvg: avg, deltaPct: delta };
}

export interface DriftReport {
  windowHours: number;
  latency: LatencyStats;
  rejection: Map<string, number>;
  marketCount: MarketCountTrend;
}

export function composeDriftReport(db: Database.Database, nowSec: number, windowHours = 24): DriftReport {
  const windowSec = windowHours * 3600;
  return {
    windowHours,
    latency: latencyStats(db, nowSec, windowSec),
    rejection: rejectionMix(db, nowSec - windowSec, nowSec),
    marketCount: marketCountTrend(db, nowSec, windowSec),
  };
}

export function formatDriftReport(r: DriftReport): string {
  const lines: string[] = [`Drift (last ${r.windowHours}h):`];
  const l = r.latency;
  if (l.count > 0) {
    lines.push(
      `Scan latency: p50=${l.p50}ms p95=${l.p95}ms p99=${l.p99}ms mean=${l.mean?.toFixed(0)}ms (n=${l.count}, errors=${l.errorCount})`,
    );
  } else {
    lines.push(`Scan latency: no data (errors=${l.errorCount})`);
  }
  const mc = r.marketCount;
  if (mc.latest !== null) {
    const delta = mc.deltaPct !== null ? ` (${mc.deltaPct >= 0 ? '+' : ''}${mc.deltaPct.toFixed(1)}% vs avg ${mc.rollingAvg?.toFixed(0)})` : '';
    lines.push(`Latest market count: ${mc.latest}${delta}`);
  } else {
    lines.push('Latest market count: n/a');
  }
  const rej = [...r.rejection.entries()].sort((a, b) => b[1] - a[1]);
  if (rej.length > 0) {
    const total = rej.reduce((s, [, n]) => s + n, 0);
    lines.push('Rejection mix:');
    for (const [gate, n] of rej.slice(0, 5)) {
      const pct = (n / total) * 100;
      lines.push(`  ${gate}: ${n} (${pct.toFixed(0)}%)`);
    }
  } else {
    lines.push('Rejection mix: no rejections in window');
  }
  return lines.join('\n');
}
