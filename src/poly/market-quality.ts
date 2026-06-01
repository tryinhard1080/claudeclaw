import type { Market } from './types.js';
import { ttlDays } from './ttl-filter.js';

export type MarketQualityCode =
  | 'ttl_too_short'
  | 'ttl_too_long'
  | 'untradeable_question';

export interface MarketQualityOptions {
  nowSec: number;
  ttlFilterEnabled?: boolean;
  minTtlDays?: number;
  maxTtlDays?: number;
  marketQualityFilterEnabled?: boolean;
}

export interface MarketQualityDecision {
  passed: boolean;
  ttlDays: number;
  code?: MarketQualityCode;
  reason?: string;
}

function marketText(market: Pick<Market, 'slug' | 'question'>): string {
  return `${market.question} ${market.slug}`.toLowerCase().replace(/[-_]+/g, ' ');
}

function untradeableQuestionReason(market: Pick<Market, 'slug' | 'question'>): string | null {
  const text = marketText(market);

  // These are not source-backed forecasting opportunities. The bot opened one
  // of these with a 95% estimate; keep them out of the training set entirely.
  if (/\bjesus christ\b/.test(text) && /\breturn\b/.test(text)) {
    return 'untradeable_question: religious prophecy / joke-market wording';
  }
  if (/\bsecond coming\b|\brapture\b/.test(text)) {
    return 'untradeable_question: religious prophecy wording';
  }

  return null;
}

export function evaluateMarketQuality(
  market: Market,
  opts: MarketQualityOptions,
): MarketQualityDecision {
  const ttl = ttlDays(market, opts.nowSec);

  if (opts.ttlFilterEnabled) {
    const minDays = opts.minTtlDays ?? 0;
    const maxDays = opts.maxTtlDays ?? Number.POSITIVE_INFINITY;
    if (ttl < minDays) {
      return {
        passed: false,
        ttlDays: ttl,
        code: 'ttl_too_short',
        reason: `ttl_days ${ttl.toFixed(2)} < min ${minDays}`,
      };
    }
    if (ttl > maxDays) {
      return {
        passed: false,
        ttlDays: ttl,
        code: 'ttl_too_long',
        reason: `ttl_days ${ttl.toFixed(2)} > max ${maxDays}`,
      };
    }
  }

  if (opts.marketQualityFilterEnabled) {
    const reason = untradeableQuestionReason(market);
    if (reason) {
      return { passed: false, ttlDays: ttl, code: 'untradeable_question', reason };
    }
  }

  return { passed: true, ttlDays: ttl };
}

