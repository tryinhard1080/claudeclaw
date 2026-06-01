# Full Capacity Readiness - 2026-06-01

## Current State

ClaudeClaw is operational in paper mode for both configured markets:

- Equities: regime-trader PM2 instances are online and reporting `open_full`.
- Polymarket: scanner, signal engine, paper positions, TTL filter tracking, and
  news/source freshness are live. Market discovery depth is now tracked as a
  first-class readiness signal so the Gamma first-page cap cannot silently
  starve candidates again. The news-sync RSS fallback now filters for
  trading-relevant headlines before refreshing the source heartbeat, and
  position-intersection alerts require at least one distinctive matched token
  instead of generic words alone.
- Dashboard: health endpoint is healthy and the Evidence Path card now includes
  mark-to-market Polymarket paper P&L. Malformed or rate-limited readiness API
  payloads now render as red unavailable state instead of a false green gate
  pass. The Gate blockers card now shows blocker state, detail, and current /
  target progress for each open real-money gate. The Evidence Path card now
  also shows the live Polymarket resolution queue for open paper trades. The
  Live Readiness card now includes the real-money gate audit summary and next
  actions. Dashboard chat quick actions are trading-scoped: `Poly Status`,
  `Poly P&L`, `Trade Status`, and `Trade Sharpe`. Personal-assistant shortcuts
  such as Todo and Gmail are not present. The Evidence Path card now separates
  equity live-sync freshness from the daily post-close Sharpe sample and shows
  current equity benchmark edge versus buy-and-hold. It also shows Box 2
  pipeline capacity, which separates current settled count from the maximum
  settled count the existing open book could produce. It also shows market
  discovery depth against the widened post-Gamma-cap target, open-book
  quality against the currently active paper-learning filters, and approved
  signal quality against source freshness and edge sanity.

Real money remains disabled. This is correct.

## Latest Evidence

- Polymarket Box 2: `0/50` settled trades, `20` open, `23` voided. The
  current open book can cover at most `20/50` potential settled trades, so at
  least `30` additional resolved trades are needed after the current book.
- Market discovery: latest scan discovered `991/500` target markets, state
  `healthy`, duration about `383ms`. `poly:paper:status` now includes a
  `Market discovery depth` check that warns if discovery falls back near the old
  first-page cap.
- Open-book quality: `14/20` open paper trades pass today's active
  paper-learning filters. The `6` exceptions are long-dated legacy positions
  opened before the 2026-06-01 active TTL/quality filter window.
- Polymarket mark-to-market: `$2.91` total paper P&L, all unrealized, on
  `$944.21` open exposure. Paper equity is `$5,002.91`.
- Polymarket signal flow: `596` signals and `11` approvals in the last 24 hours,
  approval rate about `1.9%`.
- Approved signal quality: latest live check shows `11` approvals in the last
  24 hours, `11/11` linked to paper trades, `9/11` with fresh source context,
  average edge `12.3pp`, max edge `46.0pp`, and one low-confidence high-edge
  watch. Current WARN reasons are one stale source-context approval, one
  missing source-context legacy approval, and one low-confidence high-edge
  watch.
- Resolution pipeline: `5` open positions due within 7 days, `14` due within 30
  days, `0` overdue.
- Resolution queue: next paper settlements are trades `#35` and `#40` due
  2026-06-03, trades `#19`, `#23`, and `#37` due 2026-06-07, then the current
  due-30d queue runs through 2026-07-01.
- Real-money gate audit: `3/7` boxes complete, `2` operator actions, `2`
  sample/time blockers, `0` system blockers, and live-money ready `NO`.
- News source freshness: latest live smoke inserted RSS fallback row `#129`
  with trading-relevant Treasury/Iran, oil/Hormuz, stock-market, and IPO
  headlines. Final `npm run capacity:status` reported `news-sync` PASS at
  `6m` old.
  The scheduled task row is active for the next 2-hour run; its prior
  `last_status=failed` remains historical until the scheduler fires again.
- Equity live sync: `2/2` regime-trader state files fresh during the
  after-hours closed state, latest checked at roughly `12m` max state age. This proves
  the live bridge is synced now; it does not close the daily Sharpe sample gate.
