# Full Capacity Readiness - 2026-06-01

## Current State

ClaudeClaw is operational in paper mode for both configured markets:

- Equities: regime-trader PM2 instances are online and reporting `open_full`.
- Polymarket: scanner, signal engine, paper positions, TTL filter tracking, and
  news/source freshness are live.
- Dashboard: health endpoint is healthy and the Evidence Path card now includes
  mark-to-market Polymarket paper P&L.

Real money remains disabled. This is correct.

## Latest Evidence

- Polymarket Box 2: `0/50` settled trades, `10` open, `23` voided.
- Polymarket mark-to-market: `$27.78` total paper P&L, all unrealized, on
  `$479.35` open exposure. Paper equity is `$5,027.78`.
- Polymarket signal flow: `540` signals and `1` approval in the last 24 hours,
  approval rate `0.19%`.
- Resolution pipeline: `2` open positions due within 7 days, `4` due within 30
  days, `0` overdue.
- TTL evidence: latest active candidate set `4/9` inside the 1-30 day TTL band.
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
- `npm test` - 73 files, 902 tests PASS.
- `npm run build` - PASS.

## Remaining Live-Money Blocks

- Box 1: 30-day paper clock still needs mission review classification.
- Box 2: Polymarket still has `0/50` settled trades with positive realized P&L.
- Box 3: regime-trader has `8/60` days toward the Sharpe sample.
- Box 7: Richard's final written live-money sign-off is still pending.

Do not enable real-money trading, change monetary caps, or weaken risk gates.
