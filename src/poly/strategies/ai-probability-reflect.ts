import OpenAI from 'openai';
import type Database from 'better-sqlite3';
import { GLM_API_KEY, GLM_BASE_URL, GLM_MODEL } from '../../config.js';
import type { Market, ProbabilityEstimate } from '../types.js';
import { logger } from '../../logger.js';
import { evaluateMarket, extractJson, PROMPT_VERSION as PRIMARY_VERSION } from './ai-probability.js';

/**
 * Sprint 2.5 — reflection pass (second-LLM critic).
 *
 * Pipeline: primary (ai-probability v3) returns an estimate. Critic is
 * handed the original market context PLUS the primary's estimate and
 * reasoning. Critic does one job: decide if the reasoning actually
 * supports the probability, or if it's self-contradictory. Three verdicts:
 *
 *   confirm       → primary estimate stands unchanged
 *   revise        → critic offers a better probability + rationale
 *   contradiction → primary reasoning is internally inconsistent; pull
 *                   probability toward market ask (midpoint) and force
 *                   confidence=low
 *
 * The critic does NOT re-estimate from scratch. It judges the primary's
 * internal consistency, which is the failure mode Sprint 5's backtest
 * surfaced (639 signals with <2.5pp edge, reasoning often hedging the
 * direction of the probability).
 */

export const REFLECT_PROMPT_VERSION = 'v3-reflect';

const CRITIC_SYSTEM = `You are a prediction-market critic. You judge whether another analyst's probability estimate is internally consistent with their own reasoning.

You do NOT re-estimate the market from scratch. You check one thing: does the stated reasoning, taken at face value, actually support the stated probability? If the reasoning hedges or argues the market price is correct while the probability deviates substantially from market, that's a contradiction.

Return a JSON object:
{"verdict": "confirm"|"revise"|"contradiction", "revisedProbability": 0.0-1.0, "revisedConfidence": "low"|"medium"|"high", "rationale": "1-2 sentences"}

Rules:
- verdict="confirm": reasoning and probability are consistent. Set revisedProbability = original probability, revisedConfidence = original confidence.
- verdict="revise": reasoning is sound but the numeric probability is slightly off. Revise by <10 percentage points. Keep confidence at original or lower.
- verdict="contradiction": reasoning undermines the probability (e.g. contrarian argument persuasive, ambiguity unresolved, qualifier misread). Set revisedConfidence="low". The caller will pull the number toward market.

Output ONLY the JSON. No prose, no fences.`;

export interface CriticJudgment {
  verdict: 'confirm' | 'revise' | 'contradiction';
  revisedProbability: number;
  revisedConfidence: 'low' | 'medium' | 'high';
  rationale: string;
}

export interface ComposeCriticArgs {
  question: string;
  category: string | null;
  endDateSec: number;
  ask: number;
  initial: ProbabilityEstimate;
}

export function composeCriticUser(args: ComposeCriticArgs): string {
  return [
    `Question: ${args.question}`,
    `Category: ${args.category ?? 'unknown'}`,
    `End date: ${new Date(args.endDateSec * 1000).toISOString()}`,
    `Market YES ask: $${args.ask.toFixed(3)}`,
    '',
    `Primary analyst output:`,
    `  probability: ${args.initial.probability.toFixed(3)}`,
    `  confidence: ${args.initial.confidence}`,
    `  reasoning: ${args.initial.reasoning}`,
    `  contrarian: ${args.initial.contrarian ?? '(none)'}`,
    '',
    `Judge internal consistency. Return JSON.`,
  ].join('\n');
}

/**
 * Parse critic JSON with tolerant brace/fence extraction (same as primary).
 * Returns null on parse failure or schema mismatch — caller falls back to
 * the primary estimate unchanged.
 */
export function parseCriticResponse(raw: string): CriticJudgment | null {
  const jsonText = extractJson(raw);
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const verdict = o.verdict;
  if (verdict !== 'confirm' && verdict !== 'revise' && verdict !== 'contradiction') return null;
  const p = o.revisedProbability;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return null;
  const c = o.revisedConfidence;
  if (c !== 'low' && c !== 'medium' && c !== 'high') return null;
  const rationale = typeof o.rationale === 'string' ? o.rationale : '';
  return {
    verdict, revisedProbability: p, revisedConfidence: c, rationale,
  };
}

