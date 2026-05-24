# Sprint 2026-05-24: Polymarket US Read-Only Adapter

## Trigger

ClaudeClaw needs a compliant US venue discovery path before any future
Polymarket live-money work. This sprint adds read-only market data access only.
It does not add order placement, account access, keys, private data, or live
execution.

## Source check

Official docs checked 2026-05-24:

- Polymarket US API overview: `https://docs.polymarket.us/api-reference/introduction`
- Polymarket US TypeScript SDK market methods:
  `https://docs.polymarket.us/api-reference/sdks/typescript/markets`
- Polymarket US market data guide:
  `https://docs.polymarket.us/trader-guide/market-data`

Relevant docs facts:

- Public market browsing uses `https://gateway.polymarket.us` and needs no API
  key.
- Authenticated trading and account APIs are separate from public market data.
- Market methods include list, retrieve by slug, book, BBO, and settlement.
- Market-data docs emphasize integer/string price handling and aggregated book
  depth.

## Existing-code audit

Command:

```bash
rg -n "Polymarket US|polymarket-us|gamma-api|clob|fetchActiveMarkets|fetchMarketBySlug|book|bbo" src scripts docs --glob '!node_modules'
```

Findings:

- `src/poly/gamma-client.ts` is the current Polymarket International public
  discovery path.
- `src/poly/clob-client.ts` is the current International order-book read path.
- No US venue module exists.
- `src/poly/paper-broker.ts` is the paper execution path and is not touched.

## Verdict

Duplicate: none. Current Polymarket code targets International public APIs.

Complement: the new module is read-only and parallel. It does not replace
Gamma/CLOB or change scanner behavior.

Conflict: low if the adapter exposes no order/account methods and requires no
credentials. The risk would be accidentally creating an order-capable client.

Novel: add a typed read-only client that supports list, market-by-slug, book,
and BBO against the public gateway.

## How this changes our code/strategy

ClaudeClaw can now discover and inspect Polymarket US markets without keys and
without creating any execution path. Future live work still needs a separate
Tier 3 plan, signed mission gate, account/balance checks, and explicit disabled
by default live flags.

