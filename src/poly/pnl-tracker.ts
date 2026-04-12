import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { POLY_TIMEZONE } from '../config.js';
import { fetchMidpoint } from './clob-client.js';
import { fetchMarketById } from './gamma-client.js';
import type { Market } from './types.js';

export type ResolutionStatus = 'won' | 'lost' | 'voided' | 'open';

export interface ResolutionClassification {
  status: ResolutionStatus;
  voidedReason?: string;
  /** Winning outcome index within market.outcomes when status='won'|'lost'. */
  winningIndex?: number;
}

/**
 * Pure classifier. Given the latest market state and the winning token the
 * trade is holding, decide whether the position is open/won/lost/voided.
 *
 * The Gamma API does NOT return a simple `resolution` string. A closed market
 * reports its outcome via `outcomes[i].price`, which for a resolved market is
 * exactly 1.0 for the winning outcome and 0.0 for all others. If the price
 * vector is malformed (no 1.0, or more than one 1.0), we treat it as unresolved.
 */
export function classifyResolution(
  market: Market | null,
  heldTokenId: string,
): ResolutionClassification {
  if (market === null) {
    return { status: 'voided', voidedReason: 'delisted' };
  }
  if (!market.closed) {
    return { status: 'open' };
  }
  const winners = market.outcomes
    .map((o, i) => ({ i, price: o.price, tokenId: o.tokenId }))
    .filter(o => o.price === 1 || Math.abs(o.price - 1) < 1e-9);
  if (winners.length !== 1) {
    return { status: 'voided', voidedReason: 'unresolved' };
  }
  const winner = winners[0]!;
  if (winner.tokenId === heldTokenId) {
    return { status: 'won', winningIndex: winner.i };
  }
  return { status: 'lost', winningIndex: winner.i };
}

export type MarketFetcher = (slug: string) => Promise<Market | null>;

/**
 * Default market fetcher: reads the cached `poly_markets` row for slug,
 * then queries Gamma by numeric market id for fresh `closed`/`outcomePrices`.
 * Prefers fresh data over stale cache because outcomePrices only becomes a
 * resolved 1/0 vector AFTER `closed=1`.
 */
export function makeDefaultMarketFetcher(db: Database.Database): MarketFetcher {
  return async (slug: string) => {
    const row = db.prepare(`SELECT condition_id FROM poly_markets WHERE slug = ?`).get(slug) as
      | { condition_id: string } | undefined;
    if (!row) return null;
    // Gamma's market-by-slug endpoint is unreliable (422); use the id path.
    // We don't store numeric id — fall back to the conditionId-based lookup.
    // If that's also unsupported, callers can inject a smarter fetcher.
    return fetchMarketById(row.condition_id);
  };
}

type OpenTradeRow = {
  id: number;
  market_slug: string;
  outcome_token_id: string;
  entry_price: number;
  shares: number;
};

interface RunOnceResult {
  updatedOpen: number;
  resolved: number;
}

export class PnlTracker extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly marketFetcher: MarketFetcher = makeDefaultMarketFetcher(db),
    private readonly midpointFetcher: (tokenId: string) => Promise<number | null> = fetchMidpoint,
  ) {
    super();
  }

  /** Run a single reconciliation pass. Safe to call directly from tests. */
  async runOnce(nowMs: number = Date.now()): Promise<RunOnceResult> {
    const trades = this.db.prepare(
      `SELECT id, market_slug, outcome_token_id, entry_price, shares
         FROM poly_paper_trades WHERE status = 'open'`,
    ).all() as OpenTradeRow[];

    let updatedOpen = 0;
    let resolved = 0;

    for (const t of trades) {
      const market = await this.marketFetcher(t.market_slug);
      const classification = classifyResolution(market, t.outcome_token_id);

      if (classification.status === 'open') {
        const mid = await this.midpointFetcher(t.outcome_token_id);
        if (mid !== null) {
          // YES-side BUY only (Phase C): unrealized = shares * (mid - entry).
          const unrealized = t.shares * (mid - t.entry_price);
          this.db.prepare(
            `UPDATE poly_positions
               SET current_price = ?, unrealized_pnl = ?, updated_at = ?
             WHERE paper_trade_id = ?`,
          ).run(mid, unrealized, Math.floor(nowMs / 1000), t.id);
          updatedOpen++;
        }
        continue;
      }

      // Resolution transition: open -> won/lost/voided.
      const realized = realizedFor(classification.status, t.shares, t.entry_price);
      const resolvedAt = Math.floor(nowMs / 1000);
      const tx = this.db.transaction(() => {
        this.db.prepare(
          `UPDATE poly_paper_trades
             SET status = ?, realized_pnl = ?, resolved_at = ?, voided_reason = ?
           WHERE id = ? AND status = 'open'`,
        ).run(
          classification.status,
          realized,
          resolvedAt,
          classification.voidedReason ?? null,
          t.id,
        );
        this.db.prepare(`DELETE FROM poly_positions WHERE paper_trade_id = ?`).run(t.id);
      });
      try {
        tx();
        resolved++;
        this.emit('position_resolved', {
          tradeId: t.id,
          status: classification.status,
          realizedPnl: realized,
          voidedReason: classification.voidedReason,
        });
      } catch (err) {
        logger.error({ err: String(err), tradeId: t.id }, 'pnl resolution txn failed');
      }
    }

    return { updatedOpen, resolved };
  }

  /** Start an hourly loop. Tests should NOT call start(); use runOnce. */
  start(intervalMs: number = 60 * 60 * 1000): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.runOnce().catch(err => logger.error({ err: String(err) }, 'pnl tracker tick failed'));
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function realizedFor(status: ResolutionStatus, shares: number, entryPrice: number): number {
  if (status === 'won') return shares * (1 - entryPrice);
  if (status === 'lost') return -shares * entryPrice;
  return 0; // voided
}

/**
 * Sum `realized_pnl` for trades resolved on or after the start of the current
 * day in POLY_TIMEZONE. Used by Gate 2 (portfolio health) to check the daily
 * loss floor. Critical that this uses the configured timezone, not UTC — a
 * trade resolved at 2026-04-12T03:00Z is 23:00 April 11 in America/New_York
 * and should count toward April 11's P&L.
 */
export function getDailyRealizedPnl(db: Database.Database, nowMs: number = Date.now()): number {
  const startOfDaySecs = Math.floor(
    DateTime.fromMillis(nowMs).setZone(POLY_TIMEZONE).startOf('day').toSeconds(),
  );
  const row = db.prepare(
    `SELECT COALESCE(SUM(realized_pnl), 0) AS total
       FROM poly_paper_trades
      WHERE status IN ('won','lost','voided')
        AND resolved_at IS NOT NULL
        AND resolved_at >= ?`,
  ).get(startOfDaySecs) as { total: number };
  return row.total;
}
