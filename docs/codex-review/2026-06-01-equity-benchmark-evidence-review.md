# Equity Benchmark Evidence Review - 2026-06-01

## Scope

- `src/readiness/evidence.ts`
- `scripts/readiness-evidence.ts`
- `src/dashboard.ts`
- `src/dashboard-html.ts`
- `src/readiness/evidence.test.ts`
- `src/dashboard-html.test.ts`
- readiness handoff and runbook docs

## Verdict

No P0 or P1 findings.

## Notes

- The change is read-only evidence plumbing. It does not touch
  `src/poly/risk-gates.ts`, `src/poly/paper-broker.ts`,
  `src/poly/pnl-tracker.ts`, monetary caps, halt switches, broker execution, or
  live-money flags.
- The equity benchmark comparison reuses the existing pure
  `compareEquityBenchmark` implementation and reads the existing
  `equity_benchmark_snapshots` and `regime_sharpe_snapshots` tables.
- Missing benchmark or regime tables are WARN evidence states, not hidden
  successes.

## Verification

- `npx vitest run src/readiness/evidence.test.ts src/dashboard-html.test.ts`
  - PASS, 17/17 tests.
- `npm run typecheck`
  - PASS.
- `npm run readiness:evidence`
  - PASS/WARN as expected. `Equity benchmark` PASS reported
    `spy-aggressive excess=+0.79%` and `spy-conservative excess=+0.80%`.
