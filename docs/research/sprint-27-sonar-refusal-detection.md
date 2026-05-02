# Sprint 27 — sonar refusal detection (skip vs fail discrimination)

**Verdict:** complement (closes a gap left by Sprint 26's pwm CLI swap; orchestrator + tests touched, no risk-gate or paper-broker code)
**Track:** Polymarket — `src/poly/news-sync.ts`, `scripts/news-sync.ts`
**Tier:** 2 (no risk-gates.ts or paper-broker.ts touched)

## Problem

Sprint 26 routed news-sync through `pwm ask --json --intent quick`, which targets the free Sonar tier. Sonar sometimes refuses real-time queries instead of searching: it returns 200 OK with a body like `"I don't have real-time feeds in this moment"` or `"My training data only goes up to..."`.

Without detection, that refusal text became a `news_item` row — a plausible-looking summary that contained zero news. Two failure modes followed:
1. DB pollution: garbage summaries surface in the daily digest and Sprint 21 intersection alerts as if they were real headlines.
2. Heartbeat skew: `writeHeartbeat` fires for a successful insert, so the cron monitor reports green on a non-functional run.

## Existing-code audit

`runNewsSync` had no post-fetch content validation — it called `extractSummary` (which only checks for an empty/missing string) and went straight to `insertNewsItem`. The `news-sync.test.ts` had no coverage for refusal text. No prior sprint addressed this. **Verdict: complement**, no duplication.

## Change

1. New exported helper `isRefusalResponse(text)` in `src/poly/news-sync.ts`:
   - Lowercases input, tests against a list of refusal phrases (`don't have real-time`, `can't pull the last`, `cannot provide real-time`, `my training data`, `i'm unable to access current`, etc.).
   - Returns `true` on any match.
2. `runNewsSync` calls `isRefusalResponse(summary)` after `extractSummary` and before `insertNewsItem`. On match, returns `ok: false` with reason `sonar-refusal: model declined real-time search (not inserted)`. Heartbeat NOT written.
3. `scripts/news-sync.ts` treats reasons containing `sonar-refusal` as a clean skip (exit 0), same as the existing `PPLX_API_KEY` branch. No Telegram failure alert.

## Tests

`src/poly/news-sync.test.ts` adds an `isRefusalResponse` describe block (3 cases):
- Detects 5 representative refusal patterns.
- Does NOT flag real news summaries (Fed/Powell, Trump tariff, "no major news").
- Case-insensitive match.

Existing tests are unchanged.

## How this changes our code/strategy

Closes a silent-failure surface specific to the pwm-Sonar path. Heartbeat now reflects "real news fetched" rather than "fetcher returned text." Sprint 21 intersection alerts won't false-positive against refusal text.

The `scripts/news-sync.ts` skip path means the operator's Telegram chat doesn't get spammed when Sonar is being uncooperative — those refusals correlate with quiet news periods anyway, so a quiet skip is the right behavior.
