import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { ANTHROPIC_API_KEY, POLY_MODEL } from '../../config.js';
import { ProbabilityEstimateSchema, type ProbabilityEstimate, type Market } from '../types.js';
import { logger } from '../../logger.js';

const PROMPT_VERSION = 'v3';

const SYSTEM_PROMPT = `You are a prediction-market probability estimator.

READ THE QUESTION LITERALLY. These qualifiers reverse meaning and are the #1 source of mispriced signals:
- "Next X" means the SUCCESSOR to the current X. If X still holds the role, the answer is generally NO (there's no new X yet).
- "First X to Y" requires BOTH doing Y AND being first — later is worth zero.
- "Before DATE" / "by DATE" is time-bounded — happening after resolution = NO.
- "Will X NOT happen" has inverted polarity vs "Will X happen" — read twice.
- If the question concerns a specific person/entity, check whether the market resolves YES only for that exact entity or for any member of a category.

Before committing to a probability, re-state the question in your own words in one clause and verify your answer matches that restatement.

A market price far from your estimate is usually the market being right, not wrong. Large edges (>20pp) on liquid markets almost always mean you misread the question — go back and re-parse before outputting high confidence.

HARD RULES (apply in this order):
1. If the contrarian section ends up arguing the current market price is correct OR identifies a reading of the question you're unsure about, your probability MUST be within 10 percentage points of the market ask, and confidence MUST be "low".
2. If the question's interpretation is ambiguous and you cannot resolve it with high conviction, confidence is "low" and probability stays near market.
3. Your probability and contrarian section must be internally consistent. If they contradict, revise the probability DOWN toward market and set confidence to "low".

Given a market question and context, return a JSON object:
{"probability": 0.0-1.0, "confidence": "low"|"medium"|"high", "reasoning": "1-3 sentences that restate the resolution condition", "contrarian": "1-2 sentences on why the current market price might actually be correct"}
Output ONLY the JSON object. No prose, no markdown fences, no commentary.`;

const USER_PROMPT_SKELETON = `{question, category, end_date, ask, spread, depth, volume}`;

// Lazy client init — keeps module importable without a real API key (tests, dry runs).
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set — cannot evaluate markets');
    }
    _client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Extract a JSON object from model output. Handles:
 *   - ```json\n{...}\n``` fences
 *   - ```\n{...}\n``` plain fences
 *   - bare {...} in mixed prose
 * Returns the input unchanged as a last-resort fallback.
 * Uses greedy matching so nested objects like {"a":{"b":1}} survive.
 */
export function extractJson(text: string): string {
  // Fenced block — greedy so nested braces don't truncate. Fence boundaries terminate.
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (fenced) return fenced[1]!;
  // Bare object — greedy for same nested-brace reason.
  const bare = text.match(/\{[\s\S]*\}/);
  if (bare) return bare[0];
  return text;
}

export function computeEdgePct(estimated: number, marketAsk: number): number {
  return (estimated - marketAsk) * 100;
}

// PROMPT_TEMPLATE_HASH captures version + literal template text —
// any edit to the prompt invalidates the cache automatically.
export const PROMPT_TEMPLATE_HASH = crypto
  .createHash('sha256')
  .update(`${PROMPT_VERSION}|${SYSTEM_PROMPT}|${USER_PROMPT_SKELETON}`)
  .digest('hex')
  .slice(0, 16);

export function computeCacheKey(
  slug: string,
  tokenId: string,
  params: {
    ask: number; volume: number; spreadPct: number | null; askDepthUsd: number;
    question: string; category: string | null; endDateSec: number;
  }
): string {
  // Quantize: ask 1%, volume $1k, spread 1% (null→-1), ask depth $100,
  // endDate to day. Question and category are hashed verbatim — a reworded
  // question or recategorized market must not reuse an old probability.
  const ask = Math.round(params.ask * 100);
  const vol = Math.round(params.volume / 1000);
  const spread = params.spreadPct === null ? -1 : Math.round(params.spreadPct);
  const depth = Math.round(params.askDepthUsd / 100);
  const endDay = Math.floor(params.endDateSec / 86400);
  const cat = params.category ?? '';
  return crypto
    .createHash('sha256')
    .update(
      `${PROMPT_TEMPLATE_HASH}|${slug}|${tokenId}|${ask}|${vol}|${spread}|${depth}|${endDay}|${cat}|${params.question}`,
    )
    .digest('hex');
}

interface EvaluateArgs {
  market: Market;
  outcome: Market['outcomes'][number];
  bestAsk: number;
  bestBid: number | null;
  spreadPct: number | null;
  askDepthUsd: number;
  db: Database.Database;
}

export async function evaluateMarket(args: EvaluateArgs): Promise<ProbabilityEstimate | null> {
  const key = computeCacheKey(args.market.slug, args.outcome.tokenId, {
    ask: args.bestAsk,
    volume: args.market.volume24h,
    spreadPct: args.spreadPct,
    askDepthUsd: args.askDepthUsd,
    question: args.market.question,
    category: args.market.category ?? null,
    endDateSec: args.market.endDate,
  });
  const cached = args.db
    .prepare(
      `SELECT probability, confidence, reasoning, contrarian, created_at FROM poly_eval_cache WHERE cache_key=?`
    )
    .get(key) as
    | {
        probability: number;
        confidence: string;
        reasoning: string;
        contrarian: string | null;
        created_at: number;
      }
    | undefined;
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.created_at < 2 * 3600) {
    return {
      probability: cached.probability,
      confidence: cached.confidence as ProbabilityEstimate['confidence'],
      reasoning: cached.reasoning,
      contrarian: cached.contrarian ?? undefined,
    };
  }

  const user = [
    `Question: ${args.market.question}`,
    `Category: ${args.market.category ?? 'unknown'}`,
    `End date: ${new Date(args.market.endDate * 1000).toISOString()}`,
    `Current ${args.outcome.label} ask: $${args.bestAsk.toFixed(3)}`,
    `Spread: ${args.spreadPct === null ? 'n/a' : args.spreadPct.toFixed(1) + '%'}`,
    `Ask depth: $${args.askDepthUsd.toFixed(0)}`,
    `24h volume: $${args.market.volume24h.toFixed(0)}`,
  ].join('\n');

  try {
    const resp = await getClient().messages.create({
      model: POLY_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    });
    const block = resp.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') return null;
    const json = extractJson(block.text);
    let obj: unknown;
    try {
      obj = JSON.parse(json);
    } catch {
      logger.warn(
        { raw: block.text.slice(0, 200) },
        'probability estimate JSON parse failed'
      );
      return null;
    }
    const parsed = ProbabilityEstimateSchema.safeParse(obj);
    if (!parsed.success) {
      logger.warn({ errors: parsed.error.issues }, 'probability estimate failed zod');
      return null;
    }
    args.db
      .prepare(
        `INSERT OR REPLACE INTO poly_eval_cache (cache_key, slug, outcome_token_id, created_at, probability, confidence, reasoning, contrarian) VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        key,
        args.market.slug,
        args.outcome.tokenId,
        now,
        parsed.data.probability,
        parsed.data.confidence,
        parsed.data.reasoning,
        parsed.data.contrarian ?? null
      );
    return parsed.data;
  } catch (err) {
    logger.warn({ err: String(err), slug: args.market.slug }, 'evaluateMarket failed');
    return null;
  }
}
