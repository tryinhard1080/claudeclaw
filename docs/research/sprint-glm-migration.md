# Sprint — GLM 5.1 migration for strategy modules

## 1. Existing-code audit

Two files call Anthropic's API directly and must be rewritten:

- `src/poly/strategies/ai-probability.ts:1` — `import Anthropic from '@anthropic-ai/sdk';`
  - `:4` imports `ANTHROPIC_API_KEY, POLY_MODEL` from `config.ts`
  - `:35-44` lazy-init pattern for the `Anthropic` client
  - `:155-160` `getClient().messages.create({ model, max_tokens, system, messages })` — the per-scan billing call
  - `:161-162` response parsing: `resp.content.find(b => b.type === 'text')`

- `src/poly/strategies/ai-probability-reflect.ts:1` — same `@anthropic-ai/sdk` import
  - `:143-152` identical lazy-init pattern
  - `:158-168` `runCritic` calls `messages.create` with the critic system prompt
  - `:166-168` same `resp.content.find` pattern

Callers that depend on the shape returned by these modules (don't touch):
- `src/poly/strategy-engine.ts` calls `evaluateMarket` (primary) and `evaluateWithReflection` (reflect). Both return `ProbabilityEstimate | null`. Contract unchanged.
- `src/poly/strategies/ai-probability.ts::computeCacheKey` hashes `PROMPT_TEMPLATE_HASH | slug | tokenId | ...`. `PROMPT_TEMPLATE_HASH = sha256(PROMPT_VERSION | SYSTEM_PROMPT | USER_PROMPT_SKELETON)`. **If we keep `PROMPT_VERSION='v3'` and SYSTEM_PROMPT text identical, the cache is shared between Anthropic-era and GLM-era entries** — bad, because a GLM-era evaluation would read a stale Anthropic-generated probability for up to 2h. Must address.

Package dependencies (`package.json`):
- `@anthropic-ai/sdk@^0.88.0` — current. **Keep** (still used by `src/agent.ts` via `@anthropic-ai/claude-agent-sdk` which wraps it; also imported by some test files). Removal is post-migration polish, not part of this sprint.
- `openai` — **not present**. Add.

`src/config.ts` post-Stage-1 exports: `ANTHROPIC_API_KEY`, `POLY_MODEL`, plus the new `MEMORY_ENABLED` / `VOICE_ENABLED`. Need to add `GLM_API_KEY`, `GLM_BASE_URL`, `GLM_MODEL`.

`poly_eval_cache` schema: `(cache_key, slug, outcome_token_id, created_at, probability, confidence, reasoning, contrarian)`. No provider column. Existing rows will age out at 2h — simplest migration is to TRUNCATE the cache at deploy time rather than add a column (smaller surface, no schema migration needed for a 2h-TTL cache).

## 2. Literature / NotebookLM finding

Z.ai GLM 5.1 documentation (`docs.z.ai/guides/overview/quick-start`, fetched 2026-04-19):

> "Zai's new-generation flagship foundation model, targeting Agentic Engineering."
>
> Base URL (international / standard): `https://api.z.ai/api/paas/v4`
> Authentication: `Authorization: Bearer YOUR_API_KEY` (OpenAI-compatible)

Anthropic legal/compliance (`code.claude.com/docs/en/legal-and-compliance`, quoted in the plan file):

> "Anthropic does not permit third-party developers to offer Claude.ai login or to route requests through Free, Pro, or Max plan credentials on behalf of their users."

This citation in §2 is what rules out Option C (Agent SDK + Max OAuth) for strategy modules and forces this sprint.

OpenAI SDK (`openai` npm package) supports a custom `baseURL` and `apiKey` per client instance — the documented pattern for calling OpenAI-compatible third-party endpoints. No additional adapter library needed.

## 3. Duplicate / complement / conflict verdict

**Complement.** This sprint replaces the Anthropic SDK dependency in two strategy files with the OpenAI SDK pointed at Z.ai's GLM endpoint. No new strategy logic, no prompt changes (initial migration), no schema changes to the main `poly_signals` flow.

Not duplicate (no existing GLM integration). Not conflict (both strategy files currently target Anthropic exclusively; switching is a one-for-one swap). Not novel in approach (OpenAI-compatible third-party endpoints are an established pattern).

## 4. Why now

**Metric**: claudeclaw LLM spend drops from ~$75/day (Anthropic Opus at 2023-signals-per-48h cadence) to **$0/day marginal** under the GLM 5.1 subscription's flat monthly quota. Over the Phase 4 accumulation window (30-60 days to real-money gate), this is a ~$2250-4500 direct cost reduction against whatever the GLM 5.1 subscription fee is.

**Timeline**: migration + eval + restart within 2026-04-19 through 2026-04-21. Restart is Tier-3 operator-gated.

**Trigger chain**: 2026-04-18 $150 API spend incident → operator directive "subscription-based for all data feeds" → Anthropic ToS §"Authentication and credential use" rules out Max-OAuth routing for production → GLM 5.1 is the only subscription-tier + vendor-ToS-compliant path available.

## 5. Out of scope

- **NO prompt retuning.** `SYSTEM_PROMPT` and `CRITIC_SYSTEM` text stay byte-identical to the Anthropic-era versions. Prompt-tuning is only considered if the Stage 3 eval shows a systematic quality gap that small prompt changes could close; that would be a separate sprint.
- **NOT changing the `ProbabilityEstimate` schema**, the Zod parse path, `extractJson`, or any caller code in `strategy-engine.ts`. This sprint preserves the contract.
- **NOT removing `@anthropic-ai/sdk` from `package.json`** yet — it's still a transitive dependency path via the Agent SDK used by `src/agent.ts`. That removal is a post-migration polish sprint.
- **NOT changing `POLY_MODEL`** — leaving the var in place for backward compatibility on any test fixture or script that references it. New env flag `GLM_MODEL` is the canonical name for GLM calls; if `GLM_MODEL` is unset, fall back to `POLY_MODEL`.
- **NOT migrating `src/agent.ts`** — that path remains on the Agent SDK with `CLAUDE_CODE_OAUTH_TOKEN` fallback, which is "ordinary personal use" by the subscription owner per ToS.

## 6. Risk

**Moderate blast radius** — touches the LLM call path that produces every Polymarket signal. But:
- No logic change beyond SDK swap; prompts identical.
- Cached evaluations (poly_eval_cache) should be invalidated at migration time (truncated) so we don't reuse Anthropic probabilities post-switch.
- Restart is Tier-3 sign-off with `POLY_ENABLED=false` still in effect until operator flips after reviewing Stage 3 eval report.
- Strategy-engine caller contract (ProbabilityEstimate return shape) preserved — no regression in risk gates or sizing.

Rollback: revert the two strategy files and restore `@anthropic-ai/sdk` calls, then flip env vars. One-commit rollback.

## 7. Verification plan

**Immediate (pre-restart)**: Stage 3 eval script `scripts/eval-glm-vs-claude.ts` replays 30-50 historical markets from `poly_signals` through the new GLM client. Pass criteria:
- Median `|p_glm - p_claude|` ≤ 10pp
- Directional agreement (sign of edge vs market ask) ≥ 80%
- Qualitative spot-check on 5 disagreements shows GLM reasoning is coherent

**Post-restart (24h)**: watch `pm2 logs claudeclaw` for:
- `evaluateMarket` success rate (no 5xx / timeout spike vs baseline)
- JSON parse success rate (schema match ≥ 95%)
- No log lines mentioning Anthropic endpoints

**30-day metric**: Brier score of GLM-era `poly_signals` on resolved markets stays within 0.05 of the pre-halt Anthropic-era Brier. If it degrades materially, Stage 4 fallback to Option A (Haiku + fresh rotated API key) is available — acknowledged as non-subscription but cost-mitigated.

**Observability**: Stage 4 adds a `poly_signals.provider` column populated at insert time. All GLM-era signals tagged `glm-5.1`; pre-halt rows backfilled to `anthropic-opus`. Enables clean partitioning in Brier/log-loss reports going forward.
