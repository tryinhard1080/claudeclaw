import type Database from 'better-sqlite3';

export type ReadinessStatus = 'pass' | 'warn' | 'fail';

export interface GateProgressCheck {
  box: number;
  name: string;
  status: ReadinessStatus;
  state: string;
  detail: string;
  current?: number;
  target?: number;
}

interface SharpeGateRow {
  instance: string;
  n_days: number;
  rolling_sharpe_60d: number | null;
  created_at: number;
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name) as { name?: string } | undefined;
  return row?.name === name;
}

function scalar(db: Database.Database, sql: string): number {
  const row = db.prepare(sql).get() as { value: number | null } | undefined;
  return row?.value ?? 0;
}

function readKv(db: Database.Database, key: string): string | null {
  if (!tableExists(db, 'poly_kv')) return null;
  const row = db.prepare('SELECT value FROM poly_kv WHERE key=?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function summarizePolymarketResolvedGate(db: Database.Database): GateProgressCheck {
  if (!tableExists(db, 'poly_paper_trades')) {
    return {
      box: 2,
      name: 'Polymarket resolved trades',
      status: 'warn',
      state: 'table_missing',
      detail: 'poly_paper_trades missing',
      current: 0,
      target: 50,
    };
  }

  const settled = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status IN ('won','lost')");
  const open = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status='open'");
  const voided = scalar(db, "SELECT COUNT(*) AS value FROM poly_paper_trades WHERE status='voided'");
  const realizedPnl = scalar(db, "SELECT COALESCE(SUM(realized_pnl), 0) AS value FROM poly_paper_trades WHERE status IN ('won','lost')");
  const pass = settled >= 50 && realizedPnl > 0;

  return {
    box: 2,
    name: 'Polymarket resolved trades',
    status: pass ? 'pass' : 'warn',
    state: pass ? 'complete' : 'incomplete',
    detail: `${settled}/50 settled; realized P&L ${realizedPnl.toFixed(2)}; open ${open}; voided ${voided}`,
    current: settled,
    target: 50,
  };
}

export function summarizeRegimeSharpeGate(db: Database.Database): GateProgressCheck {
  if (!tableExists(db, 'regime_sharpe_snapshots')) {
    return {
      box: 3,
      name: 'Regime Sharpe',
      status: 'warn',
      state: 'table_missing',
      detail: 'regime_sharpe_snapshots missing',
      current: 0,
      target: 60,
    };
  }

  const rows = db.prepare(`
    SELECT instance, n_days, rolling_sharpe_60d, created_at
      FROM regime_sharpe_snapshots
     WHERE (instance, created_at) IN (
       SELECT instance, MAX(created_at) FROM regime_sharpe_snapshots GROUP BY instance
     )
     ORDER BY instance ASC
  `).all() as SharpeGateRow[];

  if (rows.length === 0) {
    return {
      box: 3,
      name: 'Regime Sharpe',
      status: 'warn',
      state: 'no_snapshots',
      detail: 'no Sharpe snapshots yet',
      current: 0,
      target: 60,
    };
  }

  const minDays = Math.min(...rows.map(row => row.n_days));
  const complete = rows.every(row => row.n_days >= 60 && (row.rolling_sharpe_60d ?? -Infinity) > 0);
  const detail = rows
    .map(row => `${row.instance} n_days=${row.n_days} sharpe=${row.rolling_sharpe_60d?.toFixed(2) ?? 'n/a'}`)
    .join('; ');

  return {
    box: 3,
    name: 'Regime Sharpe',
    status: complete ? 'pass' : 'warn',
    state: complete ? 'complete' : 'incomplete',
    detail,
    current: minDays,
    target: 60,
  };
}

export function summarizeHaltGate(db: Database.Database): GateProgressCheck {
  const halt = readKv(db, 'poly.halt');
  return {
    box: 4,
    name: 'Polymarket halt and drawdown',
    status: halt === '1' ? 'fail' : 'pass',
    state: halt === '1' ? 'halted' : 'clear',
    detail: halt === '1' ? "poly_kv['poly.halt'] is 1" : 'halt flag clear',
  };
}

export function collectGateProgress(db: Database.Database): GateProgressCheck[] {
  return [
    {
      box: 1,
      name: '30-day paper clock',
      status: 'warn',
      state: 'mission_review_required',
      detail: 'read MISSION.md sign-off log for operator-directed restart classification',
      target: 30,
    },
    summarizePolymarketResolvedGate(db),
    summarizeRegimeSharpeGate(db),
    summarizeHaltGate(db),
    {
      box: 5,
      name: 'P0/P1 review findings',
      status: 'warn',
      state: 'manual_review_required',
      detail: 'requires latest Codex or Claude review artifact confirmation',
    },
    {
      box: 6,
      name: 'Kill switch and rollback drill',
      status: 'warn',
      state: 'mission_review_required',
      detail: 'read MISSION.md and drill logs for latest tested status',
    },
    {
      box: 7,
      name: 'Operator sign-off',
      status: 'warn',
      state: 'pending',
      detail: 'Richard final written sign-off is still required before live money',
    },
  ];
}

