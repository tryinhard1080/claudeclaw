# Sprint 2026-05-24: Equity Benchmark Surface

## Trigger

The full-capacity roadmap requires regime-trader to be compared against a
simple benchmark before any live equity money. The current repo stores
regime-trader Sharpe snapshots, but has no benchmark table or comparison
command.

## Existing-code audit

Command:

```bash
rg -n "benchmark|Sharpe|regime_sharpe|snapshot|daily_return|rolling_sharpe" src scripts docs --glob '!node_modules'
```

Findings:

- `src/trading/sharpe.ts` owns pure Sharpe math for regime-trader.
- `migrations/v1.15.0/v1.15.0-regime-sharpe-snapshots.ts` persists daily
  regime-trader equity, daily returns, and rolling 60-day Sharpe.
- `scripts/regime-sharpe-snapshot.ts` writes the regime-trader snapshots.
- No repo code stores a benchmark equity curve or compares regime-trader to a
  baseline.

## Verdict

Duplicate: none. Existing Sharpe code measures the strategy only.

Complement: the benchmark table and comparison module sit beside the existing
Sharpe snapshots. They do not change the regime-trader bridge.

Conflict: low. This is read-only reporting plus a new table. It does not touch
execution, risk limits, PM2 control, or order routing.

Novel: add an `equity_benchmark_snapshots` table and pure comparison functions
so a later data writer can persist SPY baseline rows without changing the
status/reporting surface.

## Benchmark principle

Use a deliberately simple baseline first: daily SPY buy-and-hold or a
trend/risk-off variation once the data writer is connected. Regime-trader must
beat a boring baseline before complexity is treated as an edge.

## How this changes our code/strategy

ClaudeClaw gets a benchmark comparison slot before live equities. The first
iteration is intentionally a scaffold: table, pure math, and CLI status. The
next sprint can connect the writer to an approved market-data source without
changing the reporting contract.

