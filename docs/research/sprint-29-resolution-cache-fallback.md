# Sprint 29 — Resolution cache fallback in PnL tracker

**Date:** 2026-07-02
**Owner:** main (claudeclaw)
**Touches:** `src/poly/pnl-tracker.ts`, tests, new `scripts/backfill-voided-resolutions.ts`
**Severity:** high — 6 weeks of paper P&L structurally lost, calibration signal dead.

## Bug

Diagnosis pass 2026-07-02 09:xx: **147 of 147 closed paper trades voided as `delisted`. Zero wins, zero losses.** Live audit slugs (`will-usa-reach-the-round-of-16-...`, `will-england-reach-...`, `will-40-ships-transit-hormuz-by-june-30-2026`) confirm these are real markets that resolved on schedule — they didn't fail to resolve, they got delisted from Gamma's public list shortly after settlement (~30-60 min window is standard Polymarket behavior).

Root cause is precisely one function.

`src/poly/pnl-tracker.ts:64-66`:
```ts
export function makeDefaultMarketFetcher(_db: Database.Database): MarketFetcher {
  return async (slug: string) => fetchMarketBySlug(slug);
}
```

The parameter `_db` is unused. The inline comment (line 61) actually anticipates this exact fix — "`db` is intentionally unused — kept in the signature so callers can swap in a cache-backed fetcher without changing construction sites." The scaffolding for the fix was pre-built; the fix itself never landed.

Reconciliation flow (line 137-139):
```ts
const market = await this.marketFetcher(t.market_slug);
const classification = classifyResolution(market, t.outcome_token_id);
```

When `fetchMarketBySlug` returns null (delisted), `classifyResolution` hits line 36-38 and returns `{status: 'voided', voidedReason: 'delisted'}`. **Every single closed trade for the last 6 weeks.**

Meanwhile, `poly_resolutions` (populated by the resolution-fetch cron, coverage tracked by Sprint 27's `resolution-coverage.ts`) has the answer:

| voided_slugs | cached |
|--------------|--------|
| 142          | 96     |

67.6% of voided trades have a cache row containing the resolved `outcomes_json` price vector — including the `price=1.0` winner. The classifier just never asks.

## Existing-code audit

| File | Relation | Status |
|------|----------|--------|
| `pnl-tracker.ts` (`makeDefaultMarketFetcher`, `classifyResolution`) | **Broken** — needs cache fallback wired in. | Modify |
| `pnl-tracker.ts` (`runOnce`) | **Unchanged** — still receives Market-or-null from injected fetcher. Interface stable. | Unchanged |
| `pnl-tracker.ts` (`classifyResolution`) | **Unchanged** — pure classifier, correct as written. Bug lives one layer up in the fetcher. | Unchanged |
| `resolution-coverage.ts` (Sprint 27) | **Complement** — already tracks cache coverage from the outside. Confirms cache is being populated but reveals no one reads it for classification. Coverage metric now becomes actionable. | Unchanged |
| `gamma-client.ts` (`fetchMarketBySlug`, `GammaMarketSchema`) | **Unchanged** — live fetch remains primary. Cache is fallback only. | Unchanged |
| `scripts/fetch-resolutions.ts` | **Unchanged** — cron path already correct; the cache it produces just wasn't being consumed. | Unchanged |

### Verdict: FIX (regression against pre-baked scaffolding), not novel

## Scope

**In:**
1. `pnl-tracker.ts` — replace `makeDefaultMarketFetcher` with a chained fetcher: live Gamma → on-null cache lookup → on-both-null null. Reconstruct a synthetic `Market` from `poly_resolutions.outcomes_json` + `closed` flag. Only the fields `classifyResolution` reads matter (`closed`, `outcomes[].price`, `outcomes[].tokenId`).
2. Tests: mock fetcher returns null → cache row is consulted → correct won/lost classification. Cache miss → still voids-as-delisted. Cache-row-with-closed=0 → returns open (do not falsely mark open trades as closed just because a stale cache row exists).
3. `scripts/backfill-voided-resolutions.ts` — one-shot retroactive re-classification of the 147 existing voided trades. Only touches rows where `status='voided' AND voided_reason='delisted'`. Uses the new cache fallback to reconstruct each Market; if classification flips to won/lost, updates `status`, `realized_pnl`, clears `voided_reason`. Logs a summary.

**Out:**
- Fetching missing resolutions from live Gamma during backfill. If the cache doesn't have the row (51 of 142), the trade stays voided. A separate one-shot script can pull those directly by conditionId from Polymarket's data-API if operator asks — different scope.
- Cache write-through on live-fetcher success. The resolution-fetch cron owns population; pnl-tracker stays read-only against the cache.
- Changing the `classifyResolution` function itself. It's correct; the fetcher above it is the bug.

## Why now / why urgent

- Paper trading with 100% void closure rate produces zero calibration signal. ai-probability v3-desc has no feedback loop, so the whole Sprint 28 investment is running blind on outcomes.
- The 50 currently-open positions will hit this same bug the moment they resolve. Fixing forward-only means the next wave of resolutions also joins the void graveyard while we wait for the backfill.
- The `_db` parameter and the comment inviting a cache-backed fetcher were already there. This is completing pre-baked scaffolding, not new architecture.

## Test plan (TDD shape)

Failing tests first:

1. **Cache fallback: live-null + cache-hit-won → won.** Mock live returns null. Insert a `poly_resolutions` row with `closed=1` and outcomes where the held tokenId has `price=1.0`. Expect classification `won`.
2. **Cache fallback: live-null + cache-hit-lost → lost.** Same shape but held tokenId has `price=0.0`; another outcome has `price=1.0`. Expect `lost`.
3. **Cache fallback: live-null + cache-miss → delisted-void.** No cache row. Expect the existing `{status: 'voided', voidedReason: 'delisted'}` result unchanged.
4. **Cache fallback: live-null + cache-hit-with-closed=0 → open.** A stale cache row that hasn't been marked closed yet must NOT falsely resolve the trade. Expect `open`.
5. **Live-hit takes precedence over cache.** Live returns a valid closed market. Cache has a *different* winning outcome (simulate cache row staleness). Expect classification to match the live market, not the cache.
6. **Backfill script: only touches `voided_reason='delisted'` trades.** Trades that voided for `unresolved` reason are left alone. Trades with `status='won'` or `'lost'` are untouched.

Tests live in `src/poly/pnl-tracker.test.ts` (assumed existing); backfill script gets its own `scripts/backfill-voided-resolutions.test.ts` if the harness supports it, otherwise inline dry-run mode with test fixtures.

## Rollout

Tier 2 (do then report). Zero risk-gate touch, zero broker-code touch, paper-only path. No real-money exposure.

Sequence:
1. Ship the fetcher fix (green tests, build, commit).
2. `pm2 restart claudeclaw-main` so the running reconciliation loop starts using it.
3. Run `npx tsx scripts/backfill-voided-resolutions.ts --dry-run` — see how many trades would flip.
4. If dry-run summary looks sane (expect ~96 flips, ~51 stay voided legitimately, 0 open → any status): rerun without `--dry-run`.
5. Verify: query poly_paper_trades for status distribution + total realized_pnl.

## Backfill semantics — hard rules

- Only touch rows where `status='voided' AND voided_reason='delisted'`.
- Never touch rows where `status IN ('open', 'won', 'lost')`.
- Never touch rows where `voided_reason != 'delisted'` (e.g., `unresolved` voids are a different failure mode).
- Recompute `realized_pnl` from entry_price × shares × (payout=1 if won else 0) — mirror `paper-broker.ts`'s existing arithmetic (find the exact function and reuse, don't duplicate).
- Emit a summary log line and a JSON audit file so the operator can reconcile before + after totals.

