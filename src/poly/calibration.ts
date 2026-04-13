import type Database from 'better-sqlite3';
import { DateTime } from 'luxon';

/**
 * One resolved trade, reduced to what calibration math needs:
 *   estimatedProb: what the model said the probability was at signal time
 *   outcome:       1 if it actually resolved YES (won), 0 if NO (lost)
 * Voided trades are excluded — they tell us nothing about probability
 * calibration because there was never an outcome to measure against.
 */
export interface ResolvedSample {
  estimatedProb: number;
  outcome: 0 | 1;
}

/**
 * Brier score = mean squared error of (predicted prob − outcome).
 * 0 = perfect. 0.25 = random guess baseline. 1 = maximally wrong.
 */
export function brierScore(samples: ResolvedSample[]): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const s of samples) {
    const diff = s.estimatedProb - s.outcome;
    sum += diff * diff;
  }
  return sum / samples.length;
}

const LOG_LOSS_EPS = 1e-15;

/**
 * Binary log loss with EPS clamping so probabilities at {0,1} don't
 * produce -Infinity when the outcome contradicts. ln(2) ≈ 0.693 is
 * the uniform-50% baseline.
 */
export function logLoss(samples: ResolvedSample[]): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const s of samples) {
    const p = Math.min(Math.max(s.estimatedProb, LOG_LOSS_EPS), 1 - LOG_LOSS_EPS);
    sum += -(s.outcome * Math.log(p) + (1 - s.outcome) * Math.log(1 - p));
  }
  return sum / samples.length;
}

export interface CurveBucket {
  bucket: number;         // 0..9
  predLow: number;
  predHigh: number;
  count: number;
  actualWinRate: number | null;
}

/**
 * 10-bucket calibration curve. Each bucket holds predictions in
 * [predLow, predHigh) except the last which is inclusive of 1.0.
 * A perfectly calibrated model produces actualWinRate ≈ midpoint.
 */
export function calibrationCurve(samples: ResolvedSample[]): CurveBucket[] {
  const wins = new Array<number>(10).fill(0);
  const counts = new Array<number>(10).fill(0);
  for (const s of samples) {
    const p = Math.min(Math.max(s.estimatedProb, 0), 1);
    const idx = p === 1 ? 9 : Math.floor(p * 10);
    counts[idx]!++;
    if (s.outcome === 1) wins[idx]!++;
  }
  return Array.from({ length: 10 }, (_, i): CurveBucket => ({
    bucket: i,
    predLow: i / 10,
    predHigh: (i + 1) / 10,
    count: counts[i]!,
    actualWinRate: counts[i]! === 0 ? null : wins[i]! / counts[i]!,
  }));
}

interface RawRow {
  estimated_prob: number;
  status: string;
}

/**
 * Pull resolved samples from the DB joining signals and trades on
 * paper_trade_id. Voided trades excluded — the math only works on
 * actual won/lost outcomes.
 */
export function fetchResolvedSamples(
  db: Database.Database,
  windowStartSec: number,
  windowEndSec: number,
): ResolvedSample[] {
  const rows = db.prepare(`
    SELECT s.estimated_prob, t.status
      FROM poly_paper_trades t
      INNER JOIN poly_signals s ON s.paper_trade_id = t.id
     WHERE t.status IN ('won','lost')
       AND t.resolved_at IS NOT NULL
       AND t.resolved_at >= ?
       AND t.resolved_at <= ?
  `).all(windowStartSec, windowEndSec) as RawRow[];
  return rows.map(r => ({
    estimatedProb: r.estimated_prob,
    outcome: r.status === 'won' ? 1 : 0,
  }));
}

export interface CalibrationSnapshot {
  createdAt: number;       // unix sec
  windowStart: number;
  windowEnd: number;
  nSamples: number;
  brierScore: number | null;
  logLoss: number | null;
  winRate: number;
  curve: CurveBucket[];
}

