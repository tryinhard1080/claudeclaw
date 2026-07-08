# Sprint 2026-06-29 - News Intersection Alert Quality

## Scope

Reduce false or confusing news-position alerts during the 5-trading-day
launch-readiness sprint. This is operator-awareness plumbing only. It does not
change strategy selection, order execution, risk gates, paper broker behavior,
P&L resolution, monetary caps, halt state, or live-money flags.

Touches:

- `src/poly/news-intersection.ts`
- `src/poly/news-intersection.test.ts`
- `docs/plans/2026-06-29-five-trading-day-launch-readiness-sprint.md`

## Existing-Code Audit

| Surface | Verdict | Notes |
|---|---|---|
| `src/poly/news-intersection.ts` token overlap | Complement | Existing deterministic matching is the right shape, but it matches against a full multi-headline RSS fallback bundle. Tokens can combine across unrelated bullets. |
| `src/poly/news-intersection.ts` alert formatter | Complement | Existing formatter previews the first 220 characters of the whole summary, which can show an unrelated headline even when the match is real. |
| `src/poly/news-sync.ts` RSS fallback | Reuse | RSS fallback produces one summary with multiple bullet lines. Keep it, but match on individual lines. |
| `src/poly/risk-gates.ts`, `src/poly/paper-broker.ts`, `src/poly/pnl-tracker.ts` | No change | Tier-3 surfaces remain untouched. |

## Duplicate / Complement / Conflict / Novel Verdict

- Duplicate: no existing segment-aware news-intersection matcher was found.
- Complement: this tightens the existing Sprint 21 deterministic matcher.
- Conflict: no conflict with paper-only operation, real-money gates, scheduler
  cadence, source freshness, or news ingestion.
- Novel: the alert text now carries the matching headline segment instead of
  a generic preview of the full multi-headline bundle.

## Decision

Match open-position slugs against individual summary segments. For RSS fallback
rows, each bullet is a segment. For ordinary model summaries, each non-empty
line is a segment, with the full summary retained as a fallback. A trade only
matches when the required token threshold is satisfied within one segment.

Also treat generic directional/value words such as `reach`, `above`, `below`,
and `price` as weak intersection tokens. They can support a match with a real
entity token but cannot be the distinctive anchor.

## How This Changes Code/Strategy

The news alert path becomes less noisy during paper trading. It does not feed
orders and does not affect the `ai-probability` strategy or deterministic risk
gates. It improves operator review quality while the system waits for Box 2
settlements and Box 3 sample time.
