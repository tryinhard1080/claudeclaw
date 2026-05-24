# Sprint 28 — Pipe Polymarket `description` to ai-probability evaluator

**Date:** 2026-05-24
**Owner:** main (claudeclaw)
**Touches:** `src/poly/` — `types.ts`, `gamma-client.ts`, `strategies/ai-probability.ts`, tests

## Hypothesis

ai-probability v3 makes resolution-criteria-reading mistakes because it never reads the resolution criteria. The Gamma API returns a `description` field for every market that contains the official Polymarket clarification text (resolution source, cutoff dates, edge cases, scope definitions). `normalizeMarket` parses it in the wire schema and then drops it on the floor before the strategy layer sees it.

Feeding `description` into the existing v3 evaluator prompt is the highest-leverage edge improvement available: zero new LLM cost, no new layer, no new prompt scaffolding. The v3 prompt already has the right disposition (read the question literally, HARD RULES that pull-to-market on ambiguity). It just doesn't have the source-of-truth text to read literally *from*.

## Existing-code audit (per CLAUDE.md §"Build Discipline")

**Files grep'd:** `src/poly/**.ts`, `src/poly/strategies/*.ts`, `src/poly/types.ts`, gamma-client, ai-probability, ai-probability-reflect, resolution-coverage, adversarial-data tests.

| File | Relation | Status |
|------|----------|--------|
| `strategies/ai-probability.ts` (v3 SYSTEM_PROMPT) | **Complement** — already encodes literal-reading rules for resolution-criteria qualifiers (Next X, First X to Y, before DATE, NOT polarity, specific-entity-vs-category, HARD RULES that pull to market on ambiguity). Currently reads from the question slug + category only. This sprint hands it the actual description text. | Modify |
| `strategies/ai-probability-reflect.ts` (v3-reflect) | **Complement** — reflection critic judges internal consistency of the v3 estimate. Will benefit from a stronger v3 input automatically, no code change. | Unchanged |
| `gamma-client.ts` (`normalizeMarket`) | **Conflict-to-fix** — parses `description` via `GammaMarketSchema` then drops it. Single 1-line addition copies it through. | Modify |
| `types.ts` (`Market` interface) | **Conflict-to-fix** — internal `Market` type omits `description`. Add as `description?: string`. | Modify |
| `resolution-coverage.ts` | **Orthogonal** — tracks whether *settled* resolution rows exist in `poly_resolutions` cache for open trades. Different problem (post-trade audit vs pre-trade evaluation). | Unchanged |
| `adversarial-data.test.ts` | **Orthogonal** — tests gates against adversarial *inputs* (duplicate positions, price gaps, malicious headlines). Not adversarial *reasoning*. | Unchanged |
| `news-sync.ts` / `news-intersection.ts` | **Orthogonal** — news pipeline, post-entry monitoring. | Unchanged |

### Verdict: COMPLEMENT (not novel, not duplicate)

This sprint augments v3 with input data it should already have had. It does NOT introduce a third LLM pass — that would compound the existing pull-to-market signals from v3's HARD RULES and reflect's "contradiction" verdict, zeroing out edge on ambiguous markets without paying for it elsewhere.

The originally proposed "adversarial resolution-criteria stress-test layer" is REJECTED in favor of this lower-cost, higher-leverage change. Captured here so a future sprint doesn't re-litigate.

## Scope

**In:**
1. Add `description?: string` to `Market` interface in `types.ts`.
2. Copy `g.description` through in `normalizeMarket` (gamma-client.ts).
3. In `evaluateMarket` user prompt, include description as an explicit "Resolution criteria (verbatim from Polymarket)" block when present.
4. Update v3 SYSTEM_PROMPT with one new bullet under the literal-reading rules: when a resolution-criteria block is provided, the analyst MUST cite it in their reasoning if it materially constrains the answer.
5. Update `computeCacheKey` to include a hash of the description text so a Polymarket clarification edit invalidates cached estimates. Without this, a contract that gets re-clarified mid-cycle would keep serving a stale probability.
6. Tests: normalize round-trip, cache-key sensitivity, prompt inclusion, prompt omission when description absent.

