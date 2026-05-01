# Sprint 21 — Telegram intersection alert (news ↔ open positions)

**Verdict:** novel (no prior intersection logic between news_items and poly_paper_trades)
**Track:** Polymarket — `src/poly/news-sync.ts` + new `src/poly/news-intersection.ts`
**Tier:** 2 (no risk-gates.ts or paper-broker.ts touched)

## Problem

Plan §4 Sprint 21: when an ingested news item references an open position, push a Telegram alert. Right now the two streams (news_items table populated every 2h, poly_paper_trades.status='open' rows) live independently. An operator scrolling the digest for trade-relevant news has to read the bullet list and mentally cross-reference open slugs.

## Existing-code audit

- `news-sync.ts` writes news_items, has `runNewsSync()` orchestrator, dedupes on prompt_hash within a 90-min window.
- `positions-view.ts` reads open positions for the dashboard; not a fit for matching logic but confirms the SQL shape.
- `alerts.ts` exists for Telegram dispatch (filled/rejected/resolution events) — not used for news today.
- No prior intersection module. Verdict: **novel.**

## Match strategy

Polymarket slugs are descriptive dash-joined sentences. Sample:

```
strait-of-hormuz-traffic-returns-to-normal-by-april-30
will-jd-vance-win-the-2028-republican-presidential-nomination
will-alphabet-be-the-largest-company-in-the-world-by-market-cap-on-june-30
```

The slug already contains every distinctive token an operator would care about ("hormuz", "vance", "alphabet"). LLM-based intersection is overkill and expensive on a 2h cron. Token-overlap match is cheap and deterministic.

Rule:
1. Tokenize the slug: split on `-`, lowercase, drop stopwords, drop tokens of length < 4 except an explicit allow-list of distinctive short tokens (none for now).
2. Lowercase the news summary for matching. Whole-word match (regex `\btoken\b`).
3. **Threshold: ≥2 distinct slug tokens appearing in the news summary** triggers a candidate match. Single-token matches are noisy ("alphabet" alone could be metaphorical, "election" alone is too common).

Stopwords (concrete list):
```
will the by a an of to for in on at is be with and or but vs before
after until from this that these those who whose what when where why
how which not no its their our your my his her them we us you i me
won win wins winning lose loses losing
```

Why the win/lose family is in stopwords: most slugs follow "will-X-win-Y" / "will-X-be-Z" — keeping `win` adds zero signal because every position-slug has it.

## Schema (migration v1.14.0)

```sql
CREATE TABLE IF NOT EXISTS poly_news_position_alerts (
  news_item_id   INTEGER NOT NULL,
  paper_trade_id INTEGER NOT NULL,
  matched_tokens TEXT NOT NULL,   -- comma-joined for audit
  emitted_at     INTEGER NOT NULL,
  PRIMARY KEY (news_item_id, paper_trade_id)
);
CREATE INDEX IF NOT EXISTS idx_news_alerts_emitted ON poly_news_position_alerts(emitted_at DESC);
```

PRIMARY KEY enforces dedupe: the same news×position pair only ever alerts once. `INSERT OR IGNORE` + `db.changes()` is the dispatch gate.

The runtime module also calls `ensureTable()` (idempotent CREATE TABLE IF NOT EXISTS) on its first call, so a code-deploy that lands before `npm run migrate` is non-fatal (the table self-bootstraps on first news cycle).

## Module: `src/poly/news-intersection.ts`

```ts
export function tokenizeSlug(slug: string): string[]
export function findIntersections(
  db, sinceSec, minTokenMatches=2,
): Array<{ news_item_id, paper_trade_id, market_slug, matched_tokens }>
export function recordAndEmitAlerts(
  db, matches, sender, formatLine,
): Promise<{ emitted: number; suppressed: number }>
export function runNewsIntersectionPass(db, sender, opts?): Promise<{...}>
```

`runNewsIntersectionPass` is the single entry-point. It picks up news_items from the last `lookbackSec` seconds (default 3600s = 1h, enough to catch the 2h cycle's most recent insert with margin) and runs the full match → record → alert flow.

## Wiring

`runNewsSync` returns `{ ok, inserted }`. On `ok && !inserted.deduped`, `index.ts` (or wherever the news-sync cron tick lives) calls `runNewsIntersectionPass(db, sender)`. Decoupling matters: a runNewsSync skip (no PPLX key) leaves intersection alerts dormant rather than failing.

Sprint scope is the module + tests + wire stub. The actual `index.ts` wire-call lands in this same commit because it's a 3-line addition.

## Tests

`src/poly/news-intersection.test.ts`:

1. `tokenizeSlug` drops stopwords, lowercases, filters length < 4.
2. `tokenizeSlug` strips trailing numerics like `-396` (Polymarket's disambiguator suffix on duplicate questions).
3. `findIntersections` returns nothing when news contains zero matching tokens.
4. `findIntersections` requires ≥2 distinct token matches; 1-token-only is suppressed.
5. `findIntersections` matches whole words only (`iran` does not match `iranian-american` cluster).
6. `recordAndEmitAlerts` writes the alert row with PRIMARY KEY (news_item_id, paper_trade_id).
7. `recordAndEmitAlerts` is idempotent: running the same input twice emits once.
8. `runNewsIntersectionPass` ignores news items older than `lookbackSec`.
9. `ensureTable` is idempotent: calling twice doesn't error.

## How this changes our code/strategy

Closes the cross-reference gap between news ingestion and open trades. Zero impact when news-sync is dormant (no rows, no matches, no work). Zero risk to risk-gates / paper-broker. Token-overlap is conservative: false positives self-resolve when the operator scrolls the linked news_item; false negatives are tolerable (operator still gets the digest).