- Equity benchmark evidence: both regime-trader instances currently outperform
  the `spy-buy-hold` benchmark on paper, with latest excess return around
  `+0.79%` for `spy-aggressive` and `+0.80%` for `spy-conservative`. The
  benchmark snapshot writer now exits cleanly with a skip when closed-market
  regime state omits `positions[].current_price`; benchmark status continues to
  use the latest stored rows.
- TTL evidence: latest active candidate set `4/9` inside the 1-30 day TTL band.
- Box 1 paper clock: `elapsed_review_ready`, `41/30` days since 2026-04-21,
  target 2026-05-21, A1 ACK present, MISSION checkbox still open.
- Regime Sharpe: both instances have `8/60` days and positive current Sharpe,
  but the sample is still too small for Box 3.

## Verified Commands

- `npm run agent:surface:check` - PASS.
- `npm run source:freshness:refresh` - PASS.
- `npm run trading:benchmark:snapshot` - wrote 2026-06-01 benchmark snapshot.
- `npm run readiness:evidence:record` - wrote 2026-06-01 readiness snapshot
  with mark-to-market fields.
- `npm run readiness:evidence:cron` - daily snapshot task already registered as
  `readiness-evidence-5056`.
- `npm run capacity:status` - operational systems PASS; live startup FAIL only
  because real-money gate boxes remain blocked.
- `npm run typecheck` - PASS.
- `npx vitest run src/readiness/evidence.test.ts` - 7/7 PASS.
- `npm test` - 74 files, 908 tests PASS.
- `npm run build` - PASS.
- `npx vitest run src/readiness/evidence.test.ts src/dashboard-html.test.ts` -
  25/25 PASS after adding approved-signal-quality evidence.
- `npm run typecheck` - PASS after approved-signal-quality evidence.
- `npm test` - 75 files, 930 tests PASS after approved-signal-quality
  evidence.
- `npm run build` - PASS after approved-signal-quality evidence.
- `npm run readiness:evidence:record` - refreshed the 2026-06-01 readiness
  evidence snapshot with approved signal quality in the persisted payload.
- `pm2 restart claudeclaw-main --update-env` - PASS; `claudeclaw-main`
  online with unstable restarts `0`.
- Authenticated `/api/readiness/evidence` after rebuild/restart - returned
  `signalQualityStatus=warn`, `sourceFresh=9`, `approvals=11`, `linked=11`,
  average edge `12.27pp`, max edge `46pp`, and warning reasons
  `low_confidence_high_edge`, `missing_source_context`, and
  `stale_source_context`.
- Served dashboard HTML after rebuild/restart - contains Evidence Path,
  `Signal qual`, `evidence-signal-quality`, and `poly.approvedSignalQuality`
  wiring.
- Post-restart `npm run capacity:status` - operational systems PASS;
  Financial Datasets MCP connected; Polymarket scans fresh at `0m`; market
  discovery `990/500`; approved signal quality WARN at `9/11` fresh source
  context; `0` system blockers; live startup remains blocked by Boxes 1/2/3/7
  by design.
- `npx vitest run src/poly/news-sync.test.ts src/poly/news-intersection.test.ts`
  - 57/57 PASS after RSS trading-relevance filtering, hex/apos entity
  decoding, and distinctive-token intersection gating.
- `npx tsx scripts/news-sync.ts` - PASS; inserted `rss-fallback` row `#129`
  with trading-relevant fallback headlines, no personal-finance headline in the
  preview, and emitted only geopolitical open-position intersections.
- `npm run source:freshness:refresh` - PASS after the live news-sync smoke.
- `npm run capacity:status` - operational systems PASS; `news-sync` source
  freshness PASS at `1m`; Financial Datasets MCP connected; Polymarket scans
  fresh; `0` system blockers; live startup remains blocked by Boxes 1/2/3/7 by
  design.
- `npx vitest run scripts/equity-benchmark-snapshot.test.ts src/trading/equity-benchmark.test.ts`
  - 6/6 PASS after adding the clean skip for closed-market regime states without
  a SPY `current_price`.
- `npm run trading:benchmark:snapshot` - PASS exit 0 with
  `equity-benchmark-snapshot: SKIP SPY current_price missing from regime state`
  because the current after-hours state lacks a mark price.
- `npm test` - 76 files, 937 tests PASS after the news fallback quality and
  benchmark snapshot skip fixes.
