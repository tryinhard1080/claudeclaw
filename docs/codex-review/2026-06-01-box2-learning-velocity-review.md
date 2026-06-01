# Box 2 Learning Velocity Review - 2026-06-01

## Scope

- `src/readiness/evidence.ts`
- `scripts/readiness-evidence.ts`
- `src/dashboard-html.ts`
- `src/readiness/evidence.test.ts`
- `src/dashboard-html.test.ts`
- readiness plan and runbook docs

## Verdict

No P0 or P1 findings.

## Notes

- The change is read-only evidence plumbing. It does not touch
  `src/poly/risk-gates.ts`, `src/poly/paper-broker.ts`,
  `src/poly/pnl-tracker.ts`, monetary caps, halt switches, broker execution, or
  live-money flags.
- The new Box 2 learning velocity metric reports near-term paper trades opened
  in the last 24 hours, the daily pace required to fill the near-term sample
  within 30 days, and the ETA at the current rate.
- The metric does not force trades or reinterpret open positions as settled
  positions. Box 2 remains incomplete until 50 trades settle with positive
  realized P&L.

## Verification

- `npx vitest run src/readiness/evidence.test.ts src/dashboard-html.test.ts`
  - PASS, 18/18 tests.
- `npm run typecheck`
  - PASS.
- `npm test`
  - PASS, 919/919 tests.
- `npm run build`
  - PASS.
- Browser render check
  - PASS, Evidence Path renders `box2 velocity 1/24h target 1.5/d ETA 2026-07-16`.
- `npm run capacity:status`
  - PASS for operational readiness checks. Live-money interlock remains blocked by Boxes 1, 2, 3, and 7.
