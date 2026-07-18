# Sprint R1 — Resolution repair: Gamma closed=true fallback

Date: 2026-07-18
Parent plan: docs/plans/2026-07-18-repo-review-and-fix-plan.md
Operator approval: Richard, in chat 2026-07-18 ("Approved — go ahead and fix it",
item 1: R1 greenlit).

## Problem

Lifetime paper book: 0 won, 0 lost, 172 voided (all `voided_reason='delisted'`),
50 stuck open with 12+ past end date beyond grace. `poly_resolutions`: 468 rows,
zero ever `closed=1`. All 9,047 signals in 24h rejected on
`open_position_count 50 >= max 50`. MISSION Box 2 frozen at 0/50 settled.

## Root cause (live-API verified 2026-07-18)

Gamma's `/markets?slug=X` list query EXCLUDES closed markets by default. A
resolved market returns `[]` with HTTP 200; it is only visible with
`closed=true` appended. `fetchMarketBySlug` (src/poly/gamma-client.ts) used the
plain query, and its doc comment ("it returns closed markets too") was wrong
about live behavior. Every consumer downstream was structurally blind to
resolution:

- `scripts/fetch-resolutions.ts` recorded resolved markets as "miss"
  (last cron run: 75 slugs, ok=19 miss=41+, closed=0) and never updated the
  frozen cache row.
- `PnlTracker` live fetch got null → classified trades delisted/voided, or the
  Sprint 29 cache fallback read the frozen `closed=0` snapshot → trade stays
  open forever.

Live probes: `will-jannik-sinner-...-wimbledon-winner`, `strait-of-hormuz-...
-july-7-...`, `will-a-team-from-lck-...-msi-2026` → all EMPTY on plain query,
all `closed=true` with final [1,0]/[0,1] price vectors with the param. Open
control (`will-jesus-christ-return-before-gta-vi-665`) still returned by the
plain query with live prices.

## Existing-code audit

- verdict: **conflict** — `fetchMarketBySlug`'s stated contract (comment lines
  174-177) conflicted with live API behavior; no other module implements a slug
  lookup; `fetchMarketById` exists but trades don't persist numeric ids.
- **complement**: the OTHER active session's uncommitted Sprint 30 diff in
  pnl-tracker.ts (`recoverVoidedFromCache`, reclassifies voided-delisted once
  cache shows closed=1) becomes effective the moment this fix ships. Left
  untouched per operator instruction to work around concurrent sessions.
- **duplicate**: none. **novel**: the ~6-line fallback itself.

## Change

`src/poly/gamma-client.ts` `fetchMarketBySlug`: on empty result from the plain
slug query, retry once with `&closed=true`; corrected the false comment.
Ordering (plain first) preserves open-market behavior; verified `closed=true`
returns empty for still-open markets, so the fallback cannot misreport an open
market as closed.

TDD: 4 new tests in src/poly/gamma-client.test.ts (fallback on empty, no
fallback when plain query hits, true miss → null after both queries, fallback
HTTP failure → null not throw). Red first (2 failed), green after fix.

## How this changes our code/strategy

One seam repairs both consumers: the 2h resolution-fetch cron starts writing
closed=1 rows with final price vectors, and PnlTracker's live path starts
seeing resolved markets directly. Expected sequence after deploy: backfill
fetch-resolutions run → hourly runOnce settles the ~50 stuck-open trades →
Sprint 30 recovery (other session) sweeps the 172 voided ones. This should
populate the Box 2 settled-trade sample for the first time. Realized P&L
lands wherever it lands — that is gate evidence, not a tunable.