- `npm run build` - PASS after the final changes.
- `pm2 restart claudeclaw-main --update-env` - PASS; `claudeclaw-main` online
  with PID `58836` after restart.
- `Invoke-RestMethod -Uri http://127.0.0.1:3141/health` - healthy, database
  `ok`, Telegram `connected`, agent `main`.
- Final `npm run capacity:status` - operational systems PASS; Financial
  Datasets MCP connected; Polymarket scans fresh at `0m`; market discovery
  `991/500`; news-sync fresh at `6m`; `0` system blockers; live startup remains
  blocked only by Boxes 1/2/3/7 by design.
- Final `npm run readiness:evidence:record` - refreshed the 2026-06-01 snapshot
  with P&L `$2.91`, discovery `991/500`, equity sync `2/2`, and regime
  `8/60d`.
- `npx vitest run src/readiness/gate-progress.test.ts` - 15/15 PASS after Box
  1 parser coverage.
- `npx vitest run src/readiness/gate-progress.test.ts src/dashboard-html.test.ts`
  - 16/16 PASS after dashboard malformed-payload guard.
- `npm run gate:status` - Box 1 now reports `elapsed_review_ready` at `41/30`
  days; live startup still FAILS because Boxes 1/2/3/7 remain WARN.
- Browser/API dashboard verification - `/health` returned `healthy`, the
  readiness API returned Box 1 `elapsed_review_ready` and startup
  `blocked`, and the rendered Gate blockers card showed WARN rows for Boxes
  1/2/3/7 instead of a false green pass.
- `npx vitest run src/dashboard-html.test.ts` - 2/2 PASS after adding detailed
  gate blocker rendering.
- Browser dashboard verification after rebuild/restart - the rendered Gate
  blockers card shows `41/30`, `0/50`, and `8/60` plus blocker details for
  Boxes 1/2/3 and the pending Box 7 sign-off.
- `npx vitest run src/readiness/gate-audit.test.ts` - 3/3 PASS after adding
  the real-money gate audit classifier.
- `npm run gate:audit` - PASS/WARN as expected: no system blockers; operator
  actions are Box 1 paper-clock review and Box 7 final sign-off; sample/time
  blockers are Box 2 settlement count/P&L and Box 3 60-day Sharpe sample.
- `npx vitest run src/dashboard-html.test.ts src/readiness/gate-audit.test.ts`
  - 7/7 PASS after adding the dashboard gate-audit rendering guard.
- `npx vitest run src/dashboard-html.test.ts` - 5/5 PASS after replacing
  non-trading chat quick actions with trading commands and regression coverage.
- `npx vitest run src/readiness/evidence.test.ts src/dashboard-html.test.ts` -
  15/15 PASS after adding the equity live-sync evidence surface.
- `npm run readiness:evidence` - PASS/WARN as expected; adds `Equity state
  sync` PASS with `2/2` fresh/open-full instances while keeping Regime Box 3
  WARN at `8/60`.
- `npm run readiness:evidence` - PASS/WARN as expected after adding equity
  benchmark evidence; `Equity benchmark` PASS shows `spy-aggressive
  excess=+0.79%` and `spy-conservative excess=+0.80%`.
- `npx vitest run src/readiness/evidence.test.ts src/dashboard-html.test.ts` -
  18/18 PASS after adding Box 2 pipeline capacity coverage.
- `npm run readiness:evidence:record` - refreshed the 2026-06-01 readiness
  evidence snapshot with `potential=11/50` and `additional resolved need=39`.
- `npm test` - 75 files, 919 tests PASS after Box 2 pipeline capacity.
- `npm run build` - PASS after Box 2 pipeline capacity.
- `pm2 restart claudeclaw-main --update-env` - PASS; `claudeclaw-main` online.
- Authenticated `/api/readiness/evidence` after rebuild/restart - returned
  `potential=11`, `target=50`, `additionalNeed=39`,
  `pipelineMetric=open_book_underfilled`, and snapshot history matching
  `11/39`.
- Browser dashboard DOM after rebuild/restart - Evidence Path rendered
  `settled=0/50`, `Box 2 pipe=11/50`, detail text containing `box2
  potential` and `need 39`, and the resolution queue still rendered 10 rows.
