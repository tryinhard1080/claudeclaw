export type OpsStatus = 'pass' | 'warn' | 'fail';

export interface OpsCheck {
  name: string;
  status: OpsStatus;
  state: string;
  detail: string;
}

export interface Pm2AppLike {
  name?: string;
  pm2_env?: {
    status?: string;
    pm_cwd?: string;
    pm_exec_path?: string;
  };
}

export interface MinimalRegimeState {
  market_open?: boolean;
  next_open?: string;
  equity?: number;
  cash?: number;
  regime?: unknown;
  risk?: unknown;
}

export interface PolyScanRunLike {
  started_at: number;
  duration_ms: number | null;
  market_count: number | null;
  status: string;
  error: string | null;
}

export interface Pm2SummaryOptions {
  nowMs?: number;
  regimeStatesByApp?: Record<string, MinimalRegimeState | null | undefined>;
  regimeStateMtimesByApp?: Record<string, number | null | undefined>;
}

const REGIME_APP_NAMES = ['regime-trader-spy-agg', 'regime-trader-spy-cons'] as const;
const REGIME_OPEN_STATE_STALE_MS = 30 * 60 * 1000;

function normalizePath(value: string | undefined): string {
  return (value ?? '').replace(/\\/g, '/').toLowerCase();
}

function statusRank(status: OpsStatus): number {
  return status === 'fail' ? 2 : status === 'warn' ? 1 : 0;
}

export function worstStatus(checks: readonly OpsCheck[]): OpsStatus {
  return checks.reduce<OpsStatus>((worst, check) => (
    statusRank(check.status) > statusRank(worst) ? check.status : worst
  ), 'pass');
}

export function summarizePm2Apps(apps: Pm2AppLike[], opts: Pm2SummaryOptions = {}): OpsCheck {
  const nowMs = opts.nowMs ?? Date.now();
  const byName = new Map(apps.map(app => [app.name, app]));
  const failures: string[] = [];
  const details: string[] = [];

  const claude = byName.get('claudeclaw-main');
  if (!claude) {
    failures.push('claudeclaw-main missing');
  } else {
    const cwd = normalizePath(claude.pm2_env?.pm_cwd);
    const execPath = normalizePath(claude.pm2_env?.pm_exec_path);
    if (claude.pm2_env?.status !== 'online') failures.push(`claudeclaw-main ${claude.pm2_env?.status ?? 'unknown'}`);
    if (!cwd.startsWith('c:/code/claudeclaw') && !execPath.startsWith('c:/code/claudeclaw')) {
      failures.push('claudeclaw-main path is not under C:/Code/claudeclaw');
    }
  }

  for (const appName of REGIME_APP_NAMES) {
    const app = byName.get(appName);
    if (!app) {
      failures.push(`${appName} missing`);
      continue;
    }

    const cwd = normalizePath(app.pm2_env?.pm_cwd);
    const execPath = normalizePath(app.pm2_env?.pm_exec_path);
    if (!cwd.startsWith('c:/code/regime-trader') && !execPath.startsWith('c:/code/regime-trader')) {
      failures.push(`${appName} path is not under C:/Code/regime-trader`);
    }

    if (app.pm2_env?.status === 'online') {
      details.push(`${appName} online`);
      continue;
    }

    const stateSummary = summarizeRegimeState(opts.regimeStatesByApp?.[appName] ?? null, nowMs, {
      stateMtimeMs: opts.regimeStateMtimesByApp?.[appName] ?? undefined,
    });
    if (
      stateSummary.state === 'closed_until_next_open' ||
      stateSummary.state === 'opening_grace' ||
      stateSummary.state === 'closed_stale_open_state'
    ) {
      details.push(`${appName} ${app.pm2_env?.status ?? 'not online'} while ${stateSummary.state}`);
      continue;
    }
    failures.push(`${appName} ${app.pm2_env?.status ?? 'not online'} without a healthy closed-market state`);
  }

  if (failures.length > 0) {
    return {
      name: 'PM2',
      status: 'fail',
      state: 'unhealthy',
      detail: failures.join('; '),
    };
  }

  return {
    name: 'PM2',
    status: 'pass',
    state: 'healthy',
    detail: details.length > 0 ? details.join('; ') : 'expected apps online',
  };
}

