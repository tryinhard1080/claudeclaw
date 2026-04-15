import { EventEmitter } from 'events';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import {
  POLY_KELLY_FRACTION, POLY_MAX_TRADE_USD, POLY_MIN_VOLUME_USD,
  POLY_MIN_TTR_HOURS, POLY_PAPER_CAPITAL, POLY_MODEL,
  POLY_MIN_MARKET_PRICE, POLY_MAX_MARKET_PRICE,
  POLY_REFLECTION_ENABLED,
  POLY_KELLY_LOW_MULT, POLY_KELLY_MED_MULT, POLY_KELLY_HIGH_MULT,
} from '../config.js';
import type { Market, Signal, ProbabilityEstimate } from './types.js';
import { bestAskAndDepth, fetchBook } from './clob-client.js';
import { computeEdgePct, evaluateMarket, PROMPT_VERSION } from './strategies/ai-probability.js';
import {
  applyReflectionRule, REFLECT_PROMPT_VERSION, runCritic,
  type CriticJudgment,
} from './strategies/ai-probability-reflect.js';
import {
  runAllGates, defaultGateConfig, positionKey,
  type GateConfig, type PortfolioSnapshot, type OrderbookSnapshot, type GateRejection,
} from './risk-gates.js';
import { execute, type SignalWithId } from './paper-broker.js';
import { getDailyRealizedPnl } from './pnl-tracker.js';
import { latestRegimeSnapshot } from './regime.js';

const STRATEGY = 'ai-probability';
const HALT_KEY = 'poly.halt';

export interface EvaluateFn {
  (args: {
    market: Market; outcome: Market['outcomes'][number];
    bestAsk: number; bestBid: number | null;
    spreadPct: number | null; askDepthUsd: number;
    db: Database.Database;
  }): Promise<ProbabilityEstimate | null>;
}

export interface CriticFn {
  (args: {
    question: string; category: string | null; endDateSec: number; ask: number;
    initial: ProbabilityEstimate;
  }): Promise<CriticJudgment | null>;
}

export interface StrategyEngineOptions {
  db: Database.Database;
  scanner: EventEmitter;
  paperCapital?: number;
  minVolumeUsd?: number;
  minTtrHours?: number;
  topN?: number;
  maxTradeUsd?: number;
  kellyFraction?: number;
  minYesPrice?: number;
  maxYesPrice?: number;
  gateConfig?: GateConfig;
  evaluate?: EvaluateFn;
  fetchBook?: (tokenId: string) => Promise<ReturnType<typeof emptyBook> | import('./types.js').ClobBook | null>;
  now?: () => number;
  /** Sprint 2.5: when true, primary evaluations trigger a shadow reflection signal. */
  reflectionEnabled?: boolean;
  /** Sprint 2.5: injectable critic for tests. */
  critic?: CriticFn;
  /** Sprint 7: confidence-weighted Kelly multipliers. Defaults from config. */
  confidenceMults?: ConfidenceMultipliers;
}

function emptyBook() {
  return { bids: [], asks: [] } as import('./types.js').ClobBook;
}

export interface ConfidenceMultipliers {
  low: number;
  medium: number;
  high: number;
}

/**
 * Sprint 7: map the strategy's confidence enum to a Kelly multiplier.
 * Clamps each bucket to [0, 1] — values above 1 would let a 'high'-
 * confidence signal bet more than fractional Kelly intends, which breaks
 * the Sprint 2.5 contradiction path (it forces confidence='low' as the
 * risk-reduction signal; higher-than-1 multipliers undo that).
 */
export function confidenceMultiplier(
  confidence: 'low' | 'medium' | 'high',
  mults: ConfidenceMultipliers,
): number {
  const raw = confidence === 'high' ? mults.high
            : confidence === 'medium' ? mults.medium
            : mults.low;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, 1);
}

export interface KellyArgs {
  probability: number;
  ask: number;
  kellyFraction: number;
  paperCapital: number;
  maxTradeUsd: number;
  /** Sprint 7: scales kellyFraction. Defaults to 1 (backward-compatible). */
  confidenceMult?: number;
}

/**
 * Fractional Kelly for a binary YES bet.
 *   full Kelly f* = (p - ask) / (1 - ask)
 *   size_usd     = kellyFraction * confidenceMult * f* * paperCapital
 *                  clamped to [0, maxTradeUsd]
 * Degenerate asks (>= 1, <= 0) and non-positive edge return 0 so the caller
 * skips the trade without running gates. confidenceMult defaults to 1 so
 * callers that don't pass it (older tests, CLI scripts) retain old behavior.
 */