- Post-restart `npm run capacity:status` after Box 2 pipeline capacity -
  operational systems PASS; Financial Datasets MCP connected; Polymarket scans
  fresh at `1m`; Box 2 pipeline capacity WARN explicitly reports `11/50`
  potential and `39` more resolved trades needed; `0` system blockers; live
  startup remains blocked by Boxes 1/2/3/7 by design.
- `npm run readiness:evidence:record` - earlier refreshed the 2026-06-01
  readiness evidence snapshot; snapshot history showed `equitySync=2/2`.
- `npm test` - 75 files, 916 tests PASS after equity live-sync evidence.
- `npm run build` - PASS after equity live-sync evidence.
- Authenticated `/api/readiness/evidence` after rebuild/restart - returned
  `status=warn`, `equitySync.status=pass`, `equitySync=2/2`,
  `regimeSharpe=8/60`, and history `equitySync=2/2`.
- Post-restart `npm run capacity:status` - operational systems PASS; Financial
  Datasets MCP connected; Polymarket scans fresh; both regime-trader instances
  `open_full`; `Equity state sync` PASS at `2/2`; `0` system blockers; live
  startup remains blocked by Boxes 1/2/3/7 by design.
- Post-restart `npm run capacity:status` after equity benchmark evidence -
  operational systems PASS; Financial Datasets MCP connected; Polymarket scans
  fresh at `2m`; both regime-trader instances `open_full`; `Equity benchmark`
  PASS with `+0.79%` minimum excess return; `0` system blockers; live startup
  remains blocked by Boxes 1/2/3/7 by design.
- `npm test` - 75 files, 913 tests PASS after rebuild and sequential rerun.
- `npm run build` - PASS.
- `pm2 restart claudeclaw-main --update-env` - PASS; `claudeclaw-main` online.
- `Invoke-RestMethod http://127.0.0.1:3141/health` - healthy, database `ok`,
  Telegram `connected`, agent `main`.
- Served dashboard HTML verification - contains `/poly status`, `/poly pnl`,
  `/trade status`, and `/trade sharpe`; does not contain `/todo` or `/gmail`
  quick actions.
- Post-restart `npm run capacity:status` - operational systems PASS; Financial
  Datasets MCP connected; Polymarket scans fresh at `0m`; both regime-trader
  instances `open_full`; `0` system blockers; live startup remains blocked by
  Boxes 1/2/3/7 by design.
- Authenticated `/api/readiness/live` after rebuild/restart - returned
  `gateAudit.status=warn`, `3/7` complete, `2` operator actions, `2`
  sample/time blockers, `0` system blockers, and `liveMoneyReady=false`.
- Headless Chrome dashboard render after rebuild/restart - Live Readiness card
  showed the Gate audit panel with `3/7 complete`, `NO live ready`, `2
  operator`, `2 sample/time`, `0 system`, and the Box 1/2/3/7 next actions.
- `npx vitest run src/readiness/evidence.test.ts src/dashboard-html.test.ts` -
  10/10 PASS after adding the read-only resolution queue.
- `npm run readiness:evidence` - PASS/WARN as expected and prints the live
  `11`-row resolution queue ordered by next end date.
- `npm run capacity:status` after rebuild/restart - operational systems PASS;
  live startup remains FAIL by design because Boxes 1/2/3/7 remain blocked.
- Dashboard DOM verification - Evidence Path rendered the `10`-row resolution
  queue with `due 7d` and `due 30d` rows; screenshot capture timed out in the
  in-app browser, but API and DOM evidence matched.

## Remaining Live-Money Blocks

- Box 1: 30-day paper clock has elapsed evidence and A1 ACK, but the MISSION
  checkbox remains open. Richard or a mission-review pass must explicitly close
  the checkbox before live-money readiness can treat it as complete.
- Box 2: Polymarket still has `0/50` settled trades with positive realized P&L.
- Box 3: regime-trader has `8/60` days toward the Sharpe sample.
- Box 7: Richard's final written live-money sign-off is still pending.

`npm run gate:audit` and the dashboard Gate audit panel are the quickest
operator-action view for the remaining live-money blockers. They are read-only
and do not change caps, halts, flags, or broker/risk-gate behavior.

Do not enable real-money trading, change monetary caps, or weaken risk gates.