export function summarizeFinancialDatasetsMcp(output: string): OpsCheck {
  const lines = output.split(/\r?\n/);
  const lineIndex = lines.findIndex(item => item.toLowerCase().includes('financial-datasets'));

  if (lineIndex < 0) {
    return {
      name: 'Financial Datasets MCP',
      status: 'warn',
      state: 'missing',
      detail: 'financial-datasets MCP was not listed',
    };
  }

  const line = lines[lineIndex] ?? '';
  const nearbyStatusLine = lines
    .slice(lineIndex, lineIndex + 8)
    .map(item => item.trim())
    .find(item => /^Status:/i.test(item));
  const detail = nearbyStatusLine ? `${line.trim()} ${nearbyStatusLine}` : line.trim();

  if (/needs authentication/i.test(detail)) {
    return {
      name: 'Financial Datasets MCP',
      status: 'warn',
      state: 'needs_auth',
      detail,
    };
  }

  if (/connected|✓|check/i.test(detail)) {
    return {
      name: 'Financial Datasets MCP',
      status: 'pass',
      state: 'connected',
      detail,
    };
  }

  return {
    name: 'Financial Datasets MCP',
    status: 'warn',
    state: 'unknown',
    detail,
  };
}

export function summarizeWeatherGoatDoctor(raw: string | Record<string, unknown>): OpsCheck {
  let parsed: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {
        name: 'Weather Goat',
        status: 'fail',
        state: 'invalid_output',
        detail: raw.slice(0, 160),
      };
    }
  } else {
    parsed = raw;
  }

  const api = String(parsed.api ?? '').toLowerCase();
  const auth = String(parsed.auth ?? '').toLowerCase();
  if (api === 'reachable' && auth === 'not required') {
    return {
      name: 'Weather Goat',
      status: 'pass',
      state: 'healthy',
      detail: 'Open-Meteo reachable; auth not required',
    };
  }

  return {
    name: 'Weather Goat',
    status: api === 'reachable' ? 'warn' : 'fail',
    state: api === 'reachable' ? 'auth_required' : 'unreachable',
    detail: `api=${api || 'unknown'} auth=${auth || 'unknown'}`,
  };
}

