import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import type { Signal } from './types.js';

export interface SignalWithId extends Signal {
  /** `poly_signals.id` of the pre-inserted signal row. */
  id: number;
  /** Dollar size computed by the sizing step (Fractional Kelly). */
  sizeUsd: number;
  /** 1/4 Kelly fraction actually used (for book-keeping). */
  kellyFraction: number;
  /** Strategy tag, e.g. 'ai-probability'. */
  strategy: string;
}

export type ExecuteStatus = 'filled' | 'aborted';

export interface ExecuteResult {
  status: ExecuteStatus;
  tradeId?: number;
  reason?: string;
}

const DRIFT_LIMIT = 0.03;

/**
 * Simulate a paper fill at `currentBestAsk`. Performs a Gate 3-style re-validation
 * (price drift + empty asks) on the latest snapshot before any DB write; if the
 * snapshot is stale, the original poly_signals row is stamped with
 * `orderbook_changed_at_exec` (or `empty_asks`) and no paper trade is written.
 *
 * Single writer for `poly_paper_trades` on `status='open'`. All three writes
 * (paper_trade + position + signal link) happen inside one db.transaction()
 * so a failure on any step leaves no partial state.
 */
export function execute(
  db: Database.Database,
  signal: SignalWithId,
  currentBestAsk: number | null,
  askDepthShares: number,
): ExecuteResult {
  // 1. Validate orderbook snapshot.
  if (currentBestAsk === null || askDepthShares <= 0) {
    abortSignal(db, signal.id, 'empty_asks');
    return { status: 'aborted', reason: 'empty_asks' };
  }
  const drift = Math.abs(currentBestAsk - signal.marketPrice) / signal.marketPrice;
  if (drift > DRIFT_LIMIT) {
    abortSignal(db, signal.id, 'orderbook_changed_at_exec');
    return { status: 'aborted', reason: 'orderbook_changed_at_exec' };
  }

  // 2. Compute shares (round DOWN to 2 decimals to avoid overspend).
  const shares = Math.floor((signal.sizeUsd / currentBestAsk) * 100) / 100;
  if (shares <= 0) {
    abortSignal(db, signal.id, 'size_too_small');
    return { status: 'aborted', reason: 'size_too_small' };
  }

  const now = Math.floor(Date.now() / 1000);
  const entryPrice = currentBestAsk;

  // 3. Transactional write: insert trade, insert position, link signal.
  const txn = db.transaction(() => {
    const tradeInsert = db.prepare(`
      INSERT INTO poly_paper_trades
        (created_at, market_slug, outcome_token_id, outcome_label, side,
         entry_price, size_usd, shares, kelly_fraction, strategy, status)
      VALUES (?, ?, ?, ?, 'BUY', ?, ?, ?, ?, ?, 'open')
    `).run(
      now,
      signal.marketSlug,
      signal.outcomeTokenId,
      signal.outcomeLabel,
      entryPrice,
      signal.sizeUsd,
      shares,
      signal.kellyFraction,
      signal.strategy,
    );
    const tradeId = Number(tradeInsert.lastInsertRowid);

    db.prepare(`
      INSERT INTO poly_positions
        (paper_trade_id, market_slug, current_price, unrealized_pnl, updated_at)
      VALUES (?, ?, ?, 0, ?)
    `).run(tradeId, signal.marketSlug, entryPrice, now);

    db.prepare(`
      UPDATE poly_signals SET paper_trade_id = ? WHERE id = ?
    `).run(tradeId, signal.id);

    return tradeId;
  });

  try {
    const tradeId = txn();
    logger.info({ tradeId, slug: signal.marketSlug, shares, entryPrice }, 'paper trade filled');
    return { status: 'filled', tradeId };
  } catch (err) {
    logger.error({ err: String(err), signalId: signal.id }, 'paper broker transaction failed');
    // Flip the signal row back to rejected so /poly signals + approval metrics
    // don't count an orphaned approved=1 row with no paper_trade_id.
    abortSignal(db, signal.id, `db_error: ${String(err)}`);
    return { status: 'aborted', reason: `db_error: ${String(err)}` };
  }
}

