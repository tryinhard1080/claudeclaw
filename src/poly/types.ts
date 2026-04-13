import { z } from 'zod';

// Schemas accept the raw Polymarket shapes (field names per Task 0 probe).
// Helpers parse stringified JSON fields into typed arrays.
// Note: Gamma API returns numeric fields as strings; schemas use z.coerce.number()
// to tolerate both string and number inputs.

const stringArrayFromJson = z.string().transform((s, ctx) => {
  try {
    const parsed: unknown = JSON.parse(s);
    if (!Array.isArray(parsed) || !parsed.every(x => typeof x === 'string')) {
      ctx.addIssue({ code: 'custom', message: 'expected JSON string array' });
      return z.NEVER;
    }
    return parsed as string[];
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid JSON' });
    return z.NEVER;
  }
});

const numberArrayFromJson = z.string().transform((s, ctx) => {
  try {
    const parsed: unknown = JSON.parse(s);
    if (!Array.isArray(parsed)) { ctx.addIssue({ code: 'custom', message: 'expected array' }); return z.NEVER; }
    const nums = parsed.map(x => typeof x === 'string' ? Number(x) : x);
    if (!nums.every(n => typeof n === 'number' && Number.isFinite(n))) {
      ctx.addIssue({ code: 'custom', message: 'expected numeric array' });
      return z.NEVER;
    }
    return nums as number[];
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid JSON' });
    return z.NEVER;
  }
});

export const GammaMarketSchema = z.object({
  conditionId: z.string(),
  slug: z.string(),
  question: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  outcomes: stringArrayFromJson,
  outcomePrices: numberArrayFromJson,
  clobTokenIds: stringArrayFromJson,
  volume24hr: z.coerce.number().default(0),
  liquidity: z.coerce.number().default(0),
  // Gamma returns markets with a missing/null endDate (~46% of the active
  // list on 2026-04-12). Accept either shape here; `normalizeMarket`
  // filters them out cleanly without a Zod throw.
  endDate: z.string().nullish(),
  closed: z.boolean().default(false),
}).passthrough();
export type GammaMarket = z.infer<typeof GammaMarketSchema>;

export const ClobBookLevelSchema = z.object({
  price: z.coerce.number(),
  size: z.coerce.number(),
});
export const ClobBookSchema = z.object({
  bids: z.array(ClobBookLevelSchema).default([]),
  asks: z.array(ClobBookLevelSchema).default([]),
}).passthrough();
export type ClobBook = z.infer<typeof ClobBookSchema>;

// Internal normalized shapes used by the rest of the module
export interface Market {
  slug: string;
  conditionId: string;
  question: string;
  category?: string;
  outcomes: Array<{ label: string; tokenId: string; price: number }>;
  volume24h: number;
  liquidity: number;
  endDate: number; // unix seconds
  closed: boolean;
}

export type Confidence = 'low' | 'medium' | 'high';

export const ProbabilityEstimateSchema = z.object({
  probability: z.number().min(0).max(1),
  confidence: z.enum(['low', 'medium', 'high']),
  reasoning: z.string().min(1),
  contrarian: z.string().optional(),
});
export type ProbabilityEstimate = z.infer<typeof ProbabilityEstimateSchema>;

export interface Signal {
  marketSlug: string;
  outcomeTokenId: string;
  outcomeLabel: string;
  marketPrice: number;          // ask at signal time
  estimatedProb: number;
  edgePct: number;
  confidence: Confidence;
  reasoning: string;
  contrarian?: string;
}

export interface PaperTrade {
  id: number;
  marketSlug: string;
  outcomeTokenId: string;
  outcomeLabel: string;
  side: 'BUY';
  entryPrice: number;
  sizeUsd: number;
  shares: number;
  kellyFraction: number;
  strategy: string;
  status: 'open' | 'won' | 'lost' | 'voided';
  createdAt: number;
  resolvedAt?: number;
  realizedPnl?: number;
  voidedReason?: string;
}

export interface PortfolioState {
  paperCapital: number;
  freeCapital: number;
  deployedUsd: number;
  openPositionCount: number;
  dailyRealizedPnl: number;
  totalDrawdownPct: number;
}
