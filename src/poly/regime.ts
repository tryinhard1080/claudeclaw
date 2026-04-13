import type Database from 'better-sqlite3';

/**
 * Macro regime classification. Three orthogonal axes (vol, crypto dominance,
 * rates) → 3-token tag. Thresholds are v1 defaults; they'll move once we
 * have 30+ days of resolved trades broken down by regime and can see
 * where category Brier diverges.
 */

export type VixLabel = 'calm' | 'norm' | 'stress' | 'unk';
export type BtcDomLabel = 'alt' | 'mix' | 'btc' | 'unk';
export type YieldLabel = 'low' | 'mid' | 'high' | 'unk';

function numOrUnk<T extends string>(v: number | null | undefined, fn: (n: number) => T): T | 'unk' {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'unk';
  return fn(v);
}

export function vixBucket(vix: number | null | undefined): VixLabel {
  return numOrUnk(vix, (n): VixLabel => n < 15 ? 'calm' : n < 25 ? 'norm' : 'stress');
}

export function btcDomBucket(dom: number | null | undefined): BtcDomLabel {
  return numOrUnk(dom, (n): BtcDomLabel => n < 45 ? 'alt' : n < 55 ? 'mix' : 'btc');
}

export function yieldBucket(y: number | null | undefined): YieldLabel {
  return numOrUnk(y, (n): YieldLabel => n < 3.5 ? 'low' : n < 5 ? 'mid' : 'high');
}

export interface RegimeInputs {
  vix: number | null;
  btcDominance: number | null;
  yield10y: number | null;
}

export function composeRegimeTag(i: RegimeInputs): string {
  return `v${vixBucket(i.vix)}_b${btcDomBucket(i.btcDominance)}_y${yieldBucket(i.yield10y)}`;
}

export interface RegimeSnapshot {
  createdAt: number;  // unix sec
  vix: number | null;
  btcDominance: number | null;
  yield10y: number | null;
  regimeLabel: string;
}

export function composeRegimeSnapshot(inputs: RegimeInputs, nowSec: number): RegimeSnapshot {
  return {
    createdAt: nowSec,
    vix: inputs.vix,
    btcDominance: inputs.btcDominance,
    yield10y: inputs.yield10y,
    regimeLabel: composeRegimeTag(inputs),
  };
}

export function persistRegimeSnapshot(db: Database.Database, s: RegimeSnapshot): number {
  const info = db.prepare(`
    INSERT INTO poly_regime_snapshots (created_at, vix, btc_dominance, yield_10y, regime_label)
    VALUES (?, ?, ?, ?, ?)
  `).run(s.createdAt, s.vix, s.btcDominance, s.yield10y, s.regimeLabel);
  return Number(info.lastInsertRowid);
}

interface RawRegimeRow {
  created_at: number;
  vix: number | null;
  btc_dominance: number | null;
  yield_10y: number | null;
  regime_label: string;
}

export function latestRegimeSnapshot(db: Database.Database): RegimeSnapshot | null {
  const row = db.prepare(`
    SELECT created_at, vix, btc_dominance, yield_10y, regime_label
      FROM poly_regime_snapshots
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `).get() as RawRegimeRow | undefined;
  if (!row) return null;
  return {
    createdAt: row.created_at,
    vix: row.vix,
    btcDominance: row.btc_dominance,
    yield10y: row.yield_10y,
    regimeLabel: row.regime_label,
  };
}

export interface ShouldRunArgs {
  refreshMinutes: number;
  lastRunAtSec: number | null;
  nowSec: number;
}

export function shouldRunRegimeSnapshot(a: ShouldRunArgs): boolean {
  if (a.lastRunAtSec === null) return true;
  return a.nowSec - a.lastRunAtSec >= a.refreshMinutes * 60;
}

// ── Upstream fetch ────────────────────────────────────────────────────

export type RegimeHttpFn = (url: string) => Promise<unknown>;

const VIX_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d';
const TNX_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d';
const CG_URL = 'https://api.coingecko.com/api/v3/global';

interface YahooChart {
  chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
}
interface CgGlobal {
  data?: { market_cap_percentage?: { btc?: number } };
}

/** Last non-null entry in a close-price array; null when the whole array is null/empty. */
function lastNonNull(arr: Array<number | null> | undefined): number | null {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

function extractYahooClose(raw: unknown): number | null {
  const r = raw as YahooChart;
  const close = r.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  return lastNonNull(close);
}

function extractBtcDom(raw: unknown): number | null {
  const g = raw as CgGlobal;
  const v = g.data?.market_cap_percentage?.btc;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function safeFetch<T>(http: RegimeHttpFn, url: string, parser: (raw: unknown) => T): Promise<T | null> {
  try {
    return parser(await http(url));
  } catch {
    return null;
  }
}

/**
 * Pull VIX, 10y yield, and BTC dominance from free public endpoints.
 * Each upstream is isolated — one failure does not block the others,
 * which means a regime snapshot is always composable (just with some
 * unk components) rather than throwing and skipping the tick entirely.
 *
 * Note: Yahoo's ^TNX close is already in percent units (e.g. 4.297 = 4.297%).
 * Earlier versions of this code divided by 10 based on an older Yahoo format;
 * live-fetch verification on 2026-04-13 confirmed current-format = percent.
 */
export async function fetchRegimeInputs(http: RegimeHttpFn): Promise<RegimeInputs> {
  const [vix, yield10y, btcDominance] = await Promise.all([
    safeFetch(http, VIX_URL, extractYahooClose),
    safeFetch(http, TNX_URL, extractYahooClose),
    safeFetch(http, CG_URL, extractBtcDom),
  ]);
  return { vix, btcDominance, yield10y };
}

/** Default real-network HTTP fn; tests inject their own. */
export async function defaultHttpJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'accept': 'application/json', 'user-agent': 'claudeclaw/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}
