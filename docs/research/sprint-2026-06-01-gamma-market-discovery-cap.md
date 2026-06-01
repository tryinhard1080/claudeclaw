# Sprint 2026-06-01 - Gamma market discovery cap

## Verdict

**COMPLEMENT** to Sprint 24 Gamma pagination and the 2026-06-01 trading-behavior unblock. Sprint 24 made market pagination fast, but live Gamma responses now cap `/markets` pages at 100 rows even when `limit=2000` is requested. That causes the current scanner to stop after the first page and starves the active paper strategy of candidate supply.

## Existing-code audit

| Surface | Finding | Change |
|---|---|---|
| `src/poly/gamma-client.ts` | `fetchActiveMarkets(pageSize = 2000)` assumes Gamma honors the requested limit. Live probes returned only 100 rows for `limit=2000`, so `page.length < pageSize` ends the scan after one page. | Clamp list requests to 100 rows, add a bounded page window, and sort by live 24h volume. |
| `src/poly/market-scanner.ts` | Calls `fetchActiveMarkets()` once per scan, then selects shadow and active candidates downstream. | No scanner change needed. A wider upstream universe feeds the existing selector. |
| `src/poly/strategy-engine.ts` | `selectPriceCaptureCandidates` already filters closed markets, minimum volume, time-to-resolution, Yes price band, TTL, market quality, then sorts by `volume24h`. | No strategy or risk-gate change needed. |
| `docs/research/sprint-24-gamma-pagination.md` | Intended to fetch the full active market universe quickly with large pages. | This sprint corrects the API contract assumption from live evidence. |
| `docs/research/sprint-2026-06-01-trading-behavior-unblock.md` | Active TTL and market-quality filters were enabled to improve paper-learning quality. | This sprint gives those filters a large enough candidate pool to work. |

## Duplicate / complement / conflict / novel

- **Duplicate:** not a duplicate of Sprint 24. Sprint 24 changed pagination performance, not the Gamma response-cap assumption.
- **Complement:** complements active TTL and market-quality filtering by feeding the selector more eligible markets.
- **Conflict:** conflicts with the old `pageSize=2000` comment and termination model. Live data shows Gamma returns only 100 rows for that request.
- **Novel:** introduces a bounded, volume-sorted market discovery window as the default scanner universe.

## Live evidence

Direct live probes on 2026-06-01 showed:

| Request | Result |
|---|---|
| `limit=2000&offset=0` | 100 rows |
| `limit=500&offset=0` | 100 rows |
| `limit=100&offset=0` | 100 rows |
| `limit=100&offset=100` | 100 rows |
| `order=volume_24hr` | matched the unordered first page despite current docs listing it |
| `order=volume24hr` | returned the highest `volume24hr` markets first |

Candidate-supply probe using the existing selector:

| Universe | Raw markets | Active paper candidates |
|---|---:|---:|
| unordered first page | 100 | 3 |
| `volume24hr`, first page | 98 | 10 |
| `volume24hr`, five pages | 496 | 20 |
| `volume24hr`, ten pages | 991 | 20 |

Polymarket docs currently document Gamma rate limits at `/markets` 300 requests per 10 seconds and show `limit` plus `offset` pagination. Ten requests every scan is inside that envelope.

## Design

Use the `/markets` endpoint conservatively:

- Request `limit=100` by default because that is the observed live page cap.
- Sort with `order=volume24hr&ascending=false` because that is the observed live sort key for 24h volume.
- Bound default discovery at 10 pages, roughly 1000 raw markets per scan.
- Preserve concurrent batches, stable first-to-last order, malformed-market skipping, and failure propagation.
- Do not edit `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, money caps, halt state, or live flags.

## How this changes our code/strategy

The bot should evaluate a materially better paper-trading universe without becoming more aggressive per trade. This is a candidate-supply fix, not a new strategy: existing TTL, market-quality, Kelly sizing, and risk gates still decide what can become a paper order. It should move Box 2 learning velocity by making it easier for the current approved strategy to find enough near-term, liquid Polymarket candidates.

## Post-deploy proof

After build and PM2 restart on 2026-06-01:

- `npm test` passed `921/921`.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run agent:surface:check` passed.
- `npm run capacity:status` showed Polymarket scans fresh with `markets=992`, halt clear, and zero system blockers in the real-money gate audit.
- PM2 logs showed `fetchActiveMarkets skip summary parsed=992`, `poly scan complete count=992`, `shadowCandidates=20`, `ttlFilterEnabled=true`, and `marketQualityFilterEnabled=true`.
- A new paper trade filled after the widened universe: `tradeId=35`, `will-chong-won-oh-win-the-2026-seoul-mayoral-election`, entry price `0.85`.
