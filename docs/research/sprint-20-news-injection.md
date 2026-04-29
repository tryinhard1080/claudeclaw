# Sprint 20: Inject `news_items` context into the ai-probability prompt

> Drafted 2026-04-27 in response to the audit finding that the news-sync cron writes data nothing reads. Completes the half-built Sprint 18 (kind=claude-agent to kind=shell port at commit `0800872`) which dropped the consumer side. Status: research note only, no code yet.

## 1. Existing-code audit

What already touches this concern in the repo:

- **News producer** at `src/poly/news-sync.ts:145-187` (`runNewsSync`). 2-hour cron `3d623e0e` calls it via `scripts/news-sync.ts`. Writes to `news_items` (schema in `migrations/v1.13.0/v1.13.0-news-items.ts`). 90-min dedupe window in `insertNewsItem` (`news-sync.ts:53-93`).
- **Strategy prompt assembly** at `src/poly/strategies/ai-probability.ts:146-167`. Two messages: `SYSTEM_PROMPT` plus a 7-line user payload (question, category, end date, ask, spread, depth, 24h volume). No external context fields.
- **Eval cache** at `src/poly/strategies/ai-probability.ts:189-201` keys on `(slug, outcome_token_id, day-bucket)`. The cache key needs a recency component if news context becomes part of the probability input, otherwise yesterday's news-context cache hit serves a stale estimate.
- **A/B harness** at `src/poly/strategy-compare.ts`. Paired Brier delta plus paired t-test, already built (Sprint 2). The infrastructure to compare `v4` vs `v5-news-shadow` is in place.
- **Strategy versioning** at `src/poly/strategy-engine.ts` writes `prompt_version` and `model` columns to `poly_signals` on every signal (Sprint 2, commit `bb4e57e`).
- **Reflection variant** at `src/poly/strategies/ai-probability-reflect.ts` already exists as a peer strategy with `CRITIC_SYSTEM` + user content. The pattern for adding parallel strategy variants is established and tested.

Total `news_items` references in `src/`: 2, both in `news-sync.ts` itself. Zero readers in any decision path. `news_items` row count (live DB, 2026-04-27): 0 rows. PPLX key has been quota-exhausted since 2026-04-22 per HANDOFF gotcha; cron fires every 2h but `runNewsSync` returns `{ok: false, reason: 'fetch failed: 401'}` and writes nothing.

## 2. Literature / NotebookLM finding

Standard prompt-injection-of-context pattern. No special literature needed. The relevant question is what to inject and at what recency, not whether injection works.

One bias worth naming: per `feedback_news_sync_2h` memory, the GLM 4.6 model has a ~May 2025 training cutoff; today is 2026-04-27, so the model is operating with ~12 months of drift on time-sensitive questions. Polymarket markets resolve on near-future events. LLM probability estimates without fresh news are essentially querying training data, which has structural blindness to anything that happened after the cutoff. News injection is the targeted fix for that structural gap.

## 3. Duplicate / complement / conflict verdict

**Complement.**

The current data flow is asymmetric:

| Cron | Writer | Reader | Used by strategy? |
|---|---|---|---|
| 3d623e0e (news-sync, 2h) | `runNewsSync` to `news_items` | none | NO |
| 3de52de7 (research-ingest, weekly) | `ingestFeed` to `research_items` | `/poly research` Telegram view, optional NotebookLM upload | NO |

News is being collected at zero variable cost (free Sonar tier) and dumped into a table no decision path reads. Sprint 18 (commit `0800872`) migrated the news-sync cron from `kind=claude-agent` (which previously intersected news against open positions and Telegram-alerted on hits) to `kind=shell` (pure DB write). The intersection-and-alert logic was not ported. This sprint is the natural completion of Sprint 18 on the strategy side; the Telegram-alert side is a separate sister sprint.

No conflict. Does not modify gates, does not modify sizing, does not change the risk envelope.

## 4. Why now

Two reasons converge:

1. **Sprint 18 left the data pipe but not the consumer.** Once the PPLX key is replaced, `news_items` will fill at roughly 12 rows/day at zero variable cost. Without consumption, ~84 rows/week of context accumulates and goes unused.
2. **Brier on resolved trades is currently the only calibration signal.** The strategy has no "fresh-information" axis. The resolution-fetch cron (`a6e080bd`) is starting to populate ground truth as positions resolve, which makes a paired Brier A/B (news vs no-news) statistically interpretable within ~30 days at current trade volume.

