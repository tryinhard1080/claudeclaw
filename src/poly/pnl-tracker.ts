import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import {
  POLY_TIMEZONE,
  POLY_EXIT_ENABLED, POLY_TAKE_PROFIT_PCT, POLY_STOP_LOSS_PCT,
} from '../config.js';
import { fetchMidpoint } from './clob-client.js';
import { fetchMarketBySlug } from './gamma-client.js';
import { exitPosition, shouldExit, type ExitReason } from './paper-broker.js';
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
 * Sprint 29 — reconstruct a `Market` from a `poly_resolutions` cache row.
 *
 * The cache is populated by the resolution-fetch cron (see
 * `scripts/fetch-resolutions.ts`) and stores the last-observed outcomes vector
 * plus a `closed` flag. When Polymarket delists a market shortly after
 * settlement (~30-60 min after resolution), `fetchMarketBySlug` starts
 * returning null even though the market DID resolve. The cache retains the
 * final `price=1.0`/`price=0.0` vector we need for classification.
 *
 * Only the fields `classifyResolution` reads are populated:
 *   - slug (identity)
 *   - closed (from cache)
 *   - outcomes[].price + tokenId (from outcomes_json)
 *
 * All other Market fields get placeholder values. Do not use the return of
 * this function for anything other than resolution classification.
 *
 * Returns null when no cache row exists for the slug.
 */
export function readMarketFromCache(
  db: Database.Database,
  slug: string,
): Market | null {
  const row = db.prepare(
    `SELECT closed, outcomes_json FROM poly_resolutions WHERE slug = ?`,
  ).get(slug) as { closed: number; outcomes_json: string } | undefined;
  if (!row) return null;

  let parsed: Array<{ label: string; tokenId: string; price: number }>;
  try {
    parsed = JSON.parse(row.outcomes_json) as Array<{ label: string; tokenId: string; price: number }>;
  } catch (err) {
    logger.warn({ slug, err: String(err) }, 'poly_resolutions outcomes_json parse failed');
    return null;
  }

  return {
    slug,
    conditionId: '', // not persisted on the cache row; unused by classifyResolution
    question: '',   // ditto
    outcomes: parsed.map(o => ({ label: o.label, tokenId: o.tokenId, price: o.price })),
    volume24h: 0,
    liquidity: 0,
    endDate: 0,
    closed: row.closed === 1,
  };
}

export interface DefaultMarketFetcherOptions {
  /**
   * Live-fetch override, for testing. Defaults to gamma-client's
   * `fetchMarketBySlug`. Production callers should NOT pass this — it's
   * the injection seam for unit tests that need to simulate a delisted
   * (live=null) response without touching the network.
   */
  liveFetch?: (slug: string) => Promise<Market | null>;
}

/**
 * Default market fetcher — Sprint 29 cache-aware chain:
 *   1. Live Gamma via `fetchMarketBySlug` (preferred).
 *   2. On null, fall back to `poly_resolutions` cache (readMarketFromCache).
 *   3. On both null, return null (caller will void-as-delisted downstream).
 *
 * The pre-Sprint-29 body returned `fetchMarketBySlug(slug)` only, which meant
 * every market Polymarket delisted post-settlement voided the position with
 * `voided_reason='delisted'` — a 100% miss on real wins/losses. The `_db`
 * parameter was pre-baked for this fix; Sprint 29 wired it up.
 */
export function makeDefaultMarketFetcher(
  db: Database.Database,
  opts: DefaultMarketFetcherOptions = {},
): MarketFetcher {
  const liveFetch = opts.liveFetch ?? fetchMarketBySlug;
  return async (slug: string): Promise<Market | null> => {
    const live = await liveFetch(slug);
    if (live !== null) return live;
    return readMarketFromCache(db, slug);
  };
}

type OpenTradeRow = {
  id: number;
  market_slug: string;
  outcome_token_id: string;
  outcome_label: string;
  entry_price: number;
  shares: number;
};

export interface PositionResolvedEvent {
  tradeId: number;
  slug: string;
  outcomeLabel: string;
  status: Exclude<ResolutionStatus, 'open'>;
  realizedPnl: number;
  voidedReason?: string;
}

export interface PositionExitedEvent {
  tradeId: number;
  slug: string;
  outcomeLabel: string;
  reason: ExitReason;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
}

export interface PnlTrackerOptions {
  exitEnabled?: boolean;
  takeProfitPct?: number;
  stopLossPct?: number;
}

interface RunOnceResult {
  updatedOpen: number;
  resolved: number;
  exited: number;
}

