# Sprint 2026-06-01 - News Fallback Quality

## Scope

Improve the trading-news freshness path without changing strategy, risk gates,
paper broker behavior, monetary caps, or real-money settings.

Touches:

- `src/poly/news-sync.ts`
- `src/poly/news-sync.test.ts`
- `src/poly/news-intersection.ts`
- `src/poly/news-intersection.test.ts`
- readiness and handoff docs if verification changes the current state

## Existing-Code Audit

| Surface | Verdict | Notes |
|---|---|---|
| `src/poly/news-sync.ts` RSS fallback | Complement | Existing fallback protects the 2-hour news heartbeat when Sonar refuses live search, but it sorts raw RSS by recency without filtering for trading relevance. |
| `src/poly/news-sync.ts` XML entity decode | Complement | Existing decoder handles named and decimal entities; live fallback output showed hex entities such as `&#x2019;` still leaking into summaries. |
| `src/poly/news-intersection.ts` slug-token overlap | Complement | Current two-token threshold is deterministic and useful, but weak tokens like `company` and `market` can create position alerts without a distinctive market/entity anchor. |
| `docs/research/sprint-2026-06-01-operational-green-hotfix.md` | Complement | Prior note established the fallback path. This sprint tightens input quality and alert specificity after live smoke evidence showed noisy fallback headlines. |
| `src/poly/risk-gates.ts`, `src/poly/paper-broker.ts`, `src/poly/pnl-tracker.ts` | No change | Tier-3 surfaces are intentionally left untouched. |

## Duplicate / Complement / Conflict / Novel Verdict

- Duplicate: no existing deterministic relevance filter was found for RSS
  fallback headlines.
- Complement: this adds quality control to the existing news-sync and
  intersection surfaces.
- Conflict: no conflict with current real-money gates, paper broker, or risk
  controls.
- Novel: the new behavior treats fallback news freshness as valid only when at
  least one trading-relevant headline is present, and it requires news-position
  intersections to include a distinctive token rather than only generic words.

## Decision

Add a deterministic RSS relevance filter, preserve only selected citations, fix
hex XML entity decoding, and suppress intersection alerts that match only weak
generic slug tokens.

## How This Changes Code/Strategy

The bot still uses the existing `ai-probability` Polymarket strategy and the
existing equities bridge. This sprint improves the quality of real-time context
feeding operator alerts and source-freshness evidence, so the dashboard and
Telegram alerts are less likely to look healthy because of non-trading filler.
