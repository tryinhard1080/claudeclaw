# Sprint 2026-06-29 - News Sync Tool Error Guard

## Scope

Prevent trading-news source freshness from going green on a tool error string.
This is read-only market-context plumbing. It does not change strategy
selection, order execution, risk gates, paper broker behavior, monetary caps,
halt state, or live-money flags.

Touches:

- `src/poly/news-sync.ts`
- `src/poly/news-sync.test.ts`
- `scripts/source-freshness-refresh.ts`
- `scripts/source-freshness-refresh.test.ts`
- `docs/plans/2026-06-29-five-trading-day-launch-readiness-sprint.md`

## Existing-Code Audit

| Surface | Verdict | Notes |
|---|---|---|
| `src/poly/news-sync.ts` `extractSummary` | Complement | Correctly rejects malformed API objects, but it cannot reject a well-formed `answer` whose text is actually a tool error. |
| `src/poly/news-sync.ts` `isRefusalResponse` | Complement | Existing refusal guard keeps most live-search refusals out of `news_items`; the 2026-06-29 smoke found a narrower "live tool access" refusal that needs the same treatment. |
| `src/poly/news-sync.ts` RSS fallback | Reuse | Existing fallback is the right safe recovery path when the live search route returns unusable text. |
| `scripts/source-freshness-refresh.ts` | Complement | Freshness should continue to read `news_items`, but it should not trust `status='ok'` when the latest summary text is a known refusal or tool-error string. |
| `src/poly/risk-gates.ts`, `src/poly/paper-broker.ts`, `src/poly/pnl-tracker.ts` | No change | Tier-3 surfaces remain untouched. |

## Duplicate / Complement / Conflict / Novel Verdict

- Duplicate: no existing guard was found for `ResponseParsingError` or
  `Failed to parse API response` text stored as a successful summary.
- Duplicate update: no existing guard caught `I don't currently have live tool
  access to pull the very latest two-hour headlines`, so that answer was also
  able to enter `news_items` as `status='ok'`.
- Complement: extends the existing refusal/fallback behavior to tool-error
  summaries and live-tool-access refusals at the same producer boundary.
- Conflict: no conflict with paper-only operation, real-money gates, source
  freshness thresholds, or scheduler behavior.
- Novel: prevents a successful `pwm` subprocess with unusable answer text from
  becoming an `ok` `news_items` row.

## Decision

Treat deterministic tool-error summaries and live-tool-access refusals as
unusable live-search output. If a fallback fetcher is available, insert the RSS
fallback row instead. If no fallback is available, return `ok=false` and do not
update the heartbeat. Also make source-freshness refresh reject any latest
`news_items` row whose summary is a known refusal/tool-error string, preserving
the previous good success timestamp instead of treating bad text as fresh.

## How This Changes Code/Strategy

Trading decisions still use the existing `ai-probability` strategy and existing
risk gates. This only improves source-quality evidence so readiness reports do
not treat a parser error or live-tool-access refusal as fresh trading news, even
if a bad row enters the database before the producer-side guard or through a
future ingestion bug.
