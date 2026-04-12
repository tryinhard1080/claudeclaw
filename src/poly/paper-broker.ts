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
    return { status: 'aborted', reason: `db_error: ${String(err)}` };
  }
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