/**
 * Build a snapshot over the last `lookbackDays`. Returns null when
 * no resolved samples exist in that window — there's nothing to
 * measure and persisting an empty snapshot would lie about progress.
 */
export function composeSnapshot(
  db: Database.Database,
  nowMs: number,
  lookbackDays: number,
): CalibrationSnapshot | null {
  const nowSec = Math.floor(nowMs / 1000);
  const windowStart = nowSec - lookbackDays * 86400;
  const samples = fetchResolvedSamples(db, windowStart, nowSec);
  if (samples.length === 0) return null;
  const wins = samples.filter(s => s.outcome === 1).length;
  return {
    createdAt: nowSec,
    windowStart,
    windowEnd: nowSec,
    nSamples: samples.length,
    brierScore: brierScore(samples),
    logLoss: logLoss(samples),
    winRate: wins / samples.length,
    curve: calibrationCurve(samples),
  };
}

export function persistSnapshot(db: Database.Database, snap: CalibrationSnapshot): number {
  const info = db.prepare(`
    INSERT INTO poly_calibration_snapshots
      (created_at, window_start, window_end, n_samples, brier_score, log_loss, win_rate, curve_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snap.createdAt, snap.windowStart, snap.windowEnd, snap.nSamples,
    snap.brierScore, snap.logLoss, snap.winRate, JSON.stringify(snap.curve),
  );
  return Number(info.lastInsertRowid);
}

export function latestSnapshot(db: Database.Database): CalibrationSnapshot | null {
  const row = db.prepare(`
    SELECT created_at, window_start, window_end, n_samples,
           brier_score, log_loss, win_rate, curve_json
      FROM poly_calibration_snapshots
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `).get() as {
    created_at: number; window_start: number; window_end: number;
    n_samples: number; brier_score: number | null; log_loss: number | null;
    win_rate: number; curve_json: string;
  } | undefined;
  if (!row) return null;
  return {
    createdAt: row.created_at,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    nSamples: row.n_samples,
    brierScore: row.brier_score,
    logLoss: row.log_loss,
    winRate: row.win_rate,
    curve: JSON.parse(row.curve_json) as CurveBucket[],
  };
}

export const MIN_ALERT_SAMPLES = 10;

export interface ShouldRunArgs {
  hour: number;
  timezone: string;
  now: Date;
  lastRunYmd: string | null;
}

export function shouldRunCalibration(a: ShouldRunArgs): boolean {
  const local = DateTime.fromJSDate(a.now).setZone(a.timezone);
  if (local.hour < a.hour) return false;
  const ymd = local.toFormat('yyyy-MM-dd');
  return a.lastRunYmd !== ymd;
}

export function todayYmd(now: Date, timezone: string): string {
  return DateTime.fromJSDate(now).setZone(timezone).toFormat('yyyy-MM-dd');
}

/**
 * Gate Telegram alert on (n >= MIN_ALERT_SAMPLES) AND (brier > threshold).
 * Returns null when no alert should fire. This keeps early-days noise
 * down when we have 2-3 resolved trades and Brier is meaninglessly
 * bouncing between extremes.
 */
export function formatCalibrationAlert(snap: CalibrationSnapshot, threshold: number): string | null {
  if (snap.nSamples < MIN_ALERT_SAMPLES) return null;
  if (snap.brierScore === null) return null;
  if (snap.brierScore <= threshold) return null;
  return [
    `⚠️ Calibration alarm`,
    `Brier: ${snap.brierScore.toFixed(3)} > threshold ${threshold.toFixed(3)}`,
    `Log loss: ${snap.logLoss?.toFixed(3) ?? 'n/a'}  Win rate: ${(snap.winRate * 100).toFixed(0)}%`,
    `n=${snap.nSamples} resolved (last ${Math.round((snap.windowEnd - snap.windowStart) / 86400)}d)`,
    `Run /poly calibration for the curve.`,
  ].join('\n');
}
