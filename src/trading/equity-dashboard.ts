import fs from 'fs';
import path from 'path';

import { REGIME_TRADER_PATH } from '../config.js';
import type { OpsStatus } from './ops-status.js';

const DEFAULT_REGIME_ROOT = 'C:\\Code\\regime-trader';
const INSTANCE_NAMES = ['spy-aggressive', 'spy-conservative'] as const;
const BROKER_CACHE_TTL_MS = 30_000;

type InstanceName = typeof INSTANCE_NAMES[number];

interface RegimePosition {
  symbol?: string;
  quantity?: number;
  market_value?: number;
  unrealized_pl?: number;
  unrealized_plpc?: number;
  current_price?: number;
  avg_entry_price?: number;
}

interface RegimeSignal {
  time?: string;
  symbol?: string;
  regime?: string;
  confidence?: number;
  vol_rank?: number;
  target_allocation?: number;
  should_rebalance?: boolean;
  strategy?: string;
  action?: string;
  approved_allocation?: number;
  rejection_reason?: string;
}

interface RegimeState {
  mode?: string;
  market_open?: boolean;
  execution_enabled?: boolean;
  equity?: number;
  cash?: number;
  buying_power?: number;
  regime?: {
    label?: string;
    confidence?: number;
    stability?: boolean;
    stability_bars?: number;
    flicker_rate?: number;
    vol_rank?: number;
  };
  risk?: {
    daily_dd_pct?: number;
    peak_dd_pct?: number;
    leverage?: number;
    circuit_breakers?: Record<string, boolean>;
  };
  positions?: RegimePosition[];
  recent_signals?: RegimeSignal[];
  session_trades?: number;
  peak_equity?: number;
  updated_at?: string;
}

export interface EquityPosition {
  symbol: string;
  qty: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number | null;
  currentPrice: number | null;
  avgEntryPrice: number | null;
}

export interface EquityOrder {
  submittedAt: string | null;
  filledAt: string | null;
  symbol: string;
  side: string;
  qty: number;
  filledQty: number;
  status: string;
  orderType: string;
  limitPrice: number | null;
  filledAvgPrice: number | null;
}

export interface EquityBrokerSnapshot {
  status: string;
  equity: number;
  cash: number;
  buyingPower: number;
  portfolioValue: number;
  positions: EquityPosition[];
  recentOrders: EquityOrder[];
  source: 'alpaca';
  error?: string;
}

export interface EquityInstanceSummary {
  id: InstanceName;
  label: string;
  role: 'active' | 'shadow';
  status: 'online' | 'stale' | 'missing';
  executionEnabled: boolean;
  marketOpen: boolean;
  updatedAt: string | null;
  ageSec: number | null;
  equity: number;
  cash: number;
  buyingPower: number;
  position: EquityPosition | null;
  currentAllocation: number | null;
  targetAllocation: number | null;
  approvedAllocation: number | null;
  allocationDrift: number | null;
  regimeLabel: string | null;
  confidence: number | null;
  volRank: number | null;
  strategy: string | null;
  action: string | null;
  shouldRebalance: boolean | null;
  dailyDrawdownPct: number | null;
  peakDrawdownPct: number | null;
  circuitBreakers: Record<string, boolean>;
}

export interface EquityDashboardPayload {
  generatedAt: number;
  status: OpsStatus;
  detail: string;
  strategy: {
    name: string;
    description: string;
    activeSymbol: string;
  };
  broker: EquityBrokerSnapshot | null;
  activeInstance: EquityInstanceSummary | null;
  instances: EquityInstanceSummary[];
  aggregate: {
    equity: number;
    cash: number;
    buyingPower: number;
    exposureUsd: number;
    unrealizedPnl: number;
    currentAllocation: number | null;
    targetAllocation: number | null;
    allocationDrift: number | null;
  };
}

