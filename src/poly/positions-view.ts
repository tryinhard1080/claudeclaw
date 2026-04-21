import type Database from 'better-sqlite3';

export interface PositionRow {
  trade_id: number;
  created_at: number;
  market_slug: string;
  outcome_label: string;
  side: string;
  entry_price: number;
  size_usd: number;
  shares: number;
  current_price: number | null;
  unrealized_pnl: number | null;
  unrealized_pct: number | null;
  updated_at: number | null;
  age_hours: number;
}

export interface PositionsAggregate {
  open_count: number;
  total_open_exposure_usd: number;
  total_unrealized_pnl: number;
  total_unrealized_pct_of_exposure: number | null;
  last_tick_at: number | null;
}

export interface PositionsLivePayload {
  positions: PositionRow[];
  aggregate: PositionsAggregate;
}

interface JoinedRow {
  trade_id: number;
  created_at: number;
  market_slug: string;
  outcome_label: string;
  side: string;
  entry_price: number;
  size_usd: number;
  shares: number;
  current_price: number | null;
  unrealized_pnl: number | null;
  updated_at: number | null;
}

const MAX_ROWS = 200;

export function buildPositionsLivePayload(
  db: Database.Database,
  nowSec: number = Math.floor(Date.now() / 1000),
): PositionsLivePayload {
  const rows = db.prepare(`
    SELECT
      t.id               AS trade_id,
      t.created_at       AS created_at,
      t.market_slug      AS market_slug,
      t.outcome_label    AS outcome_label,
      t.side             AS side,
      t.entry_price      AS entry_price,
      t.size_usd         AS size_usd,
      t.shares           AS shares,
      p.current_price    AS current_price,
      p.unrealized_pnl   AS unrealized_pnl,
      p.updated_at       AS updated_at
    FROM poly_paper_trades t
    LEFT JOIN poly_positions p ON p.paper_trade_id = t.id
    WHERE t.status = 'open'
    ORDER BY t.id DESC
    LIMIT ?
  `).all(MAX_ROWS) as JoinedRow[];

  const positions: PositionRow[] = rows.map((r) => {
    const ageHours = Math.round(((nowSec - r.created_at) / 3600) * 10) / 10;
    const unrealizedPct =
      r.unrealized_pnl !== null && r.size_usd > 0
        ? r.unrealized_pnl / r.size_usd
        : null;
    return {
      trade_id: r.trade_id,
      created_at: r.created_at,
      market_slug: r.market_slug,
      outcome_label: r.outcome_label,
      side: r.side,
      entry_price: r.entry_price,
      size_usd: r.size_usd,
      shares: r.shares,
      current_price: r.current_price,
      unrealized_pnl: r.unrealized_pnl,
      unrealized_pct: unrealizedPct,
      updated_at: r.updated_at,
      age_hours: ageHours,
    };
  });

  const totalExposure = positions.reduce((s, p) => s + p.size_usd, 0);
  const totalUnrealized = positions.reduce((s, p) => s + (p.unrealized_pnl ?? 0), 0);
  const totalPct = totalExposure > 0 ? totalUnrealized / totalExposure : null;
  const tickTimes = positions
    .map((p) => p.updated_at)
    .filter((t): t is number => t !== null);
  const lastTickAt = tickTimes.length > 0 ? Math.max(...tickTimes) : null;

  return {
    positions,
    aggregate: {
      open_count: positions.length,
      total_open_exposure_usd: totalExposure,
      total_unrealized_pnl: totalUnrealized,
      total_unrealized_pct_of_exposure: totalPct,
      last_tick_at: lastTickAt,
    },
  };
}