Measurable improvement target: paired Brier delta `(ai-probability-news) minus (ai-probability)` of at most -0.01 over at least 30 paired markets within 30 days post-shadow-enable, with `p < 0.10` from the existing two-tailed paired t-test in `strategy-compare.ts`. Anything tighter than -0.01 on this trade volume is below the noise floor.

## 5. Out of scope

- Any change to `risk-gates.ts`, `paper-broker.ts`, or sizing math.
- Restoring the Sprint-18 Telegram-intersection-alert path. That is operator-awareness infrastructure, not a strategy input. Sister sprint, separate verdict.
- News quality tuning (richer Perplexity prompt, source weighting, citation ranking). First prove signal exists with the simplest possible injection.
- Per-market category-aware filtering (e.g., only inject geopolitics news for political markets). Premature optimisation before baseline measurement.

## 6. Risk

Blast radius if wrong: **low**. The implementation is a new strategy variant `ai-probability-news` parallel to `ai-probability` and `ai-probability-reflect`. It runs only when `POLY_STRATEGY_VERSION='v5-news-shadow'` (or similar). Worst case if news context misleads the model: the variant produces worse Brier than baseline, the A/B harness flags it, the variant is killed before flag-flip.

Two specific failure modes that need targeted tests:

- News content includes a market-relevant claim with the wrong outcome implied (Perplexity hallucinates a result). Fixture must include this exact pattern.
- Injected news text grows the prompt past the 400-token output budget and the GLM response truncates JSON. Fixture must include a near-boundary case.

## 7. Verification plan

Before flag-enable:

1. New tests in `src/poly/strategies/ai-probability-news.test.ts`:
   - Empty `news_items` row set: behaviour identical to `ai-probability` baseline.
   - 5 recent news bullets, none related to the market: probability estimate within ±0.05 of baseline (no drift from irrelevant context).
   - 1 directly-relevant news bullet: probability estimate moves in the expected direction, asserted case-by-case.
   - Prompt size approaching the model's input budget: news rows truncated to fit, no JSON parse failure on the response.
2. A 10-market sanity comparison run via the existing `eval-glm-vs-claude.ts` pattern, to confirm cost-per-call and latency stay within 2x baseline.
3. Shadow-mode wiring: the strategy engine writes both estimates to `poly_signals` per market, with `prompt_version='v4'` for production and `prompt_version='v5-news-shadow'` for the variant. Production trade decisions continue to use `v4`. The shadow column never enters `paper-broker`.

After 30 days of shadow data:

- Run `npx tsx scripts/poly-strategy-compare.ts v4 v5-news-shadow` for paired Brier and t-test.
- If `p < 0.10` and Brier delta favours v5: propose flag-flip in a follow-up Tier-3 ask. Operator approval required.
- If neutral or worse: keep shadow logging for another 30 days, or kill the variant and document the result as "no measurable signal from current Perplexity prompt; revisit if news_items prompt or source quality changes."

## Verdict

**Build it shadow-only.** The data pipe exists, the A/B harness exists, the strategy-variant pattern exists. Marginal effort is one new strategy file, one test file, and a small SQL helper to fetch last-N `news_items` ordered by `fetched_at DESC`. No new infrastructure.

Three non-trivial implementation decisions, called out explicitly so they don't get hidden during coding:

1. **How many news rows to inject.** Start with 8, since the dedupe window is 90 minutes and the cron is 2h: 8 rows covers roughly the last 16 hours of distinct content.
2. **Where to put news in the prompt.** After market metadata, before the question itself, with a clear `# Recent context (last ~16h)` section header. The model needs a textual cue that the section is contextual rather than dispositive.
3. **Whether to filter news by category.** No, out of scope. Prove signal first with the simplest possible injection.

Do not flag-flip out of shadow without explicit operator nod and at least 30 days of paired data. The flag is the operator's gate.

---

Commit this note alongside the implementation. Pre-commit hook (`scripts/pre-commit-research-check.sh`) blocks `src/poly` or `src/trading` commits without it.
