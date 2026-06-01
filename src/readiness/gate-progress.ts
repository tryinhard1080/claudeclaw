import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

export interface GateProgressOptions {
  projectRoot?: string;
  reviewFindingsText?: string | null;
  missionText?: string | null;
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

function readProjectText(projectRoot: string, relativePath: string): string | null {
  try {
    return readFileSync(join(projectRoot, relativePath), 'utf8');
  } catch {
    return null;
  }
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

export function summarizeReviewFindingsGate(findingsText: string | null | undefined): GateProgressCheck {
  if (!findingsText) {
    return {
      box: 5,
      name: 'P0/P1 review findings',
      status: 'warn',
      state: 'artifact_missing',
      detail: 'docs/codex-review/findings.md not readable',
    };
  }

  const rows = findingsText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line));
  const blocking = rows.filter(line => {
    const cols = line.split('|').map(col => col.trim());
    const severity = cols[3] || '';
    const status = (cols[5] || '').toLowerCase();
    if (!/^P[01]\b/.test(severity)) return false;
    return !/(fixed|closed|resolved)/.test(status);
  });

  return {
    box: 5,
    name: 'P0/P1 review findings',
    status: blocking.length === 0 ? 'pass' : 'fail',
    state: blocking.length === 0 ? 'clear' : 'blocking_findings',
    detail: blocking.length === 0
      ? 'review ledger shows zero unresolved P0/P1 findings'
      : `${blocking.length} unresolved P0/P1 finding(s) in docs/codex-review/findings.md`,
    current: blocking.length,
    target: 0,
  };
}

export function summarizeKillSwitchRollbackGate(missionText: string | null | undefined): GateProgressCheck {
  const checked = Boolean(missionText?.match(/-\s*\[x\]\s+Documented kill-switch and roll-back procedure tested/i));
  return {
    box: 6,
    name: 'Kill switch and rollback drill',
    status: checked ? 'pass' : 'warn',
    state: checked ? 'mission_checked' : 'mission_review_required',
    detail: checked
      ? 'MISSION.md marks kill-switch and rollback procedure tested'
      : 'read MISSION.md and drill logs for latest tested status',
  };
}

export function collectGateProgress(db: Database.Database, options: GateProgressOptions = {}): GateProgressCheck[] {
  const projectRoot = options.projectRoot ?? process.cwd();
  const reviewFindingsText = options.reviewFindingsText !== undefined
    ? options.reviewFindingsText
    : readProjectText(projectRoot, 'docs/codex-review/findings.md');
  const missionText = options.missionText !== undefined
    ? options.missionText
    : readProjectText(projectRoot, 'MISSION.md');

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
    summarizeReviewFindingsGate(reviewFindingsText),
    summarizeKillSwitchRollbackGate(missionText),
    {
      box: 7,
      name: 'Operator sign-off',
      status: 'warn',
      state: 'pending',
      detail: 'Richard final written sign-off is still required before live money',
    },
  ];
}