/**
 * Apply the critic's judgment to produce the reflected estimate.
 *
 *   confirm       → passthrough (probability + confidence unchanged).
 *   revise        → use critic's probability + confidence; append rationale.
 *   contradiction → pull probability to midpoint(initial, ask); confidence='low';
 *                   append "contradiction detected" note.
 *
 * Midpoint-pull is intentional: if the primary's reasoning doesn't support
 * its probability, the safer posture is less conviction, not rejection.
 * Full collapse-to-market would zero out edge on every contradiction and
 * make the A/B compare meaningless; midpoint preserves gradient.
 */
export function applyReflectionRule(
  initial: ProbabilityEstimate,
  judgment: CriticJudgment,
  marketAsk: number,
): ProbabilityEstimate {
  if (judgment.verdict === 'confirm') {
    return initial;
  }
  if (judgment.verdict === 'revise') {
    return {
      probability: judgment.revisedProbability,
      confidence: judgment.revisedConfidence,
      reasoning: `${initial.reasoning} [critic-revise: ${judgment.rationale}]`,
      contrarian: initial.contrarian,
    };
  }
  // contradiction: pull to midpoint, force low confidence.
  const pulled = (initial.probability + marketAsk) / 2;
  return {
    probability: pulled,
    confidence: 'low',
    reasoning: `${initial.reasoning} [critic-contradiction: ${judgment.rationale}]`,
    contrarian: initial.contrarian,
  };
}

// Lazy client init — matches ai-probability.ts so tests don't need an API key.
// Targets Z.ai's OpenAI-compatible GLM endpoint (subscription-billed) after the
// 2026-04-18 cost migration. See docs/research/sprint-glm-migration.md.
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    if (!GLM_API_KEY) {
      throw new Error('GLM_API_KEY not set — cannot run reflection critic');
    }
    _client = new OpenAI({ apiKey: GLM_API_KEY, baseURL: GLM_BASE_URL });
  }
  return _client;
}

export interface RunCriticArgs extends ComposeCriticArgs {
  model?: string;
}

export async function runCritic(args: RunCriticArgs): Promise<CriticJudgment | null> {
  try {
    const resp = await getClient().chat.completions.create({
      model: args.model ?? GLM_MODEL,
      max_tokens: 300,
      messages: [
        { role: 'system', content: CRITIC_SYSTEM },
        { role: 'user', content: composeCriticUser(args) },
      ],
    });
    const content = resp.choices[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) return null;
    return parseCriticResponse(content);
  } catch (err) {
    logger.warn({ err: String(err) }, 'reflection critic call failed');
    return null;
  }
}

export interface EvaluateWithReflectionArgs {
  market: Market;
  outcome: Market['outcomes'][number];
  bestAsk: number;
  bestBid: number | null;
  spreadPct: number | null;
  askDepthUsd: number;
  db: Database.Database;
}

/**
 * Run the primary evaluator first. If it returns null, reflection is skipped
 * (nothing to critique). Otherwise invoke the critic and apply its judgment.
 *
 * On critic failure (null), return the primary estimate unchanged — the
 * shadow signal is still recorded but simply equals v3. A/B math treats
 * that pair as zero-delta, which is the correct null-effect semantics.
 */
export async function evaluateWithReflection(
  args: EvaluateWithReflectionArgs,
): Promise<ProbabilityEstimate | null> {
  const initial = await evaluateMarket(args);
  if (!initial) return null;
  const judgment = await runCritic({
    question: args.market.question,
    category: args.market.category ?? null,
    endDateSec: args.market.endDate,
    ask: args.bestAsk,
    initial,
  });
  if (!judgment) return initial;
  return applyReflectionRule(initial, judgment, args.bestAsk);
}

// Re-export for parity with ai-probability.
export const PRIMARY_PROMPT_VERSION = PRIMARY_VERSION;
