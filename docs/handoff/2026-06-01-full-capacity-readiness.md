# Full Capacity Readiness - 2026-06-01

## Current State

ClaudeClaw is operational in paper mode for both configured markets:

- Equities: regime-trader PM2 instances are online and reporting `open_full`.
- Polymarket: scanner, signal engine, paper positions, TTL filter tracking, and
  news/source freshness are live.
- Dashboard: health endpoint is healthy and the Evidence Path card now includes
  mark-to-market Polymarket paper P&L. Malformed or rate-limited readiness API
  payloads now render as red unavailable state instead of a false green gate
  pass. The Gate blockers card now shows blocker state, detail, and current /
  target progress for each open real-money gate. The Evidence Path card now
  also shows the live Polymarket resolution queue for open paper trades. The
  Live Readiness card now includes the real-money gate audit summary and next
  actions. Dashboard chat quick actions are trading-scoped: `Poly Status`,
  `Poly P&L`, `Trade Status`, and `Trade Sharpe`. Personal-assistant shortcuts
  such as Todo and Gmail are not present.

Real money remains disabled. This is correct.

## Latest Evidence

- Polymarket Box 2: `0/50` settled trades, `11` open, `23` voided.
- Polymarket mark-to-market: `$26.19` total paper P&L, all unrealized, on
  `$529.35` open exposure. Paper equity is `$5,026.19`.
- Polymarket signal flow: `538` signals and `2` approvals in the last 24 hours,
  approval rate `0.37%`.
- Resolution pipeline: `2` open positions due within 7 days, `5` due within 30
  days, `0` overdue.
- Resolution queue: next paper settlements are trade `#19` and `#23` due
  2026-06-07, then trades `#28`, `#34`, and `#30` due around
  2026-06-30/2026-07-01.
- Real-money gate audit: `3/7` boxes complete, `2` operator actions, `2`
  sample/time blockers, `0` system blockers, and live-money ready `NO`.
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
