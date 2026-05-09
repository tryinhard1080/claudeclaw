#!/usr/bin/env tsx
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { STORE_DIR } from '../src/config.js';
import { classifyResolution } from '../src/poly/pnl-tracker.js';
import type { Market } from '../src/poly/types.js';
import {
  WEATHER_SHADOW_PROMPT_VERSION,
  parseWeatherMarket,
  resolveWeatherLocation,
} from '../src/poly/weather-shadow.js';

const PRIMARY_PROMPT_VERSION = 'v3';

export interface WeatherShadowMarketRow {
  slug: string;
  question: string;
  end_date: number;
}

export interface WeatherShadowSignalRow {
  created_at: number;
  market_slug: string;
  outcome_token_id: string;
  outcome_label: string;
  estimated_prob: number;
  prompt_version: string | null;
  paper_trade_id: number | null;
  rejection_reasons: string | null;
}

export interface WeatherShadowResolutionRow {
  slug: string;
  closed: number;
  outcomes_json: string;
}

export interface WeatherCityCoverage {
  city: string;
  total: number;
  supported: boolean;
  shadowRows: number;
}

export interface WeatherShadowReport {
  generatedAt: number;
  markets: {
    totalCandidates: number;
    parsedWeatherMarkets: number;
    supportedLocationCount: number;
    unsupportedParseCount: number;
    unsupportedLocationCount: number;
    byCity: WeatherCityCoverage[];
  };
  signals: {
    shadowRows: number;
    shadowPaperTradeLinks: number;
    latestShadowAgeMin: number | null;
  };
  resolved: {
    resolvedShadowRows: number;
    brierScore: number | null;
  };
  overlap: {
    primaryPromptVersion: string;
    primaryOverlapRows: number;
    resolvedPairedRows: number;
    meanAbsProbabilityDelta: number | null;
    shadowBrierScore: number | null;
    primaryBrierScore: number | null;
  };
  recommendation:
    | 'investigate_shadow_trade_link'
    | 'keep_shadow_only_collect_more_data'
    | 'expand_parser_before_promotion'
    | 'consider_promotion_review'
    | 'keep_shadow_only';
}

interface BuildWeatherShadowReportArgs {
  nowSec?: number;
  markets: WeatherShadowMarketRow[];
  signals: WeatherShadowSignalRow[];
  resolutions: WeatherShadowResolutionRow[];
  primaryPromptVersion?: string;
}

function isWeatherCandidate(market: WeatherShadowMarketRow): boolean {
  return /temperature|weather/i.test(`${market.slug} ${market.question}`);
}

function signalKey(row: Pick<WeatherShadowSignalRow, 'market_slug' | 'outcome_token_id'>): string {
  return JSON.stringify([row.market_slug, row.outcome_token_id]);
}

function latestByKey(rows: WeatherShadowSignalRow[]): Map<string, WeatherShadowSignalRow> {
  const byKey = new Map<string, WeatherShadowSignalRow>();
  for (const row of rows) {
    const key = signalKey(row);
    const prev = byKey.get(key);
    if (!prev || row.created_at >= prev.created_at) byKey.set(key, row);
  }
  return byKey;
}

