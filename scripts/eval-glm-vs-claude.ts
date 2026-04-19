#!/usr/bin/env node
/**
 * Phase 0.5 Stage 3 — comparative eval: GLM 5.1 vs historical Anthropic-era signals.
 *
 * Replays N historical Polymarket signals through the new GLM client and reports:
 *   - Median absolute probability divergence |p_glm - p_claude|
 *   - Directional agreement rate (same sign of edge vs market ask)
 *   - 5 qualitative spot-checks on the largest disagreements
 *
 * Pass criteria (plan §Stage 3):
 *   - Median divergence <= 10pp
 *   - Directional agreement >= 80%
 *   - Spot-check shows coherent GLM reasoning
 *
 * Usage:
 *   GLM_API_KEY=<key> npx tsx scripts/eval-glm-vs-claude.ts            # default 30 samples
 *   GLM_API_KEY=<key> npx tsx scripts/eval-glm-vs-claude.ts 50         # N=50
 *   GLM_API_KEY=<key> OUT=report.md npx tsx scripts/eval-glm-vs-claude.ts  # custom output path
 *
 * Does NOT modify any DB or production state. Writes a markdown report to
 * docs/handoff/ or the OUT env var path. Safe to re-run.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { GLM_API_KEY, GLM_BASE_URL, GLM_MODEL, STORE_DIR, PROJECT_ROOT } from '../src/config.js';
import { ProbabilityEstimateSchema } from '../src/poly/types.js';
import { extractJson } from '../src/poly/strategies/ai-probability.js';

// ---------------------------------------------------------------------------
// Prompt — DUPLICATES src/poly/strategies/ai-probability.ts SYSTEM_PROMPT by
// design. Keep synced. The eval must reproduce the exact inference conditions
// the bot uses in production.
// ---------------------------------------------------------------------------

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

interface HistoricalSignal {
  id: number;
  created_at: number;
  market_slug: string;
  outcome_label: string;
  market_price: number;
  claude_probability: number;
  claude_edge_pct: number;
  claude_confidence: string;
  claude_reasoning: string;
  claude_model: string | null;
  question: string;
  category: string | null;
  end_date: number;
  volume_24h: number;
}

interface GlmResult {
  probability: number;
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
  contrarian?: string;
}

async function main(): Promise<void> {
  const N = parseInt(process.argv[2] || '30', 10);
  const outPath = process.env.OUT
    ? path.resolve(process.env.OUT)
    : path.join(PROJECT_ROOT, 'docs', 'handoff', `glm-eval-${new Date().toISOString().slice(0, 10)}.md`);

  if (!GLM_API_KEY) {
    console.error('GLM_API_KEY is not set. Add it to .env before running the eval.');
    process.exit(1);
  }

  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}`);
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true });

  // Sample: most recent N approved signals with category + volume context present.
  // Approved-only filters out obvious rejections (same-token duplicates, too-stale end-dates)
  // so the eval covers the distribution the bot actually acts on.
  const rows = db
    .prepare(
      `SELECT s.id, s.created_at, s.market_slug, s.outcome_label,
              s.market_price, s.estimated_prob AS claude_probability,
              s.edge_pct AS claude_edge_pct, s.confidence AS claude_confidence,
              s.reasoning AS claude_reasoning, s.model AS claude_model,
              m.question, m.category, m.end_date, m.volume_24h
         FROM poly_signals s
         JOIN poly_markets m ON m.slug = s.market_slug
        WHERE s.approved = 1
          AND m.question IS NOT NULL
          AND m.volume_24h > 0
        ORDER BY s.created_at DESC
        LIMIT ?`,
    )
    .all(N) as HistoricalSignal[];

  if (rows.length === 0) {
    console.error('No historical signals match the sampling filter. Run the bot for more cycles first.');
    process.exit(1);
  }

  console.log(`Eval target: ${rows.length} signals (requested ${N}).`);
  console.log(`GLM endpoint: ${GLM_BASE_URL}`);
  console.log(`GLM model: ${GLM_MODEL}`);
  console.log(`Output: ${outPath}`);
  console.log();

  const client = new OpenAI({ apiKey: GLM_API_KEY, baseURL: GLM_BASE_URL });

  type EvalRow = HistoricalSignal & {
    glm_probability?: number;
    glm_confidence?: string;
    glm_reasoning?: string;
    glm_edge_pct?: number;
    divergence_pp?: number;
    directional_agreement?: boolean;
    error?: string;
  };

  const results: EvalRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    process.stdout.write(`  [${i + 1}/${rows.length}] ${r.market_slug.slice(0, 40)}... `);
    const user = [
      `Question: ${r.question}`,
      `Category: ${r.category ?? 'unknown'}`,
      `End date: ${new Date(r.end_date * 1000).toISOString()}`,
      `Current ${r.outcome_label} ask: $${r.market_price.toFixed(3)}`,
      `Spread: n/a (historical replay)`,
      `Ask depth: $0 (historical replay)`,
      `24h volume: $${r.volume_24h.toFixed(0)}`,
    ].join('\n');

    try {
      const resp = await client.chat.completions.create({
        model: GLM_MODEL,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
      });
      const content = resp.choices[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        results.push({ ...r, error: 'empty response' });
        console.log('EMPTY');
        continue;
      }
      const parsed = ProbabilityEstimateSchema.safeParse(JSON.parse(extractJson(content)));
      if (!parsed.success) {
        results.push({ ...r, error: 'schema mismatch' });
        console.log('PARSE FAIL');
        continue;
      }
      const glmResult: GlmResult = parsed.data;
      const divergencePp = Math.abs(glmResult.probability - r.claude_probability) * 100;
      const glmEdgePct = (glmResult.probability - r.market_price) * 100;
      const directionalAgreement =
        (glmEdgePct > 0 && r.claude_edge_pct > 0) || (glmEdgePct < 0 && r.claude_edge_pct < 0) || (Math.abs(glmEdgePct) < 1e-6 && Math.abs(r.claude_edge_pct) < 1e-6);
      results.push({
        ...r,
        glm_probability: glmResult.probability,
        glm_confidence: glmResult.confidence,
        glm_reasoning: glmResult.reasoning,
        glm_edge_pct: glmEdgePct,
        divergence_pp: divergencePp,
        directional_agreement: directionalAgreement,
      });
      console.log(`Δ=${divergencePp.toFixed(1)}pp ${directionalAgreement ? 'agree' : 'DISAGREE'}`);
    } catch (err) {
      results.push({ ...r, error: String(err).slice(0, 200) });
      console.log(`ERROR: ${String(err).slice(0, 80)}`);
    }
    // Gentle rate-limit: 500ms between calls. Z.ai's docs don't publish limits,
    // so err conservative — eval run is once-off, not latency-sensitive.
    await new Promise(r => setTimeout(r, 500));
  }

  // ---- Aggregate ---------------------------------------------------------
  const successes = results.filter(r => r.divergence_pp !== undefined);
  const errors = results.filter(r => r.error !== undefined);
  const divergences = successes.map(r => r.divergence_pp!).sort((a, b) => a - b);
  const medianDivergence = divergences.length > 0 ? divergences[Math.floor(divergences.length / 2)]! : NaN;
  const meanDivergence = divergences.length > 0 ? divergences.reduce((a, b) => a + b, 0) / divergences.length : NaN;
  const agreements = successes.filter(r => r.directional_agreement).length;
  const agreementRate = successes.length > 0 ? agreements / successes.length : NaN;

  const passMedian = medianDivergence <= 10;
  const passAgreement = agreementRate >= 0.8;
  const passed = passMedian && passAgreement;

  // ---- Write report ------------------------------------------------------
  const spotChecks = successes
    .filter(r => r.divergence_pp! > medianDivergence)
    .sort((a, b) => b.divergence_pp! - a.divergence_pp!)
    .slice(0, 5);

  const lines: string[] = [];
  lines.push(`# GLM 5.1 vs Claude eval — ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`**Model**: \`${GLM_MODEL}\` @ \`${GLM_BASE_URL}\``);
  lines.push(`**Sample**: ${rows.length} approved signals (most recent first)`);
  lines.push(`**Successful GLM calls**: ${successes.length}`);
  lines.push(`**Errors**: ${errors.length}`);
  lines.push('');
  lines.push('## Pass criteria');
  lines.push('');
  lines.push(`| Metric | Value | Threshold | Result |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| Median \`|p_glm - p_claude|\` | ${medianDivergence.toFixed(2)} pp | ≤ 10 pp | ${passMedian ? '✅ PASS' : '❌ FAIL'} |`);
  lines.push(`| Mean divergence | ${meanDivergence.toFixed(2)} pp | (informational) | — |`);
  lines.push(`| Directional agreement | ${(agreementRate * 100).toFixed(1)} % | ≥ 80 % | ${passAgreement ? '✅ PASS' : '❌ FAIL'} |`);
  lines.push(`| Overall | ${passed ? '✅ **PASS** — proceed to Stage 4 observability + restart authorization.' : '❌ **FAIL** — do not restart. Revisit A/B/C architecture decision.'} | | |`);
  lines.push('');
  lines.push('## Spot checks (top 5 disagreements by divergence)');
  lines.push('');
  for (const sc of spotChecks) {
    lines.push(`### ${sc.market_slug} — ${sc.outcome_label} @ ask $${sc.market_price.toFixed(3)}`);
    lines.push('');
    lines.push(`> ${sc.question}`);
    lines.push('');
    lines.push(`- **Claude** (\`${sc.claude_model ?? 'unknown'}\`): p=${sc.claude_probability.toFixed(3)}, conf=${sc.claude_confidence}, edge=${sc.claude_edge_pct.toFixed(1)}pp`);
    lines.push(`  - _${sc.claude_reasoning.slice(0, 300)}${sc.claude_reasoning.length > 300 ? '…' : ''}_`);
    lines.push(`- **GLM** (\`${GLM_MODEL}\`): p=${sc.glm_probability!.toFixed(3)}, conf=${sc.glm_confidence}, edge=${sc.glm_edge_pct!.toFixed(1)}pp`);
    lines.push(`  - _${sc.glm_reasoning!.slice(0, 300)}${sc.glm_reasoning!.length > 300 ? '…' : ''}_`);
    lines.push(`- **Divergence**: ${sc.divergence_pp!.toFixed(1)}pp, directional agreement: ${sc.directional_agreement ? 'YES' : 'NO'}`);
    lines.push('');
  }

  if (errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const e of errors.slice(0, 10)) {
      lines.push(`- \`${e.market_slug}\`: ${e.error}`);
    }
    lines.push('');
  }

  lines.push('## Full divergence distribution');
  lines.push('');
  lines.push('```');
  lines.push(`min=${divergences[0]?.toFixed(2)}  p25=${divergences[Math.floor(divergences.length * 0.25)]?.toFixed(2)}  p50=${medianDivergence.toFixed(2)}  p75=${divergences[Math.floor(divergences.length * 0.75)]?.toFixed(2)}  max=${divergences[divergences.length - 1]?.toFixed(2)}`);
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push(`Eval script: \`scripts/eval-glm-vs-claude.ts\` — see docs/research/sprint-glm-migration.md §7 for verification plan.`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));

  console.log();
  console.log(`━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Median divergence: ${medianDivergence.toFixed(2)} pp  (threshold ≤ 10)`);
  console.log(`Directional agreement: ${(agreementRate * 100).toFixed(1)} %  (threshold ≥ 80)`);
  console.log(`Overall: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Report: ${outPath}`);
  console.log();

  db.close();
  process.exit(passed ? 0 : 2);
}

main().catch(err => {
  console.error('Eval crashed:', err);
  process.exit(1);
});
