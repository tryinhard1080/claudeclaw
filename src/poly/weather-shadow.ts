import { spawn } from 'child_process';
import type { Market, ProbabilityEstimate } from './types.js';

export const WEATHER_SHADOW_PROMPT_VERSION = 'v3-weather-shadow';
export const WEATHER_SHADOW_MODEL = 'weather-goat-pp-cli';
export const WEATHER_SHADOW_PROVIDER = 'weather-goat';

export type WeatherUnit = 'fahrenheit' | 'celsius';
export type WeatherOperator = 'gte' | 'lte' | 'exact' | 'between';

export interface WeatherMarketSpec {
  kind: 'high_temp';
  city: string;
  dateYmd: string;
  unit: WeatherUnit;
  operator: WeatherOperator;
  threshold?: number;
  low?: number;
  high?: number;
}

export interface WeatherLocation {
  latitude: number;
  longitude: number;
}

export type WeatherGoatRunner = (args: string[]) => Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}>;

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const LOCATIONS: Record<string, WeatherLocation> = {
  amsterdam: { latitude: 52.3676, longitude: 4.9041 },
  ankara: { latitude: 39.9334, longitude: 32.8597 },
  atlanta: { latitude: 33.749, longitude: -84.388 },
  austin: { latitude: 30.2672, longitude: -97.7431 },
  beijing: { latitude: 39.9042, longitude: 116.4074 },
  boston: { latitude: 42.3601, longitude: -71.0589 },
  'buenos aires': { latitude: -34.6037, longitude: -58.3816 },
  busan: { latitude: 35.1796, longitude: 129.0756 },
  'cape town': { latitude: -33.9249, longitude: 18.4241 },
  chengdu: { latitude: 30.5728, longitude: 104.0668 },
  chicago: { latitude: 41.8781, longitude: -87.6298 },
  chongqing: { latitude: 29.563, longitude: 106.5516 },
  dallas: { latitude: 32.7767, longitude: -96.797 },
  denver: { latitude: 39.7392, longitude: -104.9903 },
  guangzhou: { latitude: 23.1291, longitude: 113.2644 },
  helsinki: { latitude: 60.1699, longitude: 24.9384 },
  'hong kong': { latitude: 22.3193, longitude: 114.1694 },
  houston: { latitude: 29.7604, longitude: -95.3698 },
  istanbul: { latitude: 41.0082, longitude: 28.9784 },
  jakarta: { latitude: -6.2088, longitude: 106.8456 },
  jeddah: { latitude: 21.4858, longitude: 39.1925 },
  karachi: { latitude: 24.8607, longitude: 67.0011 },
  'kuala lumpur': { latitude: 3.139, longitude: 101.6869 },
  lagos: { latitude: 6.5244, longitude: 3.3792 },
  london: { latitude: 51.5072, longitude: -0.1276 },
  'los angeles': { latitude: 34.0522, longitude: -118.2437 },
  lucknow: { latitude: 26.8467, longitude: 80.9462 },
  madrid: { latitude: 40.4168, longitude: -3.7038 },
  manila: { latitude: 14.5995, longitude: 120.9842 },
  'mexico city': { latitude: 19.4326, longitude: -99.1332 },
  miami: { latitude: 25.7617, longitude: -80.1918 },
  milan: { latitude: 45.4642, longitude: 9.19 },
  moscow: { latitude: 55.7558, longitude: 37.6173 },
  munich: { latitude: 48.1351, longitude: 11.582 },
  'new york': { latitude: 40.7128, longitude: -74.006 },
  'new york city': { latitude: 40.7128, longitude: -74.006 },
  'panama city': { latitude: 8.9824, longitude: -79.5199 },
  paris: { latitude: 48.8566, longitude: 2.3522 },
  philadelphia: { latitude: 39.9526, longitude: -75.1652 },
  phoenix: { latitude: 33.4484, longitude: -112.074 },
  qingdao: { latitude: 36.0671, longitude: 120.3826 },
  'san francisco': { latitude: 37.7749, longitude: -122.4194 },
  'sao paulo': { latitude: -23.5558, longitude: -46.6396 },
  seattle: { latitude: 47.6062, longitude: -122.3321 },
  seoul: { latitude: 37.5665, longitude: 126.978 },
  shanghai: { latitude: 31.2304, longitude: 121.4737 },
  shenzhen: { latitude: 22.5431, longitude: 114.0579 },
  singapore: { latitude: 1.3521, longitude: 103.8198 },
  taipei: { latitude: 25.033, longitude: 121.5654 },
  'tel aviv': { latitude: 32.0853, longitude: 34.7818 },
  tokyo: { latitude: 35.6762, longitude: 139.6503 },
  toronto: { latitude: 43.6532, longitude: -79.3832 },
  warsaw: { latitude: 52.2297, longitude: 21.0122 },
  'washington dc': { latitude: 38.9072, longitude: -77.0369 },
  wellington: { latitude: -41.2865, longitude: 174.7762 },
  wuhan: { latitude: 30.5928, longitude: 114.3055 },
};