export class PnlTracker extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private readonly exitEnabled: boolean;
  private readonly takeProfitPct: number;
  private readonly stopLossPct: number;

  constructor(
    private readonly db: Database.Database,
    private readonly marketFetcher: MarketFetcher = makeDefaultMarketFetcher(db),
    private readonly midpointFetcher: (tokenId: string) => Promise<number | null> = fetchMidpoint,
    opts: PnlTrackerOptions = {},
  ) {
    super();
    this.exitEnabled = opts.exitEnabled ?? POLY_EXIT_ENABLED;
    this.takeProfitPct = opts.takeProfitPct ?? POLY_TAKE_PROFIT_PCT;
    this.stopLossPct = opts.stopLossPct ?? POLY_STOP_LOSS_PCT;
  }

  /** Run a single reconciliation pass. Safe to call directly from tests. */
  async runOnce(nowMs: number = Date.now()): Promise<RunOnceResult> {
    const trades = this.db.prepare(
      `SELECT id, market_slug, outcome_token_id, outcome_label, entry_price, shares
         FROM poly_paper_trades WHERE status = 'open'`,
    ).all() as OpenTradeRow[];

    let updatedOpen = 0;
    let resolved = 0;
    let exited = 0;

    for (const t of trades) {
      const market = await this.marketFetcher(t.market_slug);
      const classification = classifyResolution(market, t.outcome_token_id);

      if (classification.status === 'open') {
        const mid = await this.midpointFetcher(t.outcome_token_id);
        if (mid !== null) {
          // Sprint 8: before updating unrealized, check exit conditions. A
          // resolved-to-won/lost classification always takes precedence over
          // an exit (we're in the `open` branch here, so that's fine).
          if (this.exitEnabled) {
            const exit = shouldExit({
              entryPrice: t.entry_price, currentPrice: mid,
              takeProfitPct: this.takeProfitPct, stopLossPct: this.stopLossPct,
            });
            if (exit !== null) {
              const res = exitPosition(this.db, t.id, mid, exit.reason, nowMs);
              if (res.status === 'exited') {
                exited++;
                this.emit('position_exited', {
                  tradeId: t.id, slug: t.market_slug, outcomeLabel: t.outcome_label,
                  reason: exit.reason, entryPrice: t.entry_price, exitPrice: mid,
                  realizedPnl: res.realizedPnl ?? 0,
                } satisfies PositionExitedEvent);
              }
              continue;
            }
          }
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
      // The UPDATE is guarded `WHERE status='open'` so a concurrent caller
      // that already flipped the row sees changes=0; we only count + emit
      // when THIS call actually wrote, preventing duplicate alerts.
      const realized = realizedFor(classification.status, t.shares, t.entry_price);
      const resolvedAt = Math.floor(nowMs / 1000);
      const tx = this.db.transaction((): number => {
        const update = this.db.prepare(
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
        if (update.changes !== 1) return 0;
        this.db.prepare(`DELETE FROM poly_positions WHERE paper_trade_id = ?`).run(t.id);
        return 1;
      });
      try {
        const changed = tx();
        if (changed === 1) {
          resolved++;
          this.emit('position_resolved', {
            tradeId: t.id,
            slug: t.market_slug,
            outcomeLabel: t.outcome_label,
            status: classification.status,
            realizedPnl: realized,
            voidedReason: classification.voidedReason,
          } satisfies PositionResolvedEvent);
        }
      } catch (err) {
        logger.error({ err: String(err), tradeId: t.id }, 'pnl resolution txn failed');
      }
    }

    return { updatedOpen, resolved, exited };
  }

  /**
   * Start an hourly loop. Fires one immediate reconciliation so a restart
   * doesn't leave positions stale for up to an hour — resolved markets would
   * otherwise still count toward openPositionCount/deployedUsd and block
   * valid signals in the next scan_complete tick. Tests should NOT call
   * start(); use runOnce directly for determinism.
   */
  start(intervalMs: number = 60 * 60 * 1000): void {
    if (this.timer !== null) return;
    void this.runOnce().catch(err =>
      logger.error({ err: String(err) }, 'pnl tracker startup reconciliation failed'));
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

/**
 * Sprint 29 — exported for backfill script reuse (single source of truth for
 * paper-broker payout arithmetic). Called both from `runOnce` at trade
 * resolution and from `scripts/backfill-voided-resolutions.ts` when we
 * re-classify a previously-voided trade against the cache.
 */
export function realizedFor(status: ResolutionStatus, shares: number, entryPrice: number): number {
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
      WHERE status IN ('won','lost','voided','exited')
        AND resolved_at IS NOT NULL
        AND resolved_at >= ?`,
  ).get(startOfDaySecs) as { total: number };
  return row.total;
}
