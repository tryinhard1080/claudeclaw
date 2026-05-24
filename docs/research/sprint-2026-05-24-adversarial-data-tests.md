# Sprint 2026-05-24: Adversarial Data Tests

## Trigger

The roadmap calls for tests that prove bad data does not become a trade. This
sprint adds must-reject fixtures around the existing deterministic gates and
news-intersection path.

## Existing-code audit

Command:

```bash
rg -n "risk-gates|runAllGates|classifyResolution|news-intersection|prompt injection|headline|empty_asks|price_drift" src docs --glob '!node_modules'
```

Findings:

- `src/poly/risk-gates.ts` already rejects duplicate open positions, empty
  asks, price drift, shallow depth, low time-to-resolution, and drawdown.
- `src/poly/pnl-tracker.ts` classifies missing market lookups as voided, not
  won.
- `src/poly/news-intersection.ts` treats news summaries as inert text and only
  matches slug tokens for operator alerts.

## Verdict

Duplicate: partial. Unit coverage exists for each gate, but not as one
adversarial fixture suite tied to the real-money gate.

Complement: new tests compose existing pure functions and do not touch
production logic.

Conflict: none. The tests harden current safety behavior.

Novel: one focused suite proves malicious headlines remain data, sudden price
gaps reject, duplicate positions reject, and missing settlement source voids.

## How this changes our code/strategy

The bot now has explicit regression evidence that hostile or broken context
does not bypass deterministic gates. This supports the no-P0/P1 gate and gives
future live-readiness reviews a single adversarial test file to inspect.

