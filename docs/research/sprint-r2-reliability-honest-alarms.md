# Sprint R2 — Reliability hardening and honest alarms

Date: 2026-07-18
Parent plan: docs/plans/2026-07-18-repo-review-and-fix-plan.md (R2)
Operator approval: Richard, in chat 2026-07-18 ("Proceed through the rest of the
plan (R2->R4)"; news-sync: "keep it ONLY if it's actually consumed by the bot").

## Existing-code audit

- **duplicate:** none. No fetch-timeout helper existed anywhere in src/;
  every Polymarket HTTP call (gamma getJson, clob fetchBook/fetchMidpoint)
  used bare fetch() with no AbortController.
- **complement:** market-scanner and strategy-engine already release their
  reentrancy guards in finally blocks, so bounding the fetches is sufficient
  to convert a hang into a recoverable error (the 2026-04-20 stall class).
- **conflict:** scheduler-status.ts asserted a news_sync cadence that the
  system could no longer honestly satisfy (see below).
- **novel:** src/poly/http.ts fetchWithTimeout; book-full tick short-circuit;
  closed-slug exclusion in the resolution priority queue.

## Changes

1. **src/poly/http.ts (new):** fetchWithTimeout, 15s default, AbortController
   based. Wired into gamma-client getJson and clob-client fetchBook /
   fetchMidpoint. Rationale: one half-open socket held `scanning`/`running`
   guards forever and silently stopped scanning and trading until manual
   restart. 3 tests (fake-timer abort proof, passthrough, signal wiring).
2. **strategy-engine.ts:** when openPositionCount >= maxOpenPositions, skip
   the evaluation tick entirely. Evidence: 2026-07-17/18 the book sat at 50/50
   while ~9,000 signals/day were evaluated and 100% rejected on
   position_limits — pure LLM spend. Regression test proves evaluate() is
   never called when the book is full.
3. **resolution-coverage.ts:** buildSlugPriorityQueue excludes signal-backlog
   slugs whose poly_resolutions row is closed=1 (final, immutable); open-trade
   slugs stay unconditional. Kills the permanent 2-requests-per-resolved-slug
   amplification found in the R1 review. 2 tests.
4. **news-sync retired.** Decision per operator rule "keep only if the bot
   consumes it": nothing on the trading path reads news_items (freshness row
   was usedBySignal=false; no strategy/engine import). Its 2h LLM cron task
   (3d623e0e) had reported "success" while persisting nothing since
   2026-06-28 — a silent failure violating TRUST. Actions: cron task deleted;
   news_sync cadence removed from scheduler-status.ts; refreshNewsSync
   replaced with retireNewsSyncRow (deletes the stale source_freshness row);
   HEARTBEAT.md tick table updated. The news-sync.ts / news-intersection.ts
   modules and dashboard panel remain in place (dormant) for the R4 dead-code
   sweep; check-prompt-drift still snapshots NEWS_SYNC_PROMPT harmlessly
   until then.

## How this changes our code/strategy

Scan/trade loop can no longer be wedged by a single hung socket; LLM spend
drops to zero while the book is full (scan + price capture continue); the
resolution fetch cron's request budget stops growing with settled history;
and the readiness surface no longer carries a permanently-stale news signal
that trained the operator to ignore WARN rows. No trading-strategy or
risk-parameter change.
