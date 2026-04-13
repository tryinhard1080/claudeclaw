import type Database from 'better-sqlite3';

/**
 * Sprint 2 strategy comparison. Given two prompt versions that have both
 * evaluated a resolved market, compute paired Brier deltas and run a
 * paired t-test. Ships nothing automatically — output is advisory to the
 * operator or to future logic that decides when to adopt a new version.
 */

export interface PairedSample {
  probA: number;
  probB: number;
  outcome: 0 | 1;  // 1 = won, 0 = lost
}

export interface PairedTTestResult {
  n: number;
  meanDelta: number;
  t: number;
  pValue: number;   // two-tailed
}

export type Winner = 'A' | 'B' | 'tie';

export interface CompareResult {
  nPaired: number;
  brierA: number | null;   // mean Brier for version A on the overlap
  brierB: number | null;
  tTest: PairedTTestResult;
  winner: Winner;
  versionA: string;
  versionB: string;
}

/** Per-market (brierA - brierB). Positive = A worse (higher error). */
export function pairedBrierDeltas(samples: PairedSample[]): number[] {
  return samples.map(s => {
    const eA = (s.probA - s.outcome) ** 2;
    const eB = (s.probB - s.outcome) ** 2;
    return eA - eB;
  });
}

/**
 * Two-tailed paired t-test on the delta array.
 * t = mean / (stdev / sqrt(n)). Uses sample stdev (Bessel-corrected).
 * n < 2 or zero variance → pValue = 1 (can't reject null).
 * p-value computed via an incomplete-beta approximation of the t CDF —
 * good to ~0.001 precision for our sample sizes.
 */
export function pairedTTest(deltas: number[]): PairedTTestResult {
  const n = deltas.length;
  if (n === 0) return { n: 0, meanDelta: 0, t: 0, pValue: 1 };
  const mean = deltas.reduce((s, x) => s + x, 0) / n;
  if (n < 2) return { n, meanDelta: mean, t: 0, pValue: 1 };
  let ss = 0;
  for (const x of deltas) ss += (x - mean) ** 2;
  const variance = ss / (n - 1);
  if (variance === 0) return { n, meanDelta: mean, t: 0, pValue: 1 };
  const stderr = Math.sqrt(variance / n);
  const t = mean / stderr;
  const df = n - 1;
  const pValue = twoTailedPFromT(t, df);
  return { n, meanDelta: mean, t, pValue };
}

/**
 * Two-tailed p-value for t statistic on df degrees of freedom.
 * Uses the relationship p = I_x(df/2, 1/2) where x = df / (df + t²),
 * I_x being the regularized incomplete beta. Computed via a continued
 * fraction (Numerical Recipes §6.4). Accurate to ~1e-6 for our use.
 */
function twoTailedPFromT(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return 1;
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5);
}

/** Regularized incomplete beta I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
  // Use symmetry when x is closer to 1 — continued fraction converges faster on smaller x.
  if (x < (a + 1) / (a + b + 2)) {
    return front * betaContinuedFraction(x, a, b);
  }
  return 1 - Math.exp(Math.log(1 - x) * b + Math.log(x) * a - lnBeta) / b * betaContinuedFraction(1 - x, b, a);
}

/** Continued-fraction expansion for I_x(a, b). Lentz algorithm. */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIter = 200;
  const eps = 3e-7;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

/** Lanczos approximation of ln(Γ(z)), positive real z. */
function lnGamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  const zz = z - 1;
  let a = p[0]!;
  for (let i = 1; i < g + 2; i++) a += p[i]! / (zz + i);
  const tt = zz + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(tt) - tt + Math.log(a);
}

interface RawJoinRow {
  estimated_prob: number;
  status: string;
  prompt_version: string;
  market_slug: string;
  outcome_token_id: string;
}

/**
 * Join resolved trades with their signals, group by (slug, tokenId),
 * keep only markets where both versions have an entry. Computes the
 * comparison result. Voided trades excluded upstream.
 */
export function compareStrategies(
  db: Database.Database,
  versionA: string,
  versionB: string,
): CompareResult {
  const rows = db.prepare(`
    SELECT s.estimated_prob, t.status, s.prompt_version, t.market_slug, t.outcome_token_id
      FROM poly_paper_trades t
      INNER JOIN poly_signals s ON s.paper_trade_id = t.id
     WHERE t.status IN ('won','lost')
       AND t.resolved_at IS NOT NULL
       AND s.prompt_version IN (?, ?)
  `).all(versionA, versionB) as RawJoinRow[];

  // Bucket by (slug, tokenId) → { versionA: prob, versionB: prob, outcome }.
  // Key uses JSON.stringify of a tuple so slugs containing separator chars
  // can't collide with a different (slug, tokenId) pair.
  interface Bucket { a?: number; b?: number; outcome: 0 | 1 }
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const key = JSON.stringify([r.market_slug, r.outcome_token_id]);
    const outcome: 0 | 1 = r.status === 'won' ? 1 : 0;
    const bucket = buckets.get(key) ?? { outcome };
    if (r.prompt_version === versionA) bucket.a = r.estimated_prob;
    if (r.prompt_version === versionB) bucket.b = r.estimated_prob;
    // Same version on both sides (versionA === versionB) sets both a and b.
    if (versionA === versionB && r.prompt_version === versionA) {
      bucket.a = r.estimated_prob;
      bucket.b = r.estimated_prob;
    }
    buckets.set(key, bucket);
  }

  const paired: PairedSample[] = [];
  for (const b of buckets.values()) {
    if (b.a !== undefined && b.b !== undefined) {
      paired.push({ probA: b.a, probB: b.b, outcome: b.outcome });
    }
  }

  const nPaired = paired.length;
  if (nPaired === 0) {
    return {
      nPaired: 0, brierA: null, brierB: null,
      tTest: { n: 0, meanDelta: 0, t: 0, pValue: 1 },
      winner: 'tie', versionA, versionB,
    };
  }

  let sumA = 0;
  let sumB = 0;
  for (const s of paired) {
    sumA += (s.probA - s.outcome) ** 2;
    sumB += (s.probB - s.outcome) ** 2;
  }
  const brierA = sumA / nPaired;
  const brierB = sumB / nPaired;
  const deltas = pairedBrierDeltas(paired);
  const tTest = pairedTTest(deltas);

  const winner: Winner = tTest.pValue < 0.05
    ? (tTest.meanDelta > 0 ? 'B' : 'A')  // meanDelta > 0 ⇒ A worse ⇒ B wins
    : 'tie';

  return { nPaired, brierA, brierB, tTest, winner, versionA, versionB };
}