export interface BuildEquityDashboardPayloadArgs {
  generatedAt?: number;
  nowMs?: number;
  states: Partial<Record<InstanceName, RegimeState | null>>;
  stateMtimes?: Partial<Record<InstanceName, number | null>>;
  broker?: EquityBrokerSnapshot | null;
}

interface EnvMap {
  [key: string]: string;
}

type FetchLike = typeof fetch;

let brokerCache: { checkedAtMs: number; root: string; snapshot: EquityBrokerSnapshot | null } | null = null;

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function nullableNum(value: unknown): number | null {
  const parsed = num(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEnv(text: string): EnvMap {
  const env: EnvMap = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([^#=]+)=(.*)$/);
    if (!match) continue;
    env[match[1]!.trim()] = match[2]!.trim().replace(/^"|"$/g, '');
  }
  return env;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function regimeRoot(): string {
  return REGIME_TRADER_PATH || DEFAULT_REGIME_ROOT;
}

function statePath(root: string, instance: InstanceName): string {
  return path.join(root, 'instances', instance, 'data', 'state.json');
}

function normalizePosition(raw: RegimePosition | Record<string, unknown> | null | undefined): EquityPosition | null {
  if (!raw) return null;
  const symbol = String(raw.symbol ?? '').trim();
  if (!symbol) return null;
  return {
    symbol,
    qty: num(raw.quantity ?? (raw as Record<string, unknown>).qty),
    marketValue: num(raw.market_value ?? (raw as Record<string, unknown>).market_value),
    unrealizedPnl: num(raw.unrealized_pl ?? (raw as Record<string, unknown>).unrealized_pl),
    unrealizedPnlPct: nullableNum(raw.unrealized_plpc ?? (raw as Record<string, unknown>).unrealized_plpc),
    currentPrice: nullableNum(raw.current_price ?? (raw as Record<string, unknown>).current_price),
    avgEntryPrice: nullableNum(raw.avg_entry_price ?? (raw as Record<string, unknown>).avg_entry_price),
  };
}

function normalizeAlpacaPosition(raw: Record<string, unknown>): EquityPosition | null {
  const symbol = String(raw.symbol ?? '').trim();
  if (!symbol) return null;
  return {
    symbol,
    qty: num(raw.qty),
    marketValue: num(raw.market_value),
    unrealizedPnl: num(raw.unrealized_pl),
    unrealizedPnlPct: nullableNum(raw.unrealized_plpc),
    currentPrice: nullableNum(raw.current_price),
    avgEntryPrice: nullableNum(raw.avg_entry_price),
  };
}

function normalizeAlpacaOrder(raw: Record<string, unknown>): EquityOrder {
  return {
    submittedAt: typeof raw.submitted_at === 'string' ? raw.submitted_at : null,
    filledAt: typeof raw.filled_at === 'string' ? raw.filled_at : null,
    symbol: String(raw.symbol ?? ''),
    side: String(raw.side ?? ''),
    qty: num(raw.qty),
    filledQty: num(raw.filled_qty),
    status: String(raw.status ?? ''),
    orderType: String(raw.type ?? ''),
    limitPrice: nullableNum(raw.limit_price),
    filledAvgPrice: nullableNum(raw.filled_avg_price),
  };
}

function latestSignal(state: RegimeState | null | undefined): RegimeSignal | null {
  const signals = state?.recent_signals ?? [];
  return signals.length > 0 ? signals[signals.length - 1]! : null;
}

function summarizeInstance(
  id: InstanceName,
  state: RegimeState | null | undefined,
  stateMtime: number | null | undefined,
  nowMs: number,
): EquityInstanceSummary {
  const signal = latestSignal(state);
  const position = normalizePosition((state?.positions ?? [])[0]);
  const equity = num(state?.equity);
  const currentAllocation = equity > 0 && position ? position.marketValue / equity : null;
  const targetAllocation = nullableNum(signal?.target_allocation);
  const approvedAllocation = nullableNum(signal?.approved_allocation);
  const referenceAllocation = approvedAllocation ?? targetAllocation;
  const ageSec = stateMtime ? Math.max(0, Math.round((nowMs - stateMtime) / 1000)) : null;
  const status: EquityInstanceSummary['status'] = !state
    ? 'missing'
    : ageSec !== null && ageSec > 30 * 60
      ? 'stale'
      : 'online';

  return {
    id,
    label: id === 'spy-aggressive' ? 'SPY Aggressive' : 'SPY Conservative',
    role: state?.execution_enabled === false ? 'shadow' : 'active',
    status,
    executionEnabled: state?.execution_enabled !== false,
    marketOpen: state?.market_open === true,
    updatedAt: state?.updated_at ?? null,
    ageSec,
    equity,
    cash: num(state?.cash),
    buyingPower: num(state?.buying_power),
    position,
    currentAllocation,
    targetAllocation,
    approvedAllocation,
    allocationDrift: currentAllocation !== null && referenceAllocation !== null
      ? currentAllocation - referenceAllocation
      : null,
    regimeLabel: state?.regime?.label ?? signal?.regime ?? null,
    confidence: nullableNum(state?.regime?.confidence ?? signal?.confidence),
    volRank: nullableNum(state?.regime?.vol_rank ?? signal?.vol_rank),
    strategy: signal?.strategy ?? null,
    action: signal?.action ?? null,
    shouldRebalance: typeof signal?.should_rebalance === 'boolean' ? signal.should_rebalance : null,
    dailyDrawdownPct: nullableNum(state?.risk?.daily_dd_pct),
    peakDrawdownPct: nullableNum(state?.risk?.peak_dd_pct),
    circuitBreakers: state?.risk?.circuit_breakers ?? {},
  };
}

export function buildEquityDashboardPayload(args: BuildEquityDashboardPayloadArgs): EquityDashboardPayload {
  const nowMs = args.nowMs ?? Date.now();
  const instances = INSTANCE_NAMES.map(instance =>
    summarizeInstance(instance, args.states[instance], args.stateMtimes?.[instance], nowMs)
  );
  const activeInstance = instances.find(instance => instance.executionEnabled) ?? instances[0] ?? null;
  const broker = args.broker ?? null;
  const brokerPosition = broker?.positions.find(position => position.symbol === 'SPY') ?? null;
  const fallbackPosition = activeInstance?.position ?? null;
  const position = brokerPosition ?? fallbackPosition;
  const equity = broker?.equity ?? activeInstance?.equity ?? 0;
  const cash = broker?.cash ?? activeInstance?.cash ?? 0;
  const buyingPower = broker?.buyingPower ?? activeInstance?.buyingPower ?? 0;
  const exposureUsd = position?.marketValue ?? 0;
  const unrealizedPnl = position?.unrealizedPnl ?? 0;
  const currentAllocation = equity > 0 ? exposureUsd / equity : activeInstance?.currentAllocation ?? null;
  const targetAllocation = activeInstance?.approvedAllocation ?? activeInstance?.targetAllocation ?? null;
  const allocationDrift = currentAllocation !== null && targetAllocation !== null
    ? currentAllocation - targetAllocation
    : null;
  const status: OpsStatus = instances.some(instance => instance.status === 'missing')
    ? 'fail'
    : !broker
      ? 'warn'
      : instances.some(instance => instance.status === 'stale')
        ? 'warn'
        : 'pass';

  return {
    generatedAt: args.generatedAt ?? Math.floor(nowMs / 1000),
    status,
    detail: broker
      ? `${broker.status || 'unknown'}; ${position ? `${position.qty} ${position.symbol}` : 'no broker position'}`
      : 'broker snapshot unavailable; using regime-trader state files',
    strategy: {
      name: 'HMM volatility-regime SPY allocation',
      description: 'Long-only SPY allocation sized by volatility regime, confidence, risk caps, and broker-truth rebalancing.',
      activeSymbol: 'SPY',
    },
    broker,
    activeInstance,
    instances,
    aggregate: {
      equity,
      cash,
      buyingPower,
      exposureUsd,
      unrealizedPnl,
      currentAllocation,
      targetAllocation,
      allocationDrift,
    },
  };
}

function readStates(root: string): {
  states: Partial<Record<InstanceName, RegimeState | null>>;
  mtimes: Partial<Record<InstanceName, number | null>>;
} {
  const states: Partial<Record<InstanceName, RegimeState | null>> = {};
  const mtimes: Partial<Record<InstanceName, number | null>> = {};
  for (const instance of INSTANCE_NAMES) {
    const filePath = statePath(root, instance);
    states[instance] = readJsonFile<RegimeState>(filePath);
    try {
      mtimes[instance] = fs.statSync(filePath).mtimeMs;
    } catch {
      mtimes[instance] = null;
    }
  }
  return { states, mtimes };
}

async function fetchJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchAlpacaBrokerSnapshot(
  root: string = regimeRoot(),
  fetchImpl: FetchLike = fetch,
): Promise<EquityBrokerSnapshot | null> {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return null;
  const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
  const apiKey = env.ALPACA_API_KEY;
  const secret = env.ALPACA_SECRET_KEY;
  if (!apiKey || !secret) return null;

  const base = env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  const headers = {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': secret,
  };

  try {
    const [accountRaw, positionsRaw, ordersRaw] = await Promise.all([
      fetchJson(fetchImpl, `${base}/v2/account`, headers),
      fetchJson(fetchImpl, `${base}/v2/positions`, headers),
      fetchJson(fetchImpl, `${base}/v2/orders?status=all&limit=20&direction=desc`, headers),
    ]);
    const account = accountRaw as Record<string, unknown>;
    const positions = Array.isArray(positionsRaw)
      ? positionsRaw.map(row => normalizeAlpacaPosition(row as Record<string, unknown>)).filter((row): row is EquityPosition => row !== null)
      : [];
    const recentOrders = Array.isArray(ordersRaw)
      ? ordersRaw.map(row => normalizeAlpacaOrder(row as Record<string, unknown>))
      : [];
    return {
      status: String(account.status ?? 'unknown'),
      equity: num(account.equity),
      cash: num(account.cash),
      buyingPower: num(account.buying_power),
      portfolioValue: num(account.portfolio_value ?? account.equity),
      positions,
      recentOrders,
      source: 'alpaca',
    };
  } catch (error) {
    return {
      status: 'unavailable',
      equity: 0,
      cash: 0,
      buyingPower: 0,
      portfolioValue: 0,
      positions: [],
      recentOrders: [],
      source: 'alpaca',
      error: String(error).slice(0, 160),
    };
  }
}

export async function collectEquityDashboardPayload(options: {
  root?: string;
  nowMs?: number;
  fetchImpl?: FetchLike;
  cacheTtlMs?: number;
  forceBrokerRefresh?: boolean;
} = {}): Promise<EquityDashboardPayload> {
  const root = options.root ?? regimeRoot();
  const nowMs = options.nowMs ?? Date.now();
  const { states, mtimes } = readStates(root);
  const cacheTtlMs = options.cacheTtlMs ?? BROKER_CACHE_TTL_MS;

  let broker: EquityBrokerSnapshot | null = null;
  if (
    !options.forceBrokerRefresh &&
    brokerCache &&
    brokerCache.root === root &&
    nowMs - brokerCache.checkedAtMs <= cacheTtlMs
  ) {
    broker = brokerCache.snapshot;
  } else {
    broker = await fetchAlpacaBrokerSnapshot(root, options.fetchImpl ?? fetch);
    brokerCache = { checkedAtMs: nowMs, root, snapshot: broker };
  }

  return buildEquityDashboardPayload({
    nowMs,
    states,
    stateMtimes: mtimes,
    broker,
  });
}

