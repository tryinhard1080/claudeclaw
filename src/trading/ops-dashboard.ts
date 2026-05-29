import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';

import {
  POLY_SCAN_INTERVAL_MIN,
  REGIME_TRADER_PATH,
  STORE_DIR,
} from '../config.js';
import { getDailyRealizedPnl } from '../poly/pnl-tracker.js';
import {
  type MinimalRegimeState,
  type OpsCheck,
  type OpsStatus,
  type Pm2AppLike,
  type PolyScanRunLike,
  summarizeFinancialDatasetsMcp,
  summarizePm2Apps,
  summarizePolyScanRuns,
  summarizeRegimeState,
  summarizeWeatherGoatDoctor,
  worstStatus,
} from './ops-status.js';

const REGIME_APP_TO_INSTANCE: Record<string, string> = {
  'regime-trader-spy-agg': 'spy-aggressive',
  'regime-trader-spy-cons': 'spy-conservative',
};

export interface TradingOpsPaperSummary {
  signals24h: number;
  approved24h: number;
  openPositions: number;
  realizedPnlToday: number;
}

export interface TradingOpsPayload {
  generatedAt: number;
  status: OpsStatus;
  checks: {
    pm2: OpsCheck | null;
    weatherGoat: OpsCheck | null;
    financialDatasets: OpsCheck | null;
    polymarketScans: OpsCheck | null;
    regimes: OpsCheck[];
  };
  checkList: OpsCheck[];
  paper: TradingOpsPaperSummary;
}

export interface BuildTradingOpsPayloadArgs {
  generatedAt?: number;
  checks: OpsCheck[];
  paper: TradingOpsPaperSummary;
}

export function buildTradingOpsPayload(args: BuildTradingOpsPayloadArgs): TradingOpsPayload {
  const regimes = args.checks.filter(check => check.name.startsWith('Regime '));
  const byName = (name: string) => args.checks.find(check => check.name === name) ?? null;

  return {
    generatedAt: args.generatedAt ?? Math.floor(Date.now() / 1000),
    status: worstStatus(args.checks),
    checks: {
      pm2: byName('PM2'),
      weatherGoat: byName('Weather Goat'),
      financialDatasets: byName('Financial Datasets MCP'),
      polymarketScans: byName('Polymarket scans'),
      regimes,
    },
    checkList: args.checks,
    paper: args.paper,
  };
}

function runCommand(command: string, timeoutMs = 20_000): { ok: true; output: string } | { ok: false; output: string } {
  try {
    return {
      ok: true,
      output: execSync(command, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        windowsHide: true,
      }),
    };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = err.stdout ? String(err.stdout) : '';
    const stderr = err.stderr ? String(err.stderr) : '';
    return { ok: false, output: (stdout + stderr).trim() || err.message || `${command} failed` };
  }
}

type CommandRunner = typeof runCommand;

const MCP_CACHE_TTL_MS = 15 * 60 * 1000;
let dashboardMcpCache: { checkedAtMs: number; check: OpsCheck } | null = null;

export interface DashboardMcpOptions {
  nowMs?: number;
  cacheTtlMs?: number;
  commandRunner?: CommandRunner;
  forceRefresh?: boolean;
}

export function resetDashboardMcpCacheForTest(): void {
  dashboardMcpCache = null;
}

