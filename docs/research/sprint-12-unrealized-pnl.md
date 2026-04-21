# Sprint 12 — Unrealized P&L on dashboard open positions

## 1. Existing-code audit

Prior art discovered before any new code:

- `migrations/v1.2.0/v1.2.0-poly.ts:70-76` — `poly_positions` table already stores per-trade `current_price`, `unrealized_pnl`, `updated_at`. Primary key is `paper_trade_id` (FK to `poly_paper_trades.id`).
- `src/poly/pnl-tracker.ts:166-171` — `PnlTracker.runOnce()` recomputes `unrealized = shares * (mid - entry_price)` on every tick and UPDATEs `poly_positions`. On resolution, row is DELETEd (line 196), so `poly_positions` is tautologically open-only.
- `src/poly/pnl-tracker.ts:142` — midpoint comes from `fetchMidpoint(tokenId)` against `clob.polymarket.com/midpoint`. Already rate-limited by the existing scanner cadence.
- `src/dashboard.ts:441` — `GET /api/poly/trades` returns rows straight from `poly_paper_trades`. No join to `poly_positions`. No `current_price` or `unrealized_pnl` in payload.
- `src/dashboard.ts:469` — `GET /api/poly/pnl` returns daily realized aggregate plus raw open-trades list, also without unrealized.
- `src/dashboard-html.ts:1947-2011` — client-side `loadPoly()` calls `/api/poly/trades?status=open&limit=20` and renders columns: Market, Side, Entry, Size, Shares, Age. No unrealized column.
- `src/poly/digest.ts` (Sprint 11) — daily Telegram digest already surfaces per-position unrealized in the "Open positions" section. Read-pattern reference.

Related primitives to reuse, not reinvent:

- `src/poly/format.ts` — `fmtUsd`, `fmtPrice`, `truncateQuestion`.
- `src/dashboard.ts:38` (assumed — Hono route pattern shared with other `/api/poly/*` endpoints).

## 2. Literature / NotebookLM finding

None needed. Straightforward exposure of existing internal state through an HTTP route.

## 3. Duplicate / complement / conflict verdict

**Complement.** The computation, storage, and write cadence all exist. The dashboard API route and the UI column do not.

Gap → one new route + one UI column:

- **`GET /api/poly/positions/live`** — LEFT JOIN `poly_paper_trades` (status='open') with `poly_positions`. Returns per-row: `trade_id`, `market_slug`, `outcome_label`, `side`, `entry_price`, `size_usd`, `shares`, `current_price` (nullable), `unrealized_pnl` (nullable), `unrealized_pct` (nullable), `updated_at` (nullable), `age_hours`. Plus aggregate: `total_open_exposure_usd`, `total_unrealized_pnl`, `total_unrealized_pct_of_exposure`.
- **Dashboard open-positions table** switches from `/api/poly/trades?status=open` to `/api/poly/positions/live`. Adds columns: Mark, Unrealized $, Unrealized %. Footer shows aggregate unrealized next to existing open-exposure pill.

Nullable fields are required because `poly_positions` is populated only after the first `PnlTracker.runOnce()` tick that sees the trade. A trade opened between ticks has no row in `poly_positions` yet. UI renders `—` in that case.

Not duplicate (no existing route returns unrealized). Not novel (computation + storage exist; Sprint 11 already exposed the same data to Telegram). Not conflict (new route; old `/api/poly/trades` unchanged for other callers).

## 4. Why now

- **Monitoring metric**: operator has 10 open positions worth ~$471 exposure. Dashboard can currently answer "how many open?" but not "am I up or down on them?" without opening the bot's Telegram digest. The existing `/api/poly/overview` returns `realized_pnl` but no unrealized figure, which is misleading during the pre-resolution window.
- **Latency metric**: one indexed SELECT with a LEFT JOIN on `paper_trade_id` (PK of `poly_positions`, indexed). Query budget < 5ms for N<100 open trades. No upstream API calls.
- **Cost**: zero additional CLOB or Gamma requests. Tick cadence of `PnlTracker` already pays that cost; dashboard reads the cache.
- **Timeline**: one sprint turn. Ship before Sun 2026-04-26 (first resolution batch) so the operator can watch unrealized compress into realized as markets settle.

## 5. Out of scope

- NOT re-fetching CLOB midpoints per dashboard request. The `PnlTracker` tick already does this on its own cadence. Double-fetching would rate-limit us and produce inconsistent numbers between the tick-written `poly_positions` row and a dashboard-fresh fetch.
- NOT adding historical unrealized over time (time-series chart). Premature; no operator ask. Sprint 13 handles realized-P&L charting.
- NOT touching `/api/poly/trades` contract. Other callers (including telegram-commands.ts `renderPositions`) may depend on its exact shape. Additive-only.
- NOT changing `PnlTracker.runOnce()` tick math or frequency.
- NOT exposing `unrealized_pnl` for resolved trades. By definition resolved trades have `realized_pnl`; `poly_positions` row is deleted on resolution.

## 6. Risk

Zero blast radius for trading logic. New read-only route. Dashboard regression surface: if `/api/poly/positions/live` returns malformed JSON, the open-positions table fails to render but the rest of the dashboard is unaffected.

Failure modes:

- **Stale `poly_positions`**: `updated_at` could be minutes old if `PnlTracker` tick has been slow. Mitigation: return `updated_at` in payload; UI renders age badge if > 15 min.
- **Missing `poly_positions` row**: freshly opened trade not yet ticked. Mitigation: LEFT JOIN returns nulls; UI shows `—` for Mark / Unrealized.
- **JOIN performance regression at scale**: N=10 today, could reach N=200 if exit flag lifts. Still trivial (< 50ms), but guard with `LIMIT 200` defensively.

## 7. Verification plan

- **Unit**: `buildPositionsLivePayload(db)` returns array of N rows with correct shape when N open trades exist in `poly_paper_trades` and matching `poly_positions` rows exist.
- **Unit**: LEFT JOIN edge case — trade exists in `poly_paper_trades` with status='open' but no `poly_positions` row. Row returned with `current_price=null`, `unrealized_pnl=null`, `unrealized_pct=null`.
- **Unit**: Aggregate `total_unrealized_pnl` is the sum of per-row `unrealized_pnl`, treating nulls as zero.
- **Unit**: Aggregate `total_unrealized_pct_of_exposure` = `total_unrealized_pnl / total_open_exposure_usd` when exposure > 0; null when exposure = 0 (no open trades).
- **Unit**: `age_hours` computed from `poly_paper_trades.created_at` as `(now - created_at) / 3600`, rounded to 1 decimal.
- **Integration**: hit the running dashboard locally; confirm open-positions table renders Mark + Unrealized columns; footer shows aggregate.
- **30-day**: operator can answer "net unrealized on our book right now?" in one glance at the dashboard. No Telegram command required.

## 8. Followups (not this sprint)

- Sprint 13: `/api/poly/pnl` already emits daily realized series — wire into a chart.
- Sprint 14: expand signal row to show `reasoning` + `contrarian` from `poly_signals`.
- Sprint 15: `/api/poly/calibration` and `/api/poly/drift` for Brier and latency charts.
- Optional Sprint 12.1 if freshness complaint arises: lightweight `/api/poly/positions/live?refresh=1` that triggers a CLOB midpoint re-fetch out-of-band for open positions whose `updated_at` > 10 min old.
