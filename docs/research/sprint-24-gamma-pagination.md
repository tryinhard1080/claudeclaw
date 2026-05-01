# Sprint 24 — Gamma `fetchActiveMarkets` parallel pagination

**Verdict:** complement (replaces a sequential pagination loop with a parallel-batched one; behavior contract is similar but performance and termination semantics change)
**Track:** Polymarket — `src/poly/gamma-client.ts`
**Tier:** 2 (no risk-gates.ts or paper-broker.ts touched, but it feeds the data path that the scanner consumes — add tests before commit)

## Problem

The active-market scanner relied on a sequential paginated loop:

```ts
async function fetchActiveMarkets(pageSize = 500) {
  let offset = 0;
  while (true) {
    const raw = await getJson(`${BASE}/markets?...&limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(raw) || raw.length === 0) break;
    // normalize ...
    if (raw.length < pageSize) break;
    offset += pageSize;
    await sleep(200);
  }
}
```

With Polymarket's market universe near 48k entries, that's ~97 pages × ~5s round-trip ≈ 400–600s per scan. At a 5-min scanner cadence the loop overlaps itself in pathological cases.

## Existing-code audit

`fetchActiveMarkets` is the only fetcher that needs whole-universe paging. `fetchMarketById` and `fetchMarketBySlug` are single-row lookups and unchanged. No other Gamma fetcher exists. No prior research note covers parallel pagination here. Verdict: **complement, no duplication.**

## Change

Two parameter defaults raised, sequential loop replaced with concurrent batches:

```ts
export async function fetchActiveMarkets(pageSize = 2000, concurrency = 4): Promise<Market[]> {
  // batch of `concurrency` page requests at offsets [o, o+pageSize, ..., o+(concurrency-1)*pageSize]
  // Promise.all the batch
  // for each page in batch: empty → exhausted; partial (<pageSize) → exhausted-after-keep
  // advance offset by concurrency * pageSize
  // normalize accumulated rawPages once at the end
}
```

Performance estimate: ~7 rounds × ~5s ≈ 35s (12–17× speedup).

## Behavioral contract — what callers can rely on

| Property | Old (sequential) | New (parallel batched) | Test? |
|---|---|---|---|
| URL shape per request | `/markets?active=true&closed=false&limit={pageSize}&offset={offset}` | unchanged | yes |
| `pageSize` plumbed into `limit=` | yes | yes | yes |
| `offset` plumbed into `offset=` | yes | yes | yes |
| Total markets returned | sum of all pages, in first-to-last order | same | yes |
| Termination on empty page | yes (drops further pages) | yes (drops further pages, including remaining of current batch) | yes |
| Termination on partial page (< pageSize) | yes (keeps partial, stops) | yes (keeps partial, stops, drops further pages of current batch) | yes |
| Inter-page rate-limit sleep | 200ms between pages | none (relies on getJson's 429 backoff) | indirect — getJson behavior unchanged |
| Failure mode | first failed page rejects `await getJson(...)` | first failed page rejects `Promise.all(...)`; concurrent peers' results are discarded | yes |
| Dedupe | none | none | n/a — Polymarket Gamma offsets are stable enough that we accept the risk; if dedupe becomes needed, it goes in a follow-up sprint, not here |

## Tests added

In `src/poly/gamma-client.test.ts`, new describe block exercising `fetchActiveMarkets` against a `vi.stubGlobal('fetch', ...)` mock:

1. **URL plumbing:** custom `pageSize=10, concurrency=2` issues `limit=10&offset=0` and `limit=10&offset=10` in the first batch.
2. **Multi-batch sequencing:** with full pages, second batch starts at `offset = concurrency * pageSize`.
3. **Empty-page termination:** when an empty page appears in a batch, no further batches issue.
4. **Partial-page termination:** when a page returns `< pageSize` items, that page is kept and no further batches issue.
5. **Order preservation:** markets across batches and pages are returned first-to-last.
6. **Concurrent dispatch:** within a batch, all `concurrency` requests are in-flight simultaneously (fetch mock observes them before any resolves).
7. **Failure propagation:** if any page in a batch rejects, `fetchActiveMarkets` rejects.

Tests target only `fetchActiveMarkets` so the existing `normalizeMarket` describe block is untouched.

## How this changes our code/strategy

Faster scans free the scanner cadence from collision risk against itself. No public-API change. No DB change. Risk gates and paper broker downstream consume the same `Market[]` shape. F1b commit takes both the code change and the new tests in one go since this is a unified scope after audit. The plan's earlier F1a/F1b split was based on a misread of the diff (the inventory agent attributed normalizeMarket changes to this diff; in fact the diff only touches `fetchActiveMarkets`). Plan §4 will be reflected in the commit message.