export function summarizeRegimeState(
  state: MinimalRegimeState | null | undefined,
  nowMs: number = Date.now(),
  opts: { graceMs?: number; stateMtimeMs?: number; openStateStaleMs?: number } = {},
): OpsCheck {
  const graceMs = opts.graceMs ?? 10 * 60 * 1000;
  const openStateStaleMs = opts.openStateStaleMs ?? REGIME_OPEN_STATE_STALE_MS;
  if (!state) {
    return {
      name: 'Regime Trader state',
      status: 'fail',
      state: 'missing',
      detail: 'state.json is missing or unreadable',
    };
  }

  if (typeof state.market_open !== 'boolean') {
    return {
      name: 'Regime Trader state',
      status: 'fail',
      state: 'invalid',
      detail: 'market_open is required',
    };
  }

  if (state.market_open) {
    if (
      opts.stateMtimeMs !== undefined &&
      nowMs - opts.stateMtimeMs > openStateStaleMs
    ) {
      const lastWrite = new Date(opts.stateMtimeMs).toISOString();
      if (!isUsEquityRegularSession(nowMs)) {
        return {
          name: 'Regime Trader state',
          status: 'pass',
          state: 'closed_stale_open_state',
          detail: `outside regular session; last open state wrote ${lastWrite}`,
        };
      }
      return {
        name: 'Regime Trader state',
        status: 'fail',
        state: 'open_stale_during_session',
        detail: `open-market state stale since ${lastWrite}`,
      };
    }

    if (state.regime && state.risk) {
      return {
        name: 'Regime Trader state',
        status: 'pass',
        state: 'open_full',
        detail: 'open-market state includes regime and risk',
      };
    }
    return {
      name: 'Regime Trader state',
      status: 'warn',
      state: 'open_partial',
      detail: 'market is open but regime or risk is missing',
    };
  }

  const nextOpenMs = state.next_open ? Date.parse(state.next_open) : NaN;
  if (!Number.isFinite(nextOpenMs)) {
    return {
      name: 'Regime Trader state',
      status: 'warn',
      state: 'closed_missing_next_open',
      detail: 'market is closed but next_open is missing or invalid',
    };
  }

  if (nowMs < nextOpenMs) {
    return {
      name: 'Regime Trader state',
      status: 'pass',
      state: 'closed_until_next_open',
      detail: `next open ${new Date(nextOpenMs).toISOString()}`,
    };
  }

  if (nowMs <= nextOpenMs + graceMs) {
    return {
      name: 'Regime Trader state',
      status: 'pass',
      state: 'opening_grace',
      detail: `within ${Math.round(graceMs / 60000)}m market-open grace`,
    };
  }

  return {
    name: 'Regime Trader state',
    status: 'fail',
    state: 'stale_after_next_open',
    detail: `next_open passed at ${new Date(nextOpenMs).toISOString()}`,
  };
}

export function isUsEquityRegularSession(nowMs: number = Date.now()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));

  const weekday = parts.find(part => part.type === 'weekday')?.value ?? '';
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? NaN);
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;

  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export interface SharpeRow {
  instance: string;
  snapshot_date: string;
  n_days: number;
  created_at: number;
}

export interface SharpeFreshnessOptions {
  nowMs?: number;
  expectedInstances?: ReadonlyArray<string>;
  tradingDaysSinceStart?: number;
  tableMissing?: boolean;
  expectedSnapshotDate?: string | null;
}

const SHARPE_EXPECTED_INSTANCES: ReadonlyArray<string> = ['spy-aggressive', 'spy-conservative'];
const SHARPE_FRESH_MS = 24 * 60 * 60 * 1000;
const SHARPE_WARN_MS = 3 * 24 * 60 * 60 * 1000;
const SHARPE_MIN_TRADING_DAYS_FOR_FAIL = 5;
const SHARPE_SNAPSHOT_TIME_ZONE = 'America/Chicago';
const SHARPE_SNAPSHOT_MINUTES = 17 * 60;

function localDateParts(nowMs: number, timeZone: string): { date: string; weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? '';
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  return {
    date: `${year}-${month}-${day}`,
    weekday: value('weekday'),
    minutes: Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0,
  };
}

function isWeekdayName(weekday: string): boolean {
  return weekday !== 'Sat' && weekday !== 'Sun';
}