export function computeKellySize(args: KellyArgs): number {
  const { probability, ask, kellyFraction, paperCapital, maxTradeUsd } = args;
  const mult = args.confidenceMult ?? 1;
  if (ask >= 1 || ask <= 0) return 0;
  if (mult <= 0) return 0;
  const edge = probability - ask;
  if (edge <= 0) return 0;
  const kStar = edge / (1 - ask);
  const raw = kellyFraction * mult * kStar * paperCapital;
  return Math.min(Math.max(raw, 0), maxTradeUsd);
}

export interface SignalFilledEvent {
  signalId: number;
  tradeId: number;
  slug: string;
  outcomeLabel: string;
  probability: number;
  bestAsk: number;
  edgePct: number;
  sizeUsd: number;
  confidence: string;
  reasoning: string;
}

export interface SignalRejectedEvent {
  slug: string;
  outcomeLabel: string;
  bestAsk: number;
  probability: number;
  edgePct: number;
  rejections: GateRejection[];
}

export class StrategyEngine extends EventEmitter {
  private readonly db: Database.Database;
  private readonly paperCapital: number;
  private readonly minVolumeUsd: number;
  private readonly minTtrHours: number;
  private readonly topN: number;
  private readonly maxTradeUsd: number;
  private readonly kellyFraction: number;
  private readonly minYesPrice: number;
  private readonly maxYesPrice: number;
  private readonly gateConfig: GateConfig;
  private readonly evaluate: EvaluateFn;
  private readonly fetchBookFn: NonNullable<StrategyEngineOptions['fetchBook']>;
  private readonly now: () => number;
  private readonly reflectionEnabled: boolean;
  private readonly critic: CriticFn;
  private readonly confidenceMults: ConfidenceMultipliers;
  private running = false;

