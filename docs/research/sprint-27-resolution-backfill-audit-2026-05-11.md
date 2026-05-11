# Sprint 27 — Resolution-Fetch Backfill Audit (2026-05-11)

> Plan: `C:\Users\Richard\.claude\plans\review-this-code-base-rustling-whistle.md`, Phase 6 / Sprint 27. Source backlog entry: `docs/plans/2026-04-29-sprint-roadmap.md` Track B.

## Verdict

**Audit finding only. No code change in this session.** Surfaces a coverage gap and a confirmation of the Phase-4 structural finding from a different angle. Recommended follow-up: a focused Sprint 27 implementation to seed the resolution-fetch cron with the bot's *open-trade* slugs, not just the scanner-evaluated slug pool.

## Method

Three queries against `C:\claudeclaw-store\claudeclaw.db` at 2026-05-11 07:45 CT:

1. Count distinct `market_slug` in `poly_signals` (lifetime evaluations).
2. Count distinct `slug` in `poly_resolutions` (cache size).
3. JOIN `poly_paper_trades` against `poly_resolutions` to find: (a) closed-but-still-open trades, (b) trades whose market has no cache row at all.

## Results

| Metric | Value |
|---|---|
| Distinct slugs evaluated (lifetime) in `poly_signals` | 223 |
| Distinct slugs in `poly_resolutions` cache | 87 |
| `poly_resolutions` rows where `closed = 1` | **0** |
| Trades where cache says `closed=1` but trade is `status != 'won'/'lost'/'voided'/'exited'` (stuck) | 0 |
| Trades with NO cache row at all (LEFT JOIN NULL) | **20** |

## Findings

### Finding 1 — Zero markets the bot has touched have resolved on Polymarket

`SUM(closed)` in `poly_resolutions` is 0 across all 87 cached rows. Every market the fetch-cron has pulled is still open on Polymarket. This confirms — from the resolution-fetcher's perspective — the Phase-4 P&L verification finding that Box 2 has 0 resolved trades. The cause is not a fetcher bug; the cause is that no market the bot has approved a position on has actually settled yet.

### Finding 2 — Coverage gap: 20 of 31 lifetime trades have no cache row

The bot has opened 31 paper trades since 2026-04-14 (see `docs/research/2026-05-11-box2-pnl-verification.md`). Only 11 of those 31 trades have a corresponding row in `poly_resolutions`. The other 20 trades' markets were never pulled by the resolution-fetch cron.

Two possible causes:

- **A.** The fetch-cron samples from the scanner-evaluated slug pool (223 distinct), and 20 of our 31 trades happen to be in a tail that the sampler hasn't reached yet.
- **B.** The fetch-cron is supposed to prioritize open-trade slugs, and a regression or schedule gap has caused it to skip them.

Either way, the bot lacks resolution-cache rows for two-thirds of its open positions. When those markets eventually resolve, the cache won't have them and the `pnl-tracker` won't transition the trades to `won` / `lost` until the next scheduler fire.

### Finding 3 — Combined with Phase 4 P&L verification: structural Box-2 blocker confirmed

Phase 4 (`docs/research/2026-05-11-box2-pnl-verification.md`) projected Q4 2026 to clear Box 2 based on opened-but-unresolved counts. This Sprint 27 audit reaches the same conclusion from the resolution-fetcher angle: 0 of 87 cached markets are closed. The 20-trade coverage gap doesn't change Box 2 timing — even with perfect cache coverage, no underlying market has resolved.

## Recommended Sprint 27 implementation (deferred)

Not in scope for this session — but the audit shape is now clear. A future Sprint 27 should:

1. Seed the resolution-fetch cron's slug list with `SELECT DISTINCT market_slug FROM poly_paper_trades WHERE status='open'` (priority queue), then top up with scanner-evaluated slugs (background queue).
2. Add a metric `resolution_cache_coverage_pct` = `(trades_with_cache / total_open_trades) * 100`. Target ≥95%.
3. Alarm if coverage drops below 80% for 2 consecutive fetch cycles.
4. Regression test in `src/poly/research-ingest.test.ts` (or wherever the resolution-fetcher lives) — seed 5 open trades, run fetcher, assert all 5 have cache rows.

Effort estimate: ~1.5-2 hours (one new SQL query, one new metric column or table, one new alarm, one regression test, one cron config change).

## Disposition

**Audit complete. Code change deferred** to a focused Sprint 27 implementation session. The coverage gap is non-urgent because no markets have actually resolved yet (Finding 1 — 0 closed in cache). It becomes urgent the moment Polymarket starts resolving any of the bot's open positions, because the gap means the `pnl-tracker` won't catch the resolution until the cache row arrives.

Open chore added to `BACKLOG.md` Track-E in the Phase 9 wrap.