**Out:**
- New LLM call layer.
- New table or schema migration (description is in-memory only; the cache_key hash absorbs the change).
- Reflect-critic prompt changes (it benefits passively).
- News-sync, intersection, weather-shadow.

## Prompt change (precise text)

Adding to v3 SYSTEM_PROMPT, after the existing literal-reading bullet list:

```
- If a "Resolution criteria" block is provided below, read it BEFORE the question.
  It is the contract's literal resolution language. When the criteria specify a
  cutoff date, a resolution source (UMA, official tally, specific publication),
  a tie-breaker, or a scope limit, those bind your probability. If the criteria
  contradict the question's surface reading, the criteria win.
```

Adding to the user prompt skeleton (only when description is present):

```
Resolution criteria (verbatim from Polymarket):
{description}
```

Skeleton is unchanged when description is absent — current behavior preserved as the null case.

## Cache invalidation

`PROMPT_TEMPLATE_HASH` already hashes `PROMPT_VERSION | SYSTEM_PROMPT | USER_PROMPT_SKELETON`. Bumping `PROMPT_VERSION` from `v3` to `v3-desc` rotates every cache row once. After that, `computeCacheKey` adds a `descHash` (sha256[:8] of description, or empty string if absent) so per-market description edits invalidate just that market's row.

This is cheap. Cache is `poly_eval_cache` keyed by hash; stale rows age out naturally on the 2h TTL anyway.

## Test plan (TDD shape)

Write tests FIRST in this order:

1. **`normalizeMarket` propagates description.** Given a Gamma raw with `description: "Resolves YES if X happens before 2026-12-31 23:59 UTC."`, the returned Market has the same string. Already-passing markets without description return `description: undefined`.
2. **`computeCacheKey` is description-sensitive.** Two calls with identical params except description text → different keys. Two calls with identical params and identical descriptions → same key. Two calls where one has `undefined` description vs `""` → same key (treat both as null).
3. **`evaluateMarket` user prompt includes description block when present.** Inject a fake OpenAI client that captures the user message; assert it contains "Resolution criteria (verbatim from Polymarket):" and the description text.
4. **`evaluateMarket` user prompt omits description block when absent.** Same fake; assert it does NOT contain "Resolution criteria".
5. **`PROMPT_TEMPLATE_HASH` changed.** Sentinel assertion: hash must not equal the v3 value. Forces future prompt edits to update the version.

All tests live in existing `ai-probability.test.ts` / `gamma-client.test.ts`. No new test file.

## Rollout

This is Tier 2 (do then report). No risk-gate change, no broker change, no real-money exposure. Strategy-engine pipeline unchanged. The change either makes ai-probability smarter on resolution-criteria reads (intended) or null-effect (description is empty/absent on most markets, in which case behavior matches today).

Shadow comparison via the existing strategy-compare framework will surface the delta over the next 7 days. No new shadow strategy required — v3-desc replaces v3 in-place because v3 with no description fed in is *worse* than v3-desc with no description fed in (they're identical on the null case).

## How this changes our code/strategy

Direct: ai-probability v3 evaluator gets the contract's official resolution language as an explicit input block. The v3 prompt already disposes the analyst to read literally and pull-to-market on ambiguity; the change supplies the source-of-truth text those rules operate on.

Strategic: closes the gap surfaced in the May 3 conversation ("the model estimates probability based on headline sentiment but sometimes gets the resolution criteria wrong"). Future adversarial work (multi-pass, multi-model debate) only makes sense AFTER this baseline edit, otherwise we're stacking layers on top of an analyst that's reasoning blind.

## Open follow-ups (out of scope)

- `description` text from Gamma sometimes includes Markdown / HTML artifacts. v1 sends it raw to the LLM (which handles it fine). A future sanitization pass could trim or render-clean.
- A "criteria-aware void rate" metric on the calibration side: how often did a YES-probable signal void or resolve NO specifically because of a criteria-edge case the analyst missed? Add to calibration.ts as a separate sprint.
