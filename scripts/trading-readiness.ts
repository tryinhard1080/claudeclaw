#!/usr/bin/env tsx
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { POLY_SCAN_INTERVAL_MIN, REGIME_TRADER_PATH, STORE_DIR } from '../src/config.js';
import {
  type MinimalRegimeState,
  type OpsCheck,
  type Pm2AppLike,
  type PolyScanRunLike,
  type SharpeRow,
  summarizeFinancialDatasetsMcp,
  summarizePm2Apps,
  summarizePolyScanRuns,
  summarizeRegimeState,
  summarizeSharpeFreshness,
  summarizeWeatherGoatDoctor,
  worstStatus,
} from '../src/trading/ops-status.js';

const REGIME_APP_TO_INSTANCE: Record<string, string> = {
  'regime-trader-spy-agg': 'spy-aggressive',
  'regime-trader-spy-cons': 'spy-conservative',
};

function runCommand(command: string): { ok: true; output: string } | { ok: false; output: string } {
  try {
    return {
      ok: true,
      output: execSync(command, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
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

function readRegimeStatesByApp(root: string): Record<string, MinimalRegimeState | null> {
  const states: Record<string, MinimalRegimeState | null> = {};
  for (const [appName, instanceName] of Object.entries(REGIME_APP_TO_INSTANCE)) {
    const statePath = path.join(root, 'instances', instanceName, 'data', 'state.json');
    states[appName] = readJsonFile<MinimalRegimeState>(statePath);
  }
  return states;
}

function summarizePm2(regimeStatesByApp: Record<string, MinimalRegimeState | null>): OpsCheck {
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
    return summarizePm2Apps(apps, { regimeStatesByApp });
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
  const result = runCommand('claude mcp list');
  if (!result.ok) {
    return {
      name: 'Financial Datasets MCP',
      status: 'warn',
      state: 'mcp_list_failed',
      detail: result.output.slice(0, 220),
    };
  }
  return summarizeFinancialDatasetsMcp(result.output);
}

function summarizePolyDb(): OpsCheck {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  if (!fs.existsSync(dbPath)) {
    return {
      name: 'Polymarket scans',
      status: 'fail',
      state: 'db_missing',
      detail: dbPath,
    };
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      db.pragma('busy_timeout = 5000');
      const rows = db
        .prepare('SELECT started_at, duration_ms, market_count, status, error FROM poly_scan_runs ORDER BY started_at DESC LIMIT 10')
        .all() as PolyScanRunLike[];
      return summarizePolyScanRuns(rows, Date.now(), POLY_SCAN_INTERVAL_MIN);
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      name: 'Polymarket scans',
      status: 'fail',
      state: 'db_read_failed',
      detail: String(error).slice(0, 220),
    };
  }
}

function summarizeRegimeSharpe(): OpsCheck {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  if (!fs.existsSync(dbPath)) {
    return {
      name: 'regime-sharpe',
      status: 'fail',
      state: 'db_missing',
      detail: dbPath,
    };
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      db.pragma('busy_timeout = 5000');
      const tableRow = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='regime_sharpe_snapshots'",
        )
        .get() as { name?: string } | undefined;

      if (!tableRow || !tableRow.name) {
        return summarizeSharpeFreshness([], { tableMissing: true });
      }

      const rows = db
        .prepare(
          `SELECT instance, snapshot_date, n_days, created_at
             FROM regime_sharpe_snapshots
            WHERE (instance, created_at) IN (
              SELECT instance, MAX(created_at) FROM regime_sharpe_snapshots GROUP BY instance
            )`,
        )
        .all() as SharpeRow[];

      return summarizeSharpeFreshness(rows);
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      name: 'regime-sharpe',
      status: 'fail',
      state: 'db_read_failed',
      detail: String(error).slice(0, 220),
    };
  }
}

function formatStatus(status: OpsCheck['status']): string {
  return status.toUpperCase().padEnd(4);
}

function printTable(checks: OpsCheck[]): void {
  console.log('Trading Readiness');
  console.log('-----------------');
  for (const check of checks) {
    console.log(`${formatStatus(check.status)}  ${check.name.padEnd(24)} ${check.state.padEnd(24)} ${check.detail}`);
  }
}

function main(): void {
  const root = regimeRoot();
  const regimeStatesByApp = readRegimeStatesByApp(root);
  const regimeChecks = Object.entries(regimeStatesByApp).map(([appName, state]) => {
    const instanceName = REGIME_APP_TO_INSTANCE[appName] ?? appName;
    const check = summarizeRegimeState(state);
    return { ...check, name: `Regime ${instanceName}` };
  });

  const checks: OpsCheck[] = [
    summarizePm2(regimeStatesByApp),
    summarizeWeatherGoat(),
    summarizeMcp(),
    summarizePolyDb(),
    summarizeRegimeSharpe(),
    ...regimeChecks,
  ];

  printTable(checks);
  if (worstStatus(checks) === 'fail') {
    process.exitCode = 1;
  }
}

main();
