# Dashboard Trading Quick Actions Review - 2026-06-01

## Scope

- `src/dashboard-html.ts`
- `src/dashboard-html.test.ts`
- `docs/plans/2026-06-01-operational-trading-goal.md`
- `docs/handoff/2026-06-01-full-capacity-readiness.md`
- `docs/runbooks/full-capacity.md`
- `docs/codex-review/findings.md`

## Verdict

No P0 or P1 findings.

## Notes

- Dashboard chat quick actions now route to trading commands only:
  `/poly status`, `/poly pnl`, `/trade status`, and `/trade sharpe`.
- Removed visible quick-action entry points for out-of-scope personal-assistant
  workflows: `/todo` and `/gmail`.
- No Tier 3 surfaces changed. This review did not touch `risk-gates.ts`,
  `paper-broker.ts`, `pnl-tracker.ts`, money caps, halt state, broker mode, or
  live-money enablement.

## Verification

- `npx vitest run src/dashboard-html.test.ts` - 5/5 PASS.
- `npm run typecheck` - PASS.
- `npm test` - 75 files, 913 tests PASS.
- `npm run build` - PASS.
- Post-restart served dashboard HTML check - trading quick actions present;
  `/todo` and `/gmail` quick actions absent.
