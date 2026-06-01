# Codex review - Open P&L attribution evidence - 2026-06-01

## Scope reviewed

- `src/readiness/evidence.ts`
- `scripts/readiness-evidence.ts`
- `src/dashboard-html.ts`
- `src/readiness/evidence.test.ts`
- `src/dashboard-html.test.ts`
- readiness plan, runbook, handoff, and findings ledger

## Change summary

Adds read-only Polymarket open-book P&L attribution to the operational evidence
surface. The CLI and dashboard now show open winners, losers, flat trades, gross
open profit/loss, and the worst open paper trade so strategy review can identify
the current mark-to-market drag before changing strategy parameters.

No `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, monetary cap, halt, or
live-money flag changes.

## Findings

Zero P0/P1 findings.

## Verification

- `npx vitest run src/readiness/evidence.test.ts src/dashboard-html.test.ts` -
  27/27 PASS.
- `npm test` - 76 files, 940 tests PASS.
- `npm run typecheck` - PASS.
- `npm run build` - PASS.
- `npm run readiness:evidence` - PASS/WARN as expected; prints open
  winners/losers/flat, gross open win/loss, and worst open trade.
- `npm run readiness:evidence:record` - recorded the 2026-06-01 readiness
  evidence snapshot.
- `pm2 restart claudeclaw-main --update-env` - PASS; `claudeclaw-main` online.
- `/health` - healthy; database ok, Telegram connected, agent main.
- `npm run capacity:status` - operational systems PASS; live-money startup
  remains blocked by Boxes 1/2/3/7 by design, with zero system blockers in gate
  audit.
- Authenticated `/api/readiness/evidence` - returned open P&L attribution:
  winners/losers/flat `3/17/0`, gross open win/loss `$122.48/-$123.46`, worst
  open trade `#28` at `-$46.03`.
- Browser dashboard verification - Evidence Path rendered open P&L attribution
  and the 10-row resolution queue.
