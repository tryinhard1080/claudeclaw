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
}

const REGIME_APP_NAMES = ['regime-trader-spy-agg', 'regime-trader-spy-cons'] as const;

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

    const stateSummary = summarizeRegimeState(opts.regimeStatesByApp?.[appName] ?? null, nowMs);
    if (stateSummary.state === 'closed_until_next_open' || stateSummary.state === 'opening_grace') {
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
  const line = output
    .split(/\r?\n/)
    .find(item => item.toLowerCase().includes('financial-datasets'));

  if (!line) {
    return {
      name: 'Financial Datasets MCP',
      status: 'warn',
      state: 'missing',
      detail: 'financial-datasets MCP was not listed',
    };
  }

  if (/needs authentication/i.test(line)) {
    return {
      name: 'Financial Datasets MCP',
      status: 'warn',
      state: 'needs_auth',
      detail: line.trim(),
    };
  }

  if (/connected|✓|check/i.test(line)) {
    return {
      name: 'Financial Datasets MCP',
      status: 'pass',
      state: 'connected',
      detail: line.trim(),
    };
  }

  return {
    name: 'Financial Datasets MCP',
    status: 'warn',
    state: 'unknown',
    detail: line.trim(),
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
  opts: { graceMs?: number } = {},
): OpsCheck {
  const graceMs = opts.graceMs ?? 10 * 60 * 1000;
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