export type ExitReason = 'take_profit' | 'stop_loss';

export interface ShouldExitArgs {
  entryPrice: number;
  currentPrice: number;
  takeProfitPct: number;
  stopLossPct: number;
}

/**
 * Sprint 8: pure exit-condition check on a YES-side BUY.
 *   unrealized pct = (currentPrice - entryPrice) / entryPrice
 * Take-profit fires first if both thresholds are somehow crossed (shouldn't
 * be possible on a single tick, but deterministic order matters).
 *
 * Degenerate entryPrice (<=0) returns null — can't compute a percentage.
 * Negative take-profit or stop-loss values are treated as disabled (0).
 */
export function shouldExit(args: ShouldExitArgs): { reason: ExitReason } | null {
  const { entryPrice, currentPrice } = args;
  if (entryPrice <= 0 || !Number.isFinite(entryPrice)) return null;
  if (!Number.isFinite(currentPrice)) return null;
  const tp = Math.max(0, args.takeProfitPct);
  const sl = Math.max(0, args.stopLossPct);
  const pct = (currentPrice - entryPrice) / entryPrice;
  if (tp > 0 && pct >= tp) return { reason: 'take_profit' };
  if (sl > 0 && pct <= -sl) return { reason: 'stop_loss' };
  return null;
}

export interface ExitResult {
  status: 'exited' | 'skipped';
  realizedPnl?: number;
  reason?: string;
}

/**
 * Close an open paper position at `exitPrice`. Realized P&L for a YES BUY:
 *   shares * (exitPrice - entryPrice)
 * Uses `status='exited'` plus `voided_reason='exit:<reason>'`. Calibration
 * and A/B compare queries filter on `status IN ('won','lost')` so exited
 * trades are auto-excluded from Brier math — correct semantics, since we
 * don't know the counterfactual outcome.
 *
 * The UPDATE is guarded `WHERE status='open'` so a concurrent resolver
 * can't double-close a trade. Returns status='skipped' if the trade is
 * already non-open.
 */
export function exitPosition(
  db: Database.Database,
  tradeId: number,
  exitPrice: number,
  reason: ExitReason,
  nowMs: number = Date.now(),
): ExitResult {
  const trade = db.prepare(
    `SELECT shares, entry_price, status FROM poly_paper_trades WHERE id = ?`,
  ).get(tradeId) as { shares: number; entry_price: number; status: string } | undefined;
  if (!trade) return { status: 'skipped', reason: 'trade_not_found' };
  if (trade.status !== 'open') return { status: 'skipped', reason: `status=${trade.status}` };

  const realized = trade.shares * (exitPrice - trade.entry_price);
  const resolvedAt = Math.floor(nowMs / 1000);
  const voidedReason = `exit:${reason}`;

  const tx = db.transaction((): number => {
    const update = db.prepare(
      `UPDATE poly_paper_trades
          SET status = 'exited', realized_pnl = ?, resolved_at = ?, voided_reason = ?
        WHERE id = ? AND status = 'open'`,
    ).run(realized, resolvedAt, voidedReason, tradeId);
    if (update.changes !== 1) return 0;
    db.prepare(`DELETE FROM poly_positions WHERE paper_trade_id = ?`).run(tradeId);
    return 1;
  });
  const changed = tx();
  if (changed !== 1) return { status: 'skipped', reason: 'concurrent_close' };
  logger.info({ tradeId, exitPrice, realized, reason }, 'paper position exited');
  return { status: 'exited', realizedPnl: realized, reason };
}

function abortSignal(db: Database.Database, signalId: number, reason: string): void {
  try {
    const reasonsJson = JSON.stringify([{ gate: 'exec_revalidation', reason }]);
    db.prepare(`
      UPDATE poly_signals
      SET approved = 0, rejection_reasons = ?
      WHERE id = ?
    `).run(reasonsJson, signalId);
  } catch (err) {
    logger.warn({ err: String(err), signalId }, 'abortSignal update failed');
  }
}
