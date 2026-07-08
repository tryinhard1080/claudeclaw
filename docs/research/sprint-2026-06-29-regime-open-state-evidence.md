# Sprint 2026-06-29: Regime Open-State Evidence

## Trigger

The 5-trading-day launch-readiness sprint found an avoidable equity-readiness
warning after market open. `npm run trading:status` and
`npm run readiness:evidence` reported both regime-trader instances as
`open_partial`, even though the runtime `state.json` files were fresh and
included `market_open: true`, `last_regime`, `risk`, positions, and recent
signals.

## Existing-Code Audit

Commands:

```bash
rg -n "last_regime|recent_signals|regimeLabel|getRegimeLabel" src/trading
rg -n "hasRegime|open_full|open_partial|summarizeRegimeState" src/readiness src/trading
```

Findings:

- `src/trading/state-schema.ts` required a nested `regime` object for open
  market parse success.
- `src/trading/ops-status.ts` classified open state as full only when nested
  `regime` and `risk` were present.
- `src/readiness/evidence.ts` set `hasRegime` only from the nested `regime`
  field.
- `src/trading/equity-dashboard.ts` already accepts a recent signal regime as
  display fallback, so the fallback concept exists in repo.
- Current regime-trader runtime state writes `last_regime` as the open-market
  regime label source at startup.

## Verdict

Duplicate: none. There is no shared helper that recognizes `last_regime` as a
valid readiness regime label.

Complement: narrow reporting/schema compatibility. This complements the
read-only regime-trader bridge and does not change execution, allocation, risk
limits, or order routing.

Conflict: low. Telegram detail views still require nested `regime` for fields
such as confidence, so `isFullRegimeState` should remain strict.

Novel: treat `last_regime` or the latest recent-signal `regime` as sufficient
for open-state evidence when paired with `risk`, while keeping richer typed
views strict about nested regime metadata.

## How This Changes Our Code/Strategy

ClaudeClaw stops treating a healthy, fresh regime-trader runtime snapshot as a
system blocker only because the upstream state writer used `last_regime`
instead of nested `regime`. This improves launch-readiness evidence quality
without weakening Box 3, changing the Sharpe gate, or touching live-money
controls.
