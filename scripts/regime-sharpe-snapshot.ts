#!/usr/bin/env tsx
/**
 * Sprint S1 (docs/research/sprint-s1-sharpe-instrumentation.md §5.2):
 * Daily cron — read regime-trader state.json per instance, compute
 * daily return + rolling Sharpe-60d, upsert into regime_sharpe_snapshots.
 *
 * Cron: 0 17 * * 1-5 (17:00 CT, weekdays).
 *
 * Exit codes:
 *   0 = success OR partial failure (some instance unreadable; logged to stderr)
 *   1 = DB unreachable (catastrophic)
 *
 * Usage:
 *   npx tsx scripts/regime-sharpe-snapshot.ts
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../src/config.js';
import { parseInstanceState } from '../src/trading/state-schema.js';
import {
  computeDailyReturn,
  computeRollingSharpe,
  formatSnapshotDate,
} from '../src/trading/sharpe.js';

const DEFAULT_INSTANCES = ['spy-aggressive', 'spy-conservative'] as const;
const DEFAULT_REGIME_TRADER_PATH = 'C:/Code/regime-trader';
const ROLLING_WINDOW = 60;

export interface SnapshotRow {
  readonly instance: string;
  readonly snapshotDate: string;
  readonly equity: number;
  readonly cash: number | null;
  readonly peakEquity: number | null;
  readonly dailyReturn: number | null;
  readonly rollingSharpe60d: number | null;
  readonly nDays: number;
}

export interface SnapshotRunResult {
  readonly written: ReadonlyArray<SnapshotRow>;
  readonly errors: ReadonlyArray<{ instance: string; error: string }>;
}

export interface SnapshotOptions {
  /** Path to claudeclaw.db. Defaults to STORE_DIR/claudeclaw.db. */
  dbPath?: string;
  /** Instance names to snapshot. Defaults to ['spy-aggressive', 'spy-conservative']. */
  instanceNames?: ReadonlyArray<string>;
  /**
   * Injectable state.json reader. Returns parsed JSON or throws on read/parse error.
   * Default implementation reads `<regimeTraderPath>/instances/<instance>/data/state.json`.
   */
  readStateJson?: (instance: string) => unknown;
  /** Root path for regime-trader (used by the default reader). */
  regimeTraderPath?: string;
  /** Clock injection for tests. */
  now?: () => Date;
  /** Timezone for snapshot date formatting. Defaults to America/Chicago. */
  timeZone?: string;
  /** Logger for stderr messages. */
  logger?: (msg: string) => void;
}