function expectedSharpeSnapshotDate(nowMs: number): string | null {
  const current = localDateParts(nowMs, SHARPE_SNAPSHOT_TIME_ZONE);
  if (isWeekdayName(current.weekday) && current.minutes >= SHARPE_SNAPSHOT_MINUTES) {
    return current.date;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  for (let offsetDays = 1; offsetDays <= 7; offsetDays += 1) {
    const candidate = localDateParts(nowMs - offsetDays * dayMs, SHARPE_SNAPSHOT_TIME_ZONE);
    if (isWeekdayName(candidate.weekday)) return candidate.date;
  }
  return null;
}

export function summarizeSharpeFreshness(
  rows: ReadonlyArray<SharpeRow>,
  opts: SharpeFreshnessOptions = {},
): OpsCheck {
  if (opts.tableMissing) {
    return {
      name: 'regime-sharpe',
      status: 'warn',
      state: 'table_missing',
      detail: 'regime_sharpe_snapshots table not present (migration pending)',
    };
  }

  const nowMs = opts.nowMs ?? Date.now();
  const expected = opts.expectedInstances ?? SHARPE_EXPECTED_INSTANCES;
  const tradingDays = opts.tradingDaysSinceStart ?? 0;
  const expectedDate = opts.expectedSnapshotDate === undefined
    ? expectedSharpeSnapshotDate(nowMs)
    : opts.expectedSnapshotDate;

  if (rows.length === 0) {
    if (tradingDays >= SHARPE_MIN_TRADING_DAYS_FOR_FAIL) {
      return {
        name: 'regime-sharpe',
        status: 'fail',
        state: 'missing',
        detail: `no snapshots after ${tradingDays} trading days`,
      };
    }
    return {
      name: 'regime-sharpe',
      status: 'warn',
      state: 'no_snapshots',
      detail: 'no snapshots yet',
    };
  }

  const latestByInstance = new Map<string, SharpeRow>();
  for (const row of rows) {
    const existing = latestByInstance.get(row.instance);
    if (!existing || row.created_at > existing.created_at) {
      latestByInstance.set(row.instance, row);
    }
  }

  const failures: string[] = [];
  const warnings: string[] = [];
  const passes: string[] = [];

  for (const instance of expected) {
    const row = latestByInstance.get(instance);
    if (!row) {
      if (tradingDays >= SHARPE_MIN_TRADING_DAYS_FOR_FAIL) {
        failures.push(`${instance} missing`);
      } else {
        warnings.push(`${instance} missing`);
      }
      continue;
    }

    const ageMs = nowMs - row.created_at;
    const ageDays = Math.max(0, Math.round(ageMs / (24 * 60 * 60 * 1000)));

    if (expectedDate && row.snapshot_date < expectedDate) {
      if (ageMs > SHARPE_WARN_MS) {
        failures.push(`${instance} ${ageDays}d stale`);
        continue;
      }

      if (ageMs > SHARPE_FRESH_MS) {
        warnings.push(`${instance} ${ageDays}d stale`);
        continue;
      }
    }

    if (row.n_days < 1) {
      warnings.push(`${instance} n_days=0`);
      continue;
    }

    passes.push(`${instance} n_days=${row.n_days}`);
  }

  if (failures.length > 0) {
    return {
      name: 'regime-sharpe',
      status: 'fail',
      state: 'stale',
      detail: failures.concat(warnings).join('; '),
    };
  }

  if (warnings.length > 0) {
    return {
      name: 'regime-sharpe',
      status: 'warn',
      state: 'stale',
      detail: warnings.concat(passes).join('; '),
    };
  }

  return {
    name: 'regime-sharpe',
    status: 'pass',
    state: 'fresh',
    detail: passes.join('; '),
  };
}

export function summarizePolyScanRuns(
  rows: PolyScanRunLike[],
  nowMs: number = Date.now(),
  scanIntervalMin: number,
): OpsCheck {
  const latestOk = [...rows]
    .filter(row => row.status === 'ok')
    .sort((a, b) => b.started_at - a.started_at)[0];

  if (!latestOk) {
    return {
      name: 'Polymarket scans',
      status: 'fail',
      state: 'missing_success',
      detail: 'no successful poly_scan_runs row found',
    };
  }

  const ageMs = nowMs - latestOk.started_at * 1000;
  const maxAgeMs = scanIntervalMin * 2 * 60 * 1000;
  if (ageMs <= maxAgeMs) {
    return {
      name: 'Polymarket scans',
      status: 'pass',
      state: 'fresh',
      detail: `last ok scan ${Math.round(ageMs / 60000)}m ago; markets=${latestOk.market_count ?? 'unknown'}`,
    };
  }

  return {
    name: 'Polymarket scans',
    status: 'fail',
    state: 'stale',
    detail: `last ok scan ${Math.round(ageMs / 60000)}m ago; threshold=${scanIntervalMin * 2}m`,
  };
}
