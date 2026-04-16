# Sprint 10 — Gamma `outcomePrices` nullish

## 1. Existing-code audit

Direct prior art:

- `src/poly/types.ts:38-55` — `GammaMarketSchema`:
  - Line 45: `outcomePrices: numberArrayFromJson` (required, no `.nullish()`).
  - Line 52: `endDate: z.string().nullish()` — retrofitted with comment noting ~46% real-world missing rate on 2026-04-12 probe.
- `src/poly/types.ts:22-36` — `numberArrayFromJson` helper throws via `ctx.addIssue` when input is not a string; has no undefined-branch.
- `src/poly/gamma-client.ts:37-63` — `normalizeMarket`:
  - Line 42: `GammaMarketSchema.parse(raw)` throws on any schema violation.
  - Line 43: null-branch for `endDate` when `requireEndDate` (strict mode, default true).
  - Line 44: length-mismatch guard throws.
  - Line 50: array access `g.outcomePrices[i]!` assumes presence.
- `src/poly/gamma-client.ts:78-83` — per-item `logger.warn` fires on every Zod throw; this is the observed spam path.
- `src/poly/gamma-client.ts:89-93` — batch `logger.info` summary (intended to be the only noise for skip counts).

Callers of the affected path:

| Caller | File:line | Mode |
|---|---|---|
| `fetchActiveMarkets` | `src/poly/market-scanner.ts:34` | strict (default) |
| `fetchMarketBySlug` | `src/poly/pnl-tracker.ts:65` | tolerant (`requireEndDate: false`) |
| `fetchMarketById` | no callers in `src/` | N/A |

Existing tests touching this surface:

- `src/poly/types.test.ts:4` — `GammaMarketSchema` — happy path + length-mismatch.
- `src/poly/gamma-client.test.ts:4` — `normalizeMarket` — happy, length-mismatch throw, missing-endDate behavior in both modes.

Evidence of live failure (pm2 `claudeclaw-out.log`, 2026-04-16 09:01:27.130, 15+ identical entries inside the same millisecond):

```
"expected": "string"
"path": ["outcomePrices"]
"message": "Invalid input: expected string, received undefined"
```

## 2. Literature / NotebookLM finding

No literature needed. Standard defensive-parsing retrofit. Polymarket Gamma API real returns are looser than its implied schema, same shape as the `endDate` case already documented at `types.ts:49-51`.

## 3. Duplicate / complement / conflict verdict

**Complement.** Mirrors the `endDate` precedent one-for-one:

| Concern | `endDate` (shipped) | `outcomePrices` (this sprint) |
|---|---|---|
| Schema | `z.string().nullish()` | `numberArrayFromJson.nullish()` |
| `normalizeMarket` scanner mode | skip (return null) | skip (return null) |
| `normalizeMarket` resolution mode | endDate=0 placeholder | skip (return null — unpriced = unresolvable) |

Not duplicate (outcomePrices never had this treatment). Not novel (pattern exists). Not conflict (both modes agree: skip).

One subtle divergence from the endDate precedent: resolution mode keeps the market for endDate-missing (because P&L tracker only needs `closed` + `outcomes[i].price`). For outcomePrices-missing, resolution mode has nothing to compute, so it also returns null. This is intentional — don't add a `requireOutcomePrices` option just to preserve symmetry.

## 4. Why now

- **Log-noise metric (primary):** `claudeclaw-out.log` currently shows 15+ per-item warn lines per scan batch where at least one market is unpriced. Target post-fix: zero per-item warns for this failure mode; batch summary at `gamma-client.ts:89` remains.
- **Correctness metric (secondary):** `fetchMarketBySlug` in the resolution path currently throws → caught as generic failure → returns null → `PnlTracker.classifyResolution` reads this as "market not found → void at $0". Post-fix: same null return, but explicit rather than accidental. Prevents a future regression where the generic catch gets tightened and this case gets misclassified.
- **Timeline:** one sprint turn, ≤30 min TDD + code + verify. No waiting period; effect visible in the next scan after deploy.

## 5. Out of scope

- NOT making `outcomes` or `clobTokenIds` nullish. Evidence only shows `outcomePrices` undefined; don't pre-generalize without data.
- NOT adding a `requireOutcomePrices` option to `normalizeMarket`. Both modes skip, so a flag has no users.
- NOT touching the batch summary `logger.info` at line 89. Counts remain as-is; `skippedMalformed` keeps incrementing for length-mismatch-style failures.

## 6. Risk

Zero blast radius. Markets without prices cannot be traded (no edge calculation possible) — current code skips them via throw+catch, new code skips them via null return. Same observable end state for the trading engine. Shadow-only change from a P&L perspective. Only user-visible effect is cleaner logs.

## 7. Verification plan

- **Unit:** `GammaMarketSchema.parse()` accepts a payload with `outcomePrices` omitted entirely (as `undefined`).
- **Unit:** `normalizeMarket` returns `null` when `outcomePrices` missing, both with `requireEndDate: true` and `requireEndDate: false`.
- **Unit:** existing tests still pass (no regression in length-mismatch throw, no regression in missing-endDate behavior).
- **Integration:** on next live scan after deploy, `pm2 logs claudeclaw --out | grep "skipping malformed market"` count drops materially if unpriced markets are in the response. Batch summary still logs `skippedMalformed: N` for any legitimately malformed shape.
- **30-day:** `grep -c 'outcomePrices' ~/.pm2/logs/claudeclaw-*.log` returns 0 after 2026-05-16.