## How this changes our code/strategy

Direct: the 100% void-rate stops. Real wins and losses flow into P&L. ai-probability v3-desc gets its feedback loop back.

Strategic: the calibration signal we've been trying to accumulate since Sprint 28 shipped will finally exist. The 15,945 v3-desc signals from the last 7 days can now be scored against actual outcomes for the ones that have closed. Before the fix, all 147 closes were noise.

## Open follow-ups (out of scope)

- Fetch missing resolutions directly from Polymarket's data-API for the 51 uncached voided slugs.
- Add an alarm: if `voided_reason='delisted'` fires on a new trade AND cache is empty for that slug, log at ERROR — that's the resolution-fetch cron missing a market that pnl-tracker just tried to reconcile.
- Consider a cache-freshness check in the fallback: if the cache row is >72h old and shows `closed=0`, might be stale (market got resolved but cron hasn't refreshed). Nice-to-have; low incidence.

## Backfill dry-run findings (2026-07-02)

Ran `scripts/backfill-voided-resolutions.ts --dry-run` against the live DB immediately after implementation. Result:

- Total candidates: 147
- Flipped to won: 0
- Flipped to lost: 0
- Stayed voided (no cache row): 46
- Stayed voided (cache row present but `closed=0`): **101**

**Second bug discovered:** for 101 of the voided-delisted trades, the cache row exists but reports `closed=0` — including markets whose real-world deadline passed 1-3 days ago (e.g., "80-ships-transit-hormuz-by-june-30-2026" refreshed today 12:55 UTC still shows closed=0).

Most likely root cause: Polymarket's Gamma `closed` field only flips to true when UMA posts a definitive winning outcome, not simply when the market's deadline passes. Post-deadline markets sit in a "trading ended, resolution pending" state for a variable window (hours to days). The resolution-fetch cron IS re-fetching (fetched_at updates), but the source data isn't yet in the closed=1 state.

**Sprint 29 fix remains correct forward-looking:** any market that DOES eventually get its cache refreshed to closed=1 while the paper_trade is still open (in the priority queue) will now classify won/lost properly.

**Backfill deferred, not abandoned:** the script ships dormant. Once Sprint 30 (see below) restores cache freshness for orphaned voids, re-running the backfill will recover the 101.

## Sprint 30 candidate (not this sprint)

Extend `buildSlugPriorityQueue` in `resolution-coverage.ts` to include slugs from `poly_paper_trades WHERE status='voided' AND voided_reason='delisted' AND resolved_at > <now - 30d>`. That way the cron continues polling recently-voided trades until UMA posts their resolutions, at which point the cache flips closed=1 and the backfill can recover them.