export function isWeatherMarket(market: Pick<Market, 'question' | 'slug' | 'endDate'>): boolean {
  return parseWeatherMarket(market) !== null;
}

export function parseWeatherMarket(
  market: Pick<Market, 'question' | 'slug' | 'endDate'>,
): WeatherMarketSpec | null {
  const q = market.question.trim();
  const match = q.match(
    /highest temperature in\s+(.+?)\s+be\s+(.+?)\s+on\s+([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i,
  );
  if (!match) return null;

  const city = titleCity(match[1]!.trim());
  const condition = match[2]!.trim().replace(/\?$/, '');
  const month = MONTHS[match[3]!.toLowerCase()];
  const day = Number(match[4]);
  const year = match[5] ? Number(match[5]) : new Date(market.endDate * 1000).getUTCFullYear();
  if (!month || !Number.isInteger(day) || day < 1 || day > 31 || !Number.isInteger(year)) return null;

  const parsedCondition = parseCondition(condition);
  if (!parsedCondition) return null;

  return {
    kind: 'high_temp',
    city,
    dateYmd: `${year}-${pad2(month)}-${pad2(day)}`,
    ...parsedCondition,
  };
}

function parseCondition(condition: string): Pick<WeatherMarketSpec, 'unit' | 'operator' | 'threshold' | 'low' | 'high'> | null {
  const between = condition.match(/between\s+(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*°?\s*([FC])/i);
  if (between) {
    return {
      unit: parseUnit(between[3]!),
      operator: 'between',
      low: Number(between[1]),
      high: Number(between[2]),
    };
  }

  const threshold = condition.match(/(-?\d+(?:\.\d+)?)\s*°?\s*([FC])(?:\s+or\s+(higher|lower))?/i);
  if (!threshold) return null;
  const qualifier = threshold[3]?.toLowerCase();
  return {
    unit: parseUnit(threshold[2]!),
    operator: qualifier === 'higher' ? 'gte' : qualifier === 'lower' ? 'lte' : 'exact',
    threshold: Number(threshold[1]),
  };
}

function parseUnit(raw: string): WeatherUnit {
  return raw.toUpperCase() === 'C' ? 'celsius' : 'fahrenheit';
}

function titleCity(city: string): string {
  return city
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function resolveWeatherLocation(city: string): WeatherLocation | null {
  const normalized = city.trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
  return LOCATIONS[normalized] ?? null;
}

export function buildWeatherGoatForecastArgs(
  spec: WeatherMarketSpec,
  location: WeatherLocation,
  nowSec: number = Math.floor(Date.now() / 1000),
): string[] {
  const targetMs = Date.parse(`${spec.dateYmd}T00:00:00Z`);
  const now = new Date(nowSec * 1000);
  const nowStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rawDays = Math.floor((targetMs - nowStartMs) / 86_400_000) + 1;
  const forecastDays = Math.max(1, Math.min(16, rawDays));

  return [
    'forecast',
    '--latitude', String(location.latitude),
    '--longitude', String(location.longitude),
    '--forecast-days', String(forecastDays),
    '--temperature-unit', spec.unit,
    '--agent',
  ];
}

export function extractForecastHigh(raw: unknown, dateYmd: string): number | null {
  const daily = (raw as { results?: { daily?: { time?: unknown; temperature_2m_max?: unknown } } })?.results?.daily;
  if (!daily || !Array.isArray(daily.time) || !Array.isArray(daily.temperature_2m_max)) return null;
  const idx = daily.time.findIndex(x => x === dateYmd);
  if (idx < 0) return null;
  const value = daily.temperature_2m_max[idx];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function estimateWeatherProbability(
  spec: WeatherMarketSpec,
  forecastHigh: number,
): ProbabilityEstimate | null {
  const scale = spec.unit === 'celsius' ? 5 : 10;
  const unit = spec.unit === 'celsius' ? 'C' : 'F';
  let probability: number;
  let targetText: string;
  let thresholdDistance = 0;

  if (spec.operator === 'between') {
    if (spec.low === undefined || spec.high === undefined) return null;
    const inside = forecastHigh >= spec.low && forecastHigh <= spec.high;
    const distance = inside ? 0 : Math.min(Math.abs(forecastHigh - spec.low), Math.abs(forecastHigh - spec.high));
    thresholdDistance = inside ? Math.min(Math.abs(forecastHigh - spec.low), Math.abs(forecastHigh - spec.high)) : distance;
    probability = inside ? 0.68 : 0.5 - distance / scale;
    targetText = `between ${spec.low}${unit}-${spec.high}${unit}`;
  } else {
    if (spec.threshold === undefined) return null;
    const diff = forecastHigh - spec.threshold;
    thresholdDistance = Math.abs(diff);
    if (spec.operator === 'gte') {
      probability = 0.5 + diff / scale;
      targetText = `${spec.threshold}${unit} or higher`;
    } else if (spec.operator === 'lte') {
      probability = 0.5 - diff / scale;
      targetText = `${spec.threshold}${unit} or lower`;
    } else {
      probability = 0.7 - Math.abs(diff) / scale;
      targetText = `exactly ${spec.threshold}${unit}`;
    }
  }

  probability = clamp(probability, 0.05, 0.95);
  const confidence = thresholdDistance >= scale
    ? 'high'
    : thresholdDistance >= scale * 0.25
      ? 'medium'
      : 'low';
  return {
    probability,
    confidence,
    reasoning: `Weather Goat forecast high for ${spec.city} on ${spec.dateYmd} is ${forecastHigh}${unit}; target is ${targetText}.`,
    contrarian: 'Forecast model error, local station choice, or market resolution-source differences may make the market price more accurate.',
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export interface EvaluateWeatherShadowArgs {
  market: Market;
  bestAsk: number;
  nowSec?: number;
  runner?: WeatherGoatRunner;
}

export async function evaluateWeatherShadow(args: EvaluateWeatherShadowArgs): Promise<ProbabilityEstimate | null> {
  const spec = parseWeatherMarket(args.market);
  if (!spec) return null;
  const location = resolveWeatherLocation(spec.city);
  if (!location) return null;

  const forecastArgs = buildWeatherGoatForecastArgs(spec, location, args.nowSec);
  const result = await (args.runner ?? runWeatherGoatCli)(forecastArgs);
  if (result.code !== 0) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  const forecastHigh = extractForecastHigh(raw, spec.dateYmd);
  if (forecastHigh === null) return null;
  return estimateWeatherProbability(spec, forecastHigh);
}

export const runWeatherGoatCli: WeatherGoatRunner = (args) => new Promise((resolve, reject) => {
  const child = spawn('weather-goat-pp-cli', args, { shell: false });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += String(d); });
  child.stderr.on('data', d => { stderr += String(d); });
  child.on('error', err => reject(err));
  child.on('close', code => resolve({ code, stdout, stderr }));
});