function outcomeFor(row: WeatherShadowSignalRow, resolution: WeatherShadowResolutionRow | undefined): 0 | 1 | null {
  if (!resolution || resolution.closed !== 1) return null;
  let outcomes: Market['outcomes'];
  try {
    outcomes = JSON.parse(resolution.outcomes_json) as Market['outcomes'];
  } catch {
    return null;
  }
  if (!Array.isArray(outcomes)) return null;
  const syntheticMarket: Market = {
    slug: row.market_slug,
    conditionId: '',
    question: '',
    outcomes,
    volume24h: 0,
    liquidity: 0,
    endDate: 0,
    closed: true,
  };
  const cls = classifyResolution(syntheticMarket, row.outcome_token_id);
  if (cls.status === 'won') return 1;
  if (cls.status === 'lost') return 0;
  return null;
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function buildWeatherShadowReport(args: BuildWeatherShadowReportArgs): WeatherShadowReport {
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
  const primaryPromptVersion = args.primaryPromptVersion ?? PRIMARY_PROMPT_VERSION;
  const shadowRows = args.signals.filter(row => row.prompt_version === WEATHER_SHADOW_PROMPT_VERSION);
  const shadowRowsBySlug = new Map<string, number>();
  for (const row of shadowRows) {
    shadowRowsBySlug.set(row.market_slug, (shadowRowsBySlug.get(row.market_slug) ?? 0) + 1);
  }

  let totalCandidates = 0;
  let parsedWeatherMarkets = 0;
  let supportedLocationCount = 0;
  let unsupportedParseCount = 0;
  let unsupportedLocationCount = 0;
  const byCityMap = new Map<string, WeatherCityCoverage>();

  for (const market of args.markets) {
    if (!isWeatherCandidate(market)) continue;
    totalCandidates++;
    const parsed = parseWeatherMarket({
      slug: market.slug,
      question: market.question,
      endDate: market.end_date,
    });
    if (!parsed) {
      unsupportedParseCount++;
      continue;
    }

    parsedWeatherMarkets++;
    const supported = resolveWeatherLocation(parsed.city) !== null;
    if (supported) supportedLocationCount++;
    else unsupportedLocationCount++;

    const existing = byCityMap.get(parsed.city) ?? {
      city: parsed.city,
      total: 0,
      supported,
      shadowRows: 0,
    };
    existing.total++;
    existing.supported = existing.supported || supported;
    existing.shadowRows += shadowRowsBySlug.get(market.slug) ?? 0;
    byCityMap.set(parsed.city, existing);
  }

  const resolutionsBySlug = new Map(args.resolutions.map(row => [row.slug, row]));
  const resolvedErrors: number[] = [];
  for (const row of shadowRows) {
    const outcome = outcomeFor(row, resolutionsBySlug.get(row.market_slug));
    if (outcome === null) continue;
    resolvedErrors.push((row.estimated_prob - outcome) ** 2);
  }

  const shadowByKey = latestByKey(shadowRows);
  const primaryRows = args.signals.filter(row => row.prompt_version === primaryPromptVersion);
  const primaryByKey = latestByKey(primaryRows);
  let primaryOverlapRows = 0;
  let resolvedPairedRows = 0;
  const probabilityDeltas: number[] = [];
  const pairedShadowErrors: number[] = [];
  const pairedPrimaryErrors: number[] = [];

  for (const [key, shadow] of shadowByKey.entries()) {
    const primary = primaryByKey.get(key);
    if (!primary) continue;
    primaryOverlapRows++;
    probabilityDeltas.push(Math.abs(shadow.estimated_prob - primary.estimated_prob));
    const outcome = outcomeFor(shadow, resolutionsBySlug.get(shadow.market_slug));
    if (outcome === null) continue;
    resolvedPairedRows++;
    pairedShadowErrors.push((shadow.estimated_prob - outcome) ** 2);
    pairedPrimaryErrors.push((primary.estimated_prob - outcome) ** 2);
  }

  const latestShadow = shadowRows.length > 0
    ? Math.max(...shadowRows.map(row => row.created_at))
    : null;

  const shadowPaperTradeLinks = shadowRows.filter(row => row.paper_trade_id !== null && row.paper_trade_id !== undefined).length;
  const brierScore = mean(resolvedErrors);
  const pairedPrimaryBrier = mean(pairedPrimaryErrors);
  let recommendation: WeatherShadowReport['recommendation'];
  if (shadowPaperTradeLinks > 0) {
    recommendation = 'investigate_shadow_trade_link';
  } else if (shadowRows.length < 50 || resolvedErrors.length < 10) {
    recommendation = 'keep_shadow_only_collect_more_data';
  } else if (unsupportedParseCount + unsupportedLocationCount > 0) {
    recommendation = 'expand_parser_before_promotion';
  } else if (brierScore !== null && (pairedPrimaryBrier === null || brierScore <= pairedPrimaryBrier)) {
    recommendation = 'consider_promotion_review';
  } else {
    recommendation = 'keep_shadow_only';
  }

  return {
    generatedAt: nowSec,
    markets: {
      totalCandidates,
      parsedWeatherMarkets,
      supportedLocationCount,
      unsupportedParseCount,
      unsupportedLocationCount,
      byCity: [...byCityMap.values()].sort((a, b) => a.city.localeCompare(b.city)),
    },
    signals: {
      shadowRows: shadowRows.length,
      shadowPaperTradeLinks,
      latestShadowAgeMin: latestShadow === null ? null : Math.max(0, Math.round((nowSec - latestShadow) / 60)),
    },
    resolved: {
      resolvedShadowRows: resolvedErrors.length,
      brierScore,
    },
    overlap: {
      primaryPromptVersion,
      primaryOverlapRows,
      resolvedPairedRows,
      meanAbsProbabilityDelta: mean(probabilityDeltas),
      shadowBrierScore: mean(pairedShadowErrors),
      primaryBrierScore: pairedPrimaryBrier,
    },
    recommendation,
  };
}

function fmtNullable(n: number | null, digits = 3): string {
  return n === null ? 'n/a' : n.toFixed(digits);
}

export function formatWeatherShadowReport(report: WeatherShadowReport): string {
  const lines = [
    'Weather Goat Shadow Report',
    '--------------------------',
    `Generated at: ${new Date(report.generatedAt * 1000).toISOString()}`,
    `Weather candidates: ${report.markets.totalCandidates}`,
    `Parsed weather markets: ${report.markets.parsedWeatherMarkets}`,
    `Supported locations: ${report.markets.supportedLocationCount}`,
    `Unsupported parse/location: ${report.markets.unsupportedParseCount}/${report.markets.unsupportedLocationCount}`,
    `Shadow rows: ${report.signals.shadowRows}`,
    `Shadow rows with paper_trade_id: ${report.signals.shadowPaperTradeLinks}`,
    `Latest shadow age: ${report.signals.latestShadowAgeMin === null ? 'n/a' : `${report.signals.latestShadowAgeMin}m`}`,
    `Resolved shadow rows: ${report.resolved.resolvedShadowRows}`,
    `Weather shadow Brier: ${fmtNullable(report.resolved.brierScore)}`,
    `Primary overlap rows: ${report.overlap.primaryOverlapRows} (${report.overlap.primaryPromptVersion})`,
    `Resolved paired rows: ${report.overlap.resolvedPairedRows}`,
    `Paired Brier weather/primary: ${fmtNullable(report.overlap.shadowBrierScore)} / ${fmtNullable(report.overlap.primaryBrierScore)}`,
    `Mean abs probability delta: ${fmtNullable(report.overlap.meanAbsProbabilityDelta)}`,
    `Recommendation: ${report.recommendation}`,
  ];

  if (report.markets.byCity.length > 0) {
    lines.push('', 'Coverage by city:');
    for (const city of report.markets.byCity) {
      lines.push(`- ${city.city}: markets=${city.total} supported=${city.supported ? 'yes' : 'no'} shadow_rows=${city.shadowRows}`);
    }
  }

  return lines.join('\n');
}

function loadReport(db: Database.Database): WeatherShadowReport {
  const markets = db.prepare(`
    SELECT slug, question, end_date
      FROM poly_markets
     ORDER BY last_scan_at DESC
  `).all() as WeatherShadowMarketRow[];

  const signals = db.prepare(`
    SELECT created_at, market_slug, outcome_token_id, outcome_label,
           estimated_prob, prompt_version, paper_trade_id, rejection_reasons
      FROM poly_signals
     WHERE prompt_version IN (?, ?)
        OR rejection_reasons = 'shadow:weather'
  `).all(WEATHER_SHADOW_PROMPT_VERSION, PRIMARY_PROMPT_VERSION) as WeatherShadowSignalRow[];

  const resolutions = db.prepare(`
    SELECT slug, closed, outcomes_json
      FROM poly_resolutions
  `).all() as WeatherShadowResolutionRow[];

  return buildWeatherShadowReport({ markets, signals, resolutions });
}

function main(): void {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    console.log(formatWeatherShadowReport(loadReport(db)));
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