function defaultReadStateJson(instance: string, root: string): unknown {
  const filePath = path.join(root, 'instances', instance, 'data', 'state.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Compute and upsert one daily snapshot per instance. Pure-ish: takes injectable
 * deps so an integration test can swap the state reader, DB path, and clock.
 */
export function runRegimeSharpeSnapshot(options: SnapshotOptions = {}): SnapshotRunResult {
  const dbPath = options.dbPath ?? path.join(STORE_DIR, 'claudeclaw.db');
  const instanceNames = options.instanceNames ?? DEFAULT_INSTANCES;
  const regimeTraderPath = options.regimeTraderPath ?? DEFAULT_REGIME_TRADER_PATH;
  const readStateJson =
    options.readStateJson ?? ((instance: string) => defaultReadStateJson(instance, regimeTraderPath));
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone ?? 'America/Chicago';
  const log = options.logger ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const written: SnapshotRow[] = [];
  const errors: { instance: string; error: string }[] = [];

  try {
    const snapshotDate = formatSnapshotDate(now(), timeZone);

    const priorEquityStmt = db.prepare<[string, string]>(`
      SELECT equity FROM regime_sharpe_snapshots
      WHERE instance = ? AND snapshot_date < ?
      ORDER BY snapshot_date DESC
      LIMIT 1
    `);

    const priorReturnsStmt = db.prepare<[string, string, number]>(`
      SELECT daily_return FROM regime_sharpe_snapshots
      WHERE instance = ? AND snapshot_date < ? AND daily_return IS NOT NULL
      ORDER BY snapshot_date DESC
      LIMIT ?
    `);

    const upsertStmt = db.prepare(`
      INSERT INTO regime_sharpe_snapshots (
        instance, snapshot_date, equity, cash, peak_equity,
        daily_return, rolling_sharpe_60d, n_days, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'state_json', ?)
      ON CONFLICT(instance, snapshot_date) DO UPDATE SET
        equity = excluded.equity,
        cash = excluded.cash,
        peak_equity = excluded.peak_equity,
        daily_return = excluded.daily_return,
        rolling_sharpe_60d = excluded.rolling_sharpe_60d,
        n_days = excluded.n_days,
        source = excluded.source,
        created_at = excluded.created_at
    `);

    for (const instance of instanceNames) {
      try {
        let raw: unknown;
        try {
          raw = readStateJson(instance);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ instance, error: `state.json read: ${msg}` });
          log(`regime-sharpe-snapshot: instance=${instance} ERROR state-read: ${msg}`);
          continue;
        }

        const parsed = parseInstanceState(raw);
        if (!parsed.ok) {
          errors.push({ instance, error: `state.json parse: ${parsed.error}` });
          log(`regime-sharpe-snapshot: instance=${instance} ERROR state-parse: ${parsed.error}`);
          continue;
        }

        const state = parsed.state;
        const equity = state.equity;
        const cash = Number.isFinite(state.cash) ? state.cash : null;

        // peak_equity is not part of InstanceState today; pass through if present
        // on the raw object so future producers can populate it without a code change.
        const rawRecord = raw as Record<string, unknown>;
        const peakEquity =
          typeof rawRecord.peak_equity === 'number' && Number.isFinite(rawRecord.peak_equity)
            ? (rawRecord.peak_equity as number)
            : null;

        const priorEquityRow = priorEquityStmt.get(instance, snapshotDate) as
          | { equity: number }
          | undefined;
        const yesterdayEquity = priorEquityRow ? priorEquityRow.equity : null;
        const dailyReturn = computeDailyReturn(equity, yesterdayEquity);

        // Pull the prior (ROLLING_WINDOW - 1) returns, reverse to chronological,
        // append today's return (when defined), then compute rolling Sharpe.
        const priorRows = priorReturnsStmt.all(
          instance,
          snapshotDate,
          ROLLING_WINDOW - 1,
        ) as Array<{ daily_return: number }>;
        const chronological = priorRows
          .map((r) => r.daily_return)
          .reverse();
        const windowReturns =
          dailyReturn === null ? chronological : [...chronological, dailyReturn];
        const { sharpe, nDays } = computeRollingSharpe(windowReturns, {
          windowSize: ROLLING_WINDOW,
        });

        upsertStmt.run(
          instance,
          snapshotDate,
          equity,
          cash,
          peakEquity,
          dailyReturn,
          sharpe,
          nDays,
          Date.now(),
        );

        const row: SnapshotRow = {
          instance,
          snapshotDate,
          equity,
          cash,
          peakEquity,
          dailyReturn,
          rollingSharpe60d: sharpe,
          nDays,
        };
        written.push(row);

        const dr = dailyReturn === null ? 'null' : dailyReturn.toFixed(6);
        const sh = sharpe === null ? 'null' : sharpe.toFixed(4);
        process.stdout.write(
          `regime-sharpe-snapshot: instance=${instance} equity=${equity} daily_return=${dr} sharpe60=${sh} n_days=${nDays}\n`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ instance, error: msg });
        log(`regime-sharpe-snapshot: instance=${instance} ERROR ${msg}`);
      }
    }
  } finally {
    db.close();
  }

  return { written, errors };
}

async function main(): Promise<void> {
  try {
    const result = runRegimeSharpeSnapshot();
    if (result.errors.length > 0 && result.written.length === 0) {
      // All instances failed but DB was reachable; still exit 0 per spec
      // (partial failure is tolerated). Stderr already has the details.
    }
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`regime-sharpe-snapshot: FATAL db-unreachable: ${msg}\n`);
    process.exit(1);
  }
}

// Only run main() when invoked directly (not when imported by tests).
const isMain = (() => {
  try {
    const argv1 = process.argv[1] ?? '';
    return /regime-sharpe-snapshot\.(ts|js)$/.test(argv1);
  } catch {
    return false;
  }
})();
if (isMain) {
  void main();
}
