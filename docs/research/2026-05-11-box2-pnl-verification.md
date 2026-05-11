# Box 2 P&L Verification — 2026-05-11

> Plan: `C:\Users\Richard\.claude\plans\review-this-code-base-rustling-whistle.md`, Phase 4.
> Gate context: `MISSION.md` real-money gate Box 2 — "≥50 resolved Polymarket trades with positive realized P&L."

## TL;DR

**Box 2 status: 0 of 50.** Zero trades have resolved (won/lost) since the 30-day Box-1 clock started on 2026-04-21. The 79 figure cited in the 2026-05-09 drill log was the **market resolution cache** (`poly_resolutions`), not the bot's own trade outcomes (`poly_paper_trades.status IN ('won','lost')`).

This is **not a bug** — the resolution cache is correctly populated, the bot's pnl-tracker correctly does not mark a trade as won/lost while `poly_resolutions.closed=0`, and all 10 open positions today still show `closed=0` in the cache. The bot's strategy bias toward long-dated political/event markets is what's preventing Box 2 from clearing on the Box-1 timeline.

## Aggregate Numbers (as of 2026-05-11 07:13 CT)

| Metric | Value |
|---|---|
| Total paper trades ever opened | 31 |
| Open | 10 |
| Won | 0 |
| Lost | 0 |
| Voided (all `voided_reason='delisted'`) | 21 |
| Total realized P&L on resolved trades | $0.00 |
| Distinct slugs in `poly_resolutions` | 87 |
| Open trades whose market is in resolution cache | 10 / 10 (all `closed=0`, `resolved_at=NULL`) |
| Voided trades whose market is in resolution cache | 1 / 21 (rest were delisted before resolution) |
| Signals (lifetime) | 39,996 |
| Approved → fill | 31 (approval rate 0.078%) |
| First trade opened | 2026-04-14 |
| Most recent trade opened | 2026-05-04 (7 days idle since) |

## Why no resolutions

Sampled open positions and their resolution-window characteristics:

| ID | Slug | Resolution date | Time-to-resolve from today |
|---|---|---|---|
| 12 | `strait-of-hormuz-traffic-returns-to-normal-by-april-30` | 2026-04-30 (past) | **OVERDUE — investigate** |
| 19 | `will-roberto-snchez-palomino-win-the-2026-peruvian-presidential-election` | 2026 election | Months |
| 21 | `will-the-us-invade-iran-before-2027` | 2027-01-01 | ~8 months |
| 22 | `us-obtains-iranian-enriched-uranium-by-may-31-396` | 2026-05-31 | 20 days |
| 23 | `will-keiko-fujimori-win-the-2026-peruvian-presidential-election` | 2026 election | Months |
| 27 | `will-jd-vance-win-the-2028-republican-presidential-nomination` | 2028 cycle | **Years** |
| 28 | `will-alphabet-be-the-largest-company-in-the-world-by-market-cap-on-june-30` | 2026-06-30 | ~7 weeks |
| 29 | `will-flvio-bolsonaro-win-the-2026-brazilian-presidential-election` | 2026 election | Months |
| 30 | `will-the-san-antonio-spurs-win-the-2026-nba-finals` | June 2026 | ~5-7 weeks |
| 31 | `will-the-democratic-party-control-the-house-after-the-2026-midterm-elections` | 2026-11-03 | ~6 months |

Most open positions resolve in months to years. Only #22 and #28 might clear before 2026-05-21 (Box 1 target).

## Anomaly — Strait-of-Hormuz #12

Market slug specifies "by April 30" but is still `status='open'` on 2026-05-11. The resolution cache row for this slug shows `closed=0, resolved_at=NULL`. Either:
1. Polymarket has not officially resolved the market yet (rare for past-deadline markets), or
2. The resolution-fetch cron is fetching but Polymarket still reports `closed=0` for this slug, or
3. The market got disputed / extended.

**Action:** add to Phase 6 Sprint 27 audit scope (resolution-fetch backfill). One slug ≠ blocker, but it's a Sprint-27 finding.

## Voided trades

All 21 voids carry `voided_reason='delisted'`. Markets removed from Polymarket before resolution — outside our control. No bug.

## Approval rate

31 approvals on 39,996 signals = **0.078%**. The risk gates are extremely selective. Approval rate is so low that even a 10x increase only yields ~310 trades/year at current scan cadence, and Box 2 (50 resolved) is bounded above by approval rate × resolution rate.

## Implications for Box 2 timing

Box 2 has no explicit timer in `MISSION.md`. The 2026-04-29 roadmap estimated "3 to 6 weeks at current rate." That estimate was made when no trades had resolved yet and assumed the bot would take a mix of short-dated and long-dated markets. Empirically, the bot's selection is heavily long-dated. At the current pace:

- ~31 trades opened in 27 days = ~1.1 trades/day approved
- 21/31 = 68% delisting rate (markets pulled before resolution)
- 0/31 won-or-lost = 0% resolution rate in 27 days

Extrapolation: at current rate, ~5-10 resolved trades by end of June, ~50 resolved trades by ~Q4 2026.

**Real-money gate Box-2 conclusion: cannot clear by 2026-05-21.** Operator decisions to surface:
1. Accept Box 2 takes through ~Q4 2026 at current strategy.
2. Adjust strategy to favor short-dated markets (would require a new sprint, not a tactical change).
3. Lower the bar (e.g., ≥25 resolved) — but `TRUST.md` forbids the bot from lobbying for gate relaxation.

## What this plan does NOT change

- `risk-gates.ts` / `paper-broker.ts` / `pnl-tracker.ts` — all Tier 3 surfaces. No edit in this phase.
- Existing 10 open positions — left to resolve naturally.
- `POLY_HALT_DD_PCT` / `POLY_MAX_TRADE_USD` — Tier 3 capital params, unchanged.

## What this plan WILL change (later phases)

- Phase 5 Issue C — regime-trader fetch-window (separate Box 3, unrelated).
- Phase 6 Sprint 27 — resolution-fetch backfill audit. Add the Hormuz slug anomaly to that sprint's scope.

## MISSION.md Box-2 line annotation (to add in Phase 9 wrap)

```
- [ ] ≥50 resolved Polymarket trades with positive realized P&L.
      (2026-05-11) 0 won + 0 lost / 50. 31 opened ever; 10 open (mostly long-dated); 21 voided (all delisted). Resolution at current strategy/cadence projects to Q4 2026, not Box-1 timeline.
```

## Method (for reproduction)

Run in repo root:

```powershell
node --input-type=module -e "
import Database from './node_modules/better-sqlite3/lib/index.js';
const db = new Database('C:/claudeclaw-store/claudeclaw.db', { readonly: true });
const status = db.prepare('SELECT status, COUNT(*) AS n FROM poly_paper_trades GROUP BY status').all();
const voids = db.prepare(\\\`SELECT voided_reason, COUNT(*) AS n FROM poly_paper_trades WHERE status='voided' GROUP BY voided_reason\\\`).all();
const open = db.prepare(\\\`SELECT id, market_slug, datetime(created_at,'unixepoch') AS opened FROM poly_paper_trades WHERE status='open'\\\`).all();
console.log(JSON.stringify({ status, voids, open }, null, 2));
db.close();
"
```
