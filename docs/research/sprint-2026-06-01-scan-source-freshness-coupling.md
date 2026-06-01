# Sprint 2026-06-01 Scan Source Freshness Coupling

## Scope

Prevent new Polymarket paper approvals from carrying stale required source
freshness context when the same scan tick has already fetched fresh Gamma
markets and written fresh candidate price history.

## Existing-Code Audit

- `src/readiness/source-freshness.ts` already owns the source freshness ledger
  and `buildSignalSourceContext()`, which strategy signals persist.
- `scripts/source-freshness-refresh.ts` refreshes `polymarket-gamma-scan` and
  `polymarket-price-history` from persisted scan and price-history tables, but
  it runs outside the scan tick.
- `src/poly/market-scanner.ts` already fetches Gamma markets, writes candidate
  price history, records scan runs, and emits `scan_complete`; the strategy
  engine evaluates immediately after that event.
- `src/poly/strategy-engine.ts` already persists source context on each primary
  signal. It should not have to guess whether the latest scanner work has been
  reflected in the freshness ledger.

## Verdict

- Duplicate: no existing scanner-level source freshness coupling found.
- Complement: update the freshness ledger on successful scan ticks while
  keeping the existing readiness refresh script as a backfill/repair command.
- Conflict: do not weaken risk gates, change sizing, or enable any live-money
  path. This is provenance accounting for paper signals only.
- Novel: the scanner becomes the source of truth for marking Polymarket market
  and price-history inputs fresh before strategy evaluation.

## How This Changes Our Code/Strategy

Future Polymarket approvals should only show stale required source context when
the actual scanner/price-history write failed or aged past the configured
threshold. A successful scan tick now refreshes the required signal sources
before paper trade evaluation, tightening the real-time data trail without
changing the strategy, caps, broker, or deterministic risk gates.