export function summarizeDashboardMcp(options: DashboardMcpOptions = {}): OpsCheck {
  const nowMs = options.nowMs ?? Date.now();
  const cacheTtlMs = options.cacheTtlMs ?? MCP_CACHE_TTL_MS;
  if (
    !options.forceRefresh &&
    dashboardMcpCache &&
    nowMs - dashboardMcpCache.checkedAtMs <= cacheTtlMs
  ) {
    return dashboardMcpCache.check;
  }

  const commandRunner = options.commandRunner ?? runCommand;
  const result = commandRunner('claude mcp list', 30_000);
  const check: OpsCheck = result.ok
    ? summarizeFinancialDatasetsMcp(result.output)
    : {
        name: 'Financial Datasets MCP',
        status: 'warn',
        state: 'command_failed',
        detail: result.output.slice(0, 220),
      };

  dashboardMcpCache = { checkedAtMs: nowMs, check };
  return check;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function regimeRoot(): string {
  return REGIME_TRADER_PATH || 'C:\\Code\\regime-trader';
}

interface RegimeStateReadResult {
  states: Record<string, MinimalRegimeState | null>;
  mtimes: Record<string, number | null>;
}

function readRegimeStatesByApp(root: string): RegimeStateReadResult {
  const states: Record<string, MinimalRegimeState | null> = {};
  const mtimes: Record<string, number | null> = {};
  for (const [appName, instanceName] of Object.entries(REGIME_APP_TO_INSTANCE)) {
    const statePath = path.join(root, 'instances', instanceName, 'data', 'state.json');
    states[appName] = readJsonFile<MinimalRegimeState>(statePath);
    try {
      mtimes[appName] = fs.statSync(statePath).mtimeMs;
    } catch {
      mtimes[appName] = null;
    }
  }
  return { states, mtimes };
}

function summarizePm2(regimeStates: RegimeStateReadResult): OpsCheck {
  const result = runCommand('pm2 jlist');
  if (!result.ok) {
    return {
      name: 'PM2',
      status: 'fail',
      state: 'command_failed',
      detail: result.output.slice(0, 220),
    };
  }

  try {
    const apps = JSON.parse(result.output) as Pm2AppLike[];
    return summarizePm2Apps(apps, {
      regimeStatesByApp: regimeStates.states,
      regimeStateMtimesByApp: regimeStates.mtimes,
    });
  } catch {
    return {
      name: 'PM2',
      status: 'fail',
      state: 'invalid_json',
      detail: result.output.slice(0, 220),
    };
  }
}

function summarizeWeatherGoat(): OpsCheck {
  const result = runCommand('weather-goat-pp-cli doctor --agent');
  if (!result.ok) {
    return {
      name: 'Weather Goat',
      status: 'fail',
      state: 'command_failed',
      detail: result.output.slice(0, 220),
    };
  }
  return summarizeWeatherGoatDoctor(result.output);
}

function summarizeMcp(): OpsCheck {
  return summarizeDashboardMcp();
}

function summarizePolyDb(db: Database.Database): OpsCheck {
  try {
    const rows = db
      .prepare('SELECT started_at, duration_ms, market_count, status, error FROM poly_scan_runs ORDER BY started_at DESC LIMIT 10')
      .all() as PolyScanRunLike[];
    return summarizePolyScanRuns(rows, Date.now(), POLY_SCAN_INTERVAL_MIN);
  } catch (error) {
    return {
      name: 'Polymarket scans',
      status: 'fail',
      state: 'db_read_failed',
      detail: String(error).slice(0, 220),
    };
  }
}

function scalar(db: Database.Database, sql: string, fallback = 0): number {
  try {
    const row = db.prepare(sql).get() as { value: number | null } | undefined;
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

function summarizePaper(db: Database.Database, nowSec: number): TradingOpsPaperSummary {
  const dayAgo = nowSec - 24 * 60 * 60;
  return {
    signals24h: scalar(db, `SELECT COUNT(*) AS value FROM poly_signals WHERE created_at >= ${dayAgo}`),
    approved24h: scalar(db, `SELECT COUNT(*) AS value FROM poly_signals WHERE created_at >= ${dayAgo} AND approved=1`),
    openPositions: scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status='open'"),
    realizedPnlToday: getDailyRealizedPnl(db),
  };
}

export function collectTradingOpsPayload(db: Database.Database): TradingOpsPayload {
  const nowSec = Math.floor(Date.now() / 1000);
  const states = readRegimeStatesByApp(regimeRoot());
  const regimeChecks = Object.entries(states.states).map(([appName, state]) => {
    const instanceName = REGIME_APP_TO_INSTANCE[appName] ?? appName;
    const check = summarizeRegimeState(state, Date.now(), {
      stateMtimeMs: states.mtimes[appName] ?? undefined,
    });
    return { ...check, name: `Regime ${instanceName}` };
  });

  const checks: OpsCheck[] = [
    summarizePm2(states),
    summarizeWeatherGoat(),
    summarizeMcp(),
    summarizePolyDb(db),
    ...regimeChecks,
  ];

  return buildTradingOpsPayload({
    generatedAt: nowSec,
    checks,
    paper: summarizePaper(db, nowSec),
  });
}
