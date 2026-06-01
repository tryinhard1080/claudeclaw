# Equity Live-Sync Evidence Review - 2026-06-01

## Scope

- `src/readiness/evidence.ts`
- `src/readiness/evidence.test.ts`
- `scripts/readiness-evidence.ts`
- `src/dashboard.ts`
- `src/dashboard-html.ts`
- `src/dashboard-html.test.ts`
- `docs/plans/2026-06-01-operational-trading-goal.md`
- `docs/handoff/2026-06-01-full-capacity-readiness.md`
- `docs/runbooks/full-capacity.md`
- `docs/codex-review/findings.md`

## Verdict

No P0 or P1 findings.

## Notes

- Adds read-only regime-trader state freshness evidence under operational
  readiness.
- Separates live state sync from daily Sharpe sampling so a `2d` Sharpe snapshot
  over a weekend does not obscure whether the equity bridge is updating now.
- No Tier 3 surfaces changed. This review did not touch `risk-gates.ts`,
  `paper-broker.ts`, `pnl-tracker.ts`, money caps, halt state, broker mode, or
  live-money enablement.

## Verification

- `npx vitest run src/readiness/evidence.test.ts src/dashboard-html.test.ts` -
  15/15 PASS.
- `npm run typecheck` - PASS.
- `npm run readiness:evidence` - reports `Equity state sync` PASS with `2/2`
  fresh/open-full instances and keeps Regime Box 3 WARN at `8/60`.
- `npm run readiness:evidence:record` - snapshot history includes
  `equitySync=2/2`.
- `npm test` - 75 files, 916 tests PASS.
- `npm run build` - PASS.
- Authenticated `/api/readiness/evidence` after rebuild/restart - returned
  `equitySync.status=pass`, `equitySync=2/2`, and `regime=8/60`.
- Post-restart `npm run capacity:status` - operational systems PASS; live
  startup remains blocked by Boxes 1/2/3/7 by design.