  constructor(opts: StrategyEngineOptions) {
    super();
    this.db = opts.db;
    this.paperCapital = opts.paperCapital ?? POLY_PAPER_CAPITAL;
    this.minVolumeUsd = opts.minVolumeUsd ?? POLY_MIN_VOLUME_USD;
    this.minTtrHours = opts.minTtrHours ?? POLY_MIN_TTR_HOURS;
    this.topN = opts.topN ?? 20;
    this.maxTradeUsd = opts.maxTradeUsd ?? POLY_MAX_TRADE_USD;
    this.kellyFraction = opts.kellyFraction ?? POLY_KELLY_FRACTION;
    this.minYesPrice = opts.minYesPrice ?? POLY_MIN_MARKET_PRICE;
    this.maxYesPrice = opts.maxYesPrice ?? POLY_MAX_MARKET_PRICE;
    this.gateConfig = opts.gateConfig ?? defaultGateConfig();
    this.evaluate = opts.evaluate ?? (args => evaluateMarket(args));
    this.fetchBookFn = opts.fetchBook ?? fetchBook;
    this.now = opts.now ?? Date.now;
    this.reflectionEnabled = opts.reflectionEnabled ?? POLY_REFLECTION_ENABLED;
    this.critic = opts.critic ?? runCritic;
    this.confidenceMults = opts.confidenceMults ?? {
      low: POLY_KELLY_LOW_MULT, medium: POLY_KELLY_MED_MULT, high: POLY_KELLY_HIGH_MULT,
    };

    // poly_kv isn't in the v1.2.0 migration — create on demand so the halt
    // switch works on fresh DBs without a new migration bump.
    this.db.exec(`CREATE TABLE IF NOT EXISTS poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

    opts.scanner.on('scan_complete', (payload: { markets: Market[] }) => {
      this.onScanComplete(payload).catch(err =>
        logger.error({ err: String(err) }, 'strategy engine tick failed'));
    });
  }

  isHalted(): boolean {
    const row = this.db.prepare(`SELECT value FROM poly_kv WHERE key = ?`).get(HALT_KEY) as
      | { value: string } | undefined;
    return row?.value === '1';
  }

  async onScanComplete(payload: { markets: Market[] }): Promise<void> {
    if (this.running) return;
    if (this.isHalted()) {
      logger.info('strategy engine: halt flag set, skipping cycle');
      return;
    }
    this.running = true;
    try {
      const candidates = this.selectCandidates(payload.markets);
      for (const market of candidates) {
        await this.processMarket(market).catch(err =>
          logger.warn({ err: String(err), slug: market.slug }, 'processMarket failed'));
      }
    } finally {
      this.running = false;
    }
  }

  private selectCandidates(markets: Market[]): Market[] {
    const nowSec = Math.floor(this.now() / 1000);
    const minEnd = nowSec + this.minTtrHours * 3600;
    // Sprint 5.5: band filter on YES price. Excludes long-shot tails
    // (<minYesPrice) and near-certainties (>maxYesPrice) where the LLM
    // has no meaningful edge over the market. Markets without a YES
    // outcome are skipped — matches processMarket's existing behavior.
    return markets
      .filter(m => {
        if (m.closed) return false;
        if (m.volume24h < this.minVolumeUsd) return false;
        if (m.endDate < minEnd) return false;
        const yes = m.outcomes.find(o => o.label.toLowerCase() === 'yes');
        if (!yes) return false;
        if (yes.price < this.minYesPrice || yes.price > this.maxYesPrice) return false;
        return true;
      })
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, this.topN);
  }

  private async processMarket(market: Market): Promise<void> {
    const yesOutcome = market.outcomes.find(o => o.label.toLowerCase() === 'yes');
    if (!yesOutcome) return;

    const book = await this.fetchBookFn(yesOutcome.tokenId);
    if (!book) return;
    const { bestAsk, askDepthShares } = bestAskAndDepth(book);
    if (bestAsk === null) return;
    const bestBid = book.bids.length > 0 ? book.bids[0]!.price : null;
    const spreadPct = bestBid !== null ? ((bestAsk - bestBid) / bestAsk) * 100 : null;
    const askDepthUsd = askDepthShares * bestAsk;

    const est = await this.evaluate({
      market, outcome: yesOutcome, bestAsk, bestBid, spreadPct, askDepthUsd, db: this.db,
    });
    if (!est) return;

    const edgePct = computeEdgePct(est.probability, bestAsk);
    const confMult = confidenceMultiplier(est.confidence, this.confidenceMults);
    const sizeUsd = computeKellySize({
      probability: est.probability, ask: bestAsk,
      kellyFraction: this.kellyFraction, paperCapital: this.paperCapital,
      maxTradeUsd: this.maxTradeUsd,
      confidenceMult: confMult,
    });
    if (sizeUsd <= 0) return;

    const signal: Signal = {
      marketSlug: market.slug, outcomeTokenId: yesOutcome.tokenId,
      outcomeLabel: yesOutcome.label, marketPrice: bestAsk,
      estimatedProb: est.probability, edgePct,
      confidence: est.confidence, reasoning: est.reasoning,
      contrarian: est.contrarian,
    };

    const portfolio = this.buildPortfolioSnapshot();
    const orderbook: OrderbookSnapshot = { bestAsk, askDepthShares };
    const gates = runAllGates({
      signal, market, portfolio, orderbook, sizeUsd, now: this.now(), config: this.gateConfig,
    });

    const signalId = this.insertSignal(signal, gates.passed, gates.rejections);

    // Sprint 2.5: shadow-log reflection pass (when enabled). Runs regardless
    // of primary gate outcome — a rejected primary still produces a shadow
    // row, which lets us measure how reflection would have altered the
    // estimate on rejected markets once they resolve. Shadow writes never
    // drive trades; they exist only for A/B Brier comparison.
    if (this.reflectionEnabled) {
      await this.writeShadowReflection(market, yesOutcome, bestAsk, est);
    }

    if (!gates.passed) {
      this.emit('signal_rejected', {
        slug: market.slug, outcomeLabel: yesOutcome.label, bestAsk,
        probability: est.probability, edgePct, rejections: gates.rejections,
      } satisfies SignalRejectedEvent);
      return;
    }

    const withId: SignalWithId = {
      ...signal, id: signalId, sizeUsd,
      kellyFraction: this.kellyFraction, strategy: STRATEGY,
    };
    const res = execute(this.db, withId, bestAsk, askDepthShares);
    if (res.status === 'filled' && res.tradeId !== undefined) {
      this.emit('signal_filled', {
        signalId, tradeId: res.tradeId, slug: market.slug,
        outcomeLabel: yesOutcome.label, probability: est.probability, bestAsk,
        edgePct, sizeUsd, confidence: est.confidence, reasoning: est.reasoning,
      } satisfies SignalFilledEvent);
    } else {
      logger.info({ slug: market.slug, reason: res.reason }, 'signal approved but execution aborted');
    }
  }

  private async writeShadowReflection(
    market: Market,
    outcome: Market['outcomes'][number],
    bestAsk: number,
    primary: ProbabilityEstimate,
  ): Promise<void> {
    let reflected: ProbabilityEstimate;
    try {
      const judgment = await this.critic({
        question: market.question,
        category: market.category ?? null,
        endDateSec: market.endDate,
        ask: bestAsk,
        initial: primary,
      });
      reflected = judgment === null ? primary : applyReflectionRule(primary, judgment, bestAsk);
    } catch (err) {
      logger.warn({ err: String(err), slug: market.slug }, 'reflection critic threw — shadow falls back to primary');
      reflected = primary;
    }

    const edgePct = computeEdgePct(reflected.probability, bestAsk);
    const nowSec = Math.floor(this.now() / 1000);
    const regime = latestRegimeSnapshot(this.db);
    // Shadow row: approved=0, rejection_reasons='shadow:reflect', no trade link.
    // compareStrategiesOnResolutions ignores approved/rejection_reasons and pairs
    // purely on (slug, tokenId, prompt_version). Voided/open markets excluded
    // at resolve time.
    this.db.prepare(`
      INSERT INTO poly_signals
        (created_at, market_slug, outcome_token_id, outcome_label, market_price,
         estimated_prob, edge_pct, confidence, reasoning, contrarian, approved,
         rejection_reasons, prompt_version, model, regime_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'shadow:reflect', ?, ?, ?)
    `).run(
      nowSec, market.slug, outcome.tokenId, outcome.label,
      bestAsk, reflected.probability, edgePct,
      reflected.confidence, reflected.reasoning, reflected.contrarian ?? null,
      REFLECT_PROMPT_VERSION, POLY_MODEL, regime?.regimeLabel ?? null,
    );
  }

  private insertSignal(signal: Signal, approved: boolean, rejections: GateRejection[]): number {
    const nowSec = Math.floor(this.now() / 1000);
    // Sprint 3 regime: tag with the latest regime snapshot at signal time so
    // calibration can later bucket Brier by macro regime. Null-safe when no
    // snapshot has been taken yet (first ticks after cold start).
    const regime = latestRegimeSnapshot(this.db);
    // prompt_version + model (Sprint 2 versioning) let us A/B compare
    // strategy variants on the overlap set using Sprint 1's Brier metric.
    const info = this.db.prepare(`
      INSERT INTO poly_signals
        (created_at, market_slug, outcome_token_id, outcome_label, market_price,
         estimated_prob, edge_pct, confidence, reasoning, contrarian, approved,
         rejection_reasons, prompt_version, model, regime_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nowSec, signal.marketSlug, signal.outcomeTokenId, signal.outcomeLabel,
      signal.marketPrice, signal.estimatedProb, signal.edgePct,
      signal.confidence, signal.reasoning, signal.contrarian ?? null,
      approved ? 1 : 0, rejections.length > 0 ? JSON.stringify(rejections) : null,
      PROMPT_VERSION, POLY_MODEL, regime?.regimeLabel ?? null,
    );
    return Number(info.lastInsertRowid);
  }

  private buildPortfolioSnapshot(): PortfolioSnapshot {
    const openRows = this.db.prepare(`
      SELECT t.market_slug, t.outcome_token_id, t.size_usd, p.unrealized_pnl
        FROM poly_paper_trades t
        LEFT JOIN poly_positions p ON p.paper_trade_id = t.id
       WHERE t.status = 'open'
    `).all() as Array<{ market_slug: string; outcome_token_id: string; size_usd: number; unrealized_pnl: number | null }>;

    const openPositionKeys = new Set<string>();
    let deployedUsd = 0;
    let unrealized = 0;
    for (const r of openRows) {
      openPositionKeys.add(positionKey(r.market_slug, r.outcome_token_id));
      deployedUsd += r.size_usd;
      unrealized += r.unrealized_pnl ?? 0;
    }

    const realizedRow = this.db.prepare(`
      SELECT COALESCE(SUM(realized_pnl), 0) AS total
        FROM poly_paper_trades WHERE status IN ('won','lost','voided')
    `).get() as { total: number };
    const totalRealized = realizedRow.total;

    const equity = this.paperCapital + totalRealized + unrealized;
    const totalDrawdownPct = Math.max(0, (this.paperCapital - equity) / this.paperCapital);
    const dailyRealizedPnl = getDailyRealizedPnl(this.db, this.now());
    const freeCapital = this.paperCapital - deployedUsd;

    return {
      openPositionCount: openRows.length,
      openPositionKeys, deployedUsd, dailyRealizedPnl,
      totalDrawdownPct, freeCapital, paperCapital: this.paperCapital,
    };
  }
}
