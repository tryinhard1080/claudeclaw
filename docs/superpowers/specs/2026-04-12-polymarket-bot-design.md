# Polymarket Bot — Phase A + C Design

> **Status**: Approved design, ready for implementation plan
> **Scope**: Read-only intel (Phase A) + autonomous paper trading MVP (Phase C)
> **Full blueprint reference**: `docs/mega-prompt-polymarket-bot.md` (836-line research doc)
> **What this spec covers**: the narrow, shippable subset of that blueprint

## 1. Goals and non-goals

### In scope

- Telegram commands that expose live Polymarket market data (`/poly markets`, `/poly market <slug>`, `/poly trending`, `/poly closing`, `/poly status`)
- Daily 6am digest pushed to Telegram: top 5 markets by volume + any markets where AI estimates ≥8% edge
- Autonomous paper trading loop using Claude Opus 4.6 to estimate true probabilities and size positions via 1/4 Kelly
- Three deterministic risk gates that must all pass before any paper trade is written
- Persistent paper P&L tracking in SQLite, resolved automatically when markets close
- Emergency halt via Telegram (`/poly halt`), mode lock (paper/live) behind existing PIN

### Out of scope

- Wallet analyzer / leaderboard copy trading (explicitly declined — user does not want daily manual review)
- Polymarket CLI install, wallet import, or any form of live order placement
- Multi-agent bull/bear debate, multi-model consensus, full 4-analyst pipeline
- Cross-platform arbitrage, market making, liquidity provision
- Live trading (requires separate design after 200+ paper trades)

## 2. Architecture

### 2.1 Module layout

All code lives under `src/poly/` and runs in-process inside the existing ClaudeClaw Node.js service. No separate sidecar, no file-based IPC. Mirrors the module boundaries established by `src/trading/` (the regime-trader bridge) so the mental model stays consistent.

```
src/poly/
├── types.ts              Zod schemas + TS types for Market, Outcome,
│                         PaperTrade, Signal, Position
├── gamma-client.ts       HTTP client for gamma-api.polymarket.com
│                         (read-only, no auth, aggressive caching)
├── clob-client.ts        HTTP client for clob.polymarket.com
│                         (read-only: orderbook depth, midpoint, best bid/ask)
├── market-scanner.ts     Scheduled scan: pulls active markets,
│                         filters by liquidity/volume/close-date, caches
├── strategy-engine.ts    Orchestrates scan → strategies → risk gates → broker
├── strategies/
│   └── ai-probability.ts Claude Opus 4.6 probability estimator +
│                         edge calculator
├── risk-gates.ts         Three deterministic gates (pure functions)
├── paper-broker.ts       Simulates fills at current best ask; writes
│                         poly_paper_trades rows
├── pnl-tracker.ts        Daily job: resolves closed markets, marks trades
│                         as won/lost, updates realized P&L
├── digest.ts             6am Telegram digest generator
├── alerts.ts             Event-driven Telegram alerts (new signal,
│                         trade executed, risk breach)
├── telegram-commands.ts  /poly subcommand router
└── index.ts              initPoly() — constructs modules, wires events,
│                         registers commands, hands jobs to scheduler
```

### 2.2 Integration points with existing code

| Existing module | How `src/poly/` uses it |
|-----------------|------------------------|
| `src/config.ts` | Add `POLY_*` env vars (see §6). Follow existing `readEnvFile` pattern. |
| `src/scheduler.ts` | Register four recurring jobs (the existing scheduler uses setInterval-based ticks per `src/scheduler.ts`; follow the same pattern — no new cron lib). Jobs: market scan (15m), digest (checked every 5m, fires once per day at the configured hour with a `last_digest_yyyymmdd` guard in `kv`), P&L reconciliation (1h), signal evaluation (15m, chained after scan completes — scan emits `scan_complete`, evaluator subscribes). Registrations are idempotent on reboot. Any job in flight at shutdown is allowed to finish (hooked into existing SIGTERM graceful-shutdown path). |
| `src/db.ts` | Add four tables via migration. Reuse existing encryption machinery. |
| `src/index.ts` | One call to `initPoly(bot, sender, db, scheduler)` after trading init. |
| `src/dashboard.ts` | New `/api/poly/*` endpoints for positions, signals, P&L (follow-up, not blocking Phase A/C ship). |
| Anthropic SDK | Construct a fresh `@anthropic-ai/sdk` client inside `strategies/ai-probability.ts`, reading `ANTHROPIC_API_KEY` from env. Do **not** go through the Agent SDK / agent runner — probability estimation is a stateless single-completion call with no tool use, JSON-only output, parsed with Zod. This is a deliberate departure from the chat path because we need deterministic, fast, cacheable calls. |
| `SECURITY_PIN_HASH` | Guards `/poly mode live` — unreachable in this spec but wired defensively. |

### 2.3 Data flow

```
                    ┌──────────────────────────────────────┐
                    │    scheduler (cron, existing)        │
                    └──┬────────┬──────────┬───────────┬───┘
                       │ 15m    │ 15m      │ 1h        │ daily 6am
                       ▼        ▼          ▼           ▼
               ┌──────────┐ ┌────────────┐ ┌────────┐ ┌────────┐
               │ scanner  │ │ evaluator  │ │ pnl    │ │ digest │
               └────┬─────┘ └─────┬──────┘ └───┬────┘ └───┬────┘
                    │             │            │          │
             gamma+clob API   strategy →   gamma API   db query
                    │         risk gates       │          │
                    ▼             │            ▼          ▼
              poly_markets        ▼       poly_paper_   Telegram
              (upsert cache) paper_broker   trades      (send)
                                  │        (resolve)
                                  ▼
                              poly_paper_trades
                              poly_signals
                              poly_positions
                                  │
                                  ▼
                             alerts → Telegram
```

### 2.4 Persistence schema

Five new SQLite tables plus one kv flag. The migration runs inside a single `BEGIN IMMEDIATE` / `COMMIT` transaction via better-sqlite3 so partial failure rolls back cleanly. Migration is idempotent (uses `CREATE TABLE IF NOT EXISTS`) so reboot is safe.

```sql
-- Cached market metadata; refreshed on each scan.
CREATE TABLE poly_markets (
  slug              TEXT PRIMARY KEY,
  condition_id      TEXT NOT NULL,
  question          TEXT NOT NULL,
  category          TEXT,
  outcomes_json     TEXT NOT NULL,       -- [{token_id, outcome, price}]
  volume_24h        REAL NOT NULL DEFAULT 0,
  liquidity         REAL NOT NULL DEFAULT 0,
  end_date          INTEGER NOT NULL,    -- unix seconds
  closed            INTEGER NOT NULL DEFAULT 0,
  resolution        TEXT,                -- winning outcome once resolved
  last_scan_at      INTEGER NOT NULL
);
CREATE INDEX idx_poly_markets_volume ON poly_markets(volume_24h DESC);
CREATE INDEX idx_poly_markets_end ON poly_markets(end_date);

-- Every signal the strategy emits, approved or not.
CREATE TABLE poly_signals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at        INTEGER NOT NULL,
  market_slug       TEXT NOT NULL,
  outcome_token_id  TEXT NOT NULL,
  outcome_label     TEXT NOT NULL,
  market_price      REAL NOT NULL,
  estimated_prob    REAL NOT NULL,
  edge_pct          REAL NOT NULL,
  confidence        TEXT NOT NULL,       -- low|medium|high
  reasoning         TEXT NOT NULL,
  contrarian        TEXT,
  approved          INTEGER NOT NULL,    -- 0/1
  rejection_reasons TEXT,                -- JSON array, null if approved
  paper_trade_id    INTEGER               -- FK to poly_paper_trades if executed
);
CREATE INDEX idx_poly_signals_created ON poly_signals(created_at DESC);

-- Simulated fills. One row per trade.
CREATE TABLE poly_paper_trades (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at        INTEGER NOT NULL,
  market_slug       TEXT NOT NULL,
  outcome_token_id  TEXT NOT NULL,
  outcome_label     TEXT NOT NULL,
  side              TEXT NOT NULL,       -- 'BUY' (only side in Phase C)
  entry_price       REAL NOT NULL,       -- simulated best-ask at signal time
  size_usd          REAL NOT NULL,
  shares            REAL NOT NULL,       -- size_usd / entry_price
  kelly_fraction    REAL NOT NULL,
  strategy          TEXT NOT NULL,       -- 'ai-probability' for Phase C
  status            TEXT NOT NULL,       -- open|won|lost|voided
  resolved_at       INTEGER,
  realized_pnl      REAL,                -- null while open
  voided_reason     TEXT                 -- set when status='voided'
);

-- status='voided' applies when: (a) Gamma reports market resolution
-- ambiguous/invalid (condition resolver flags it) or (b) market is
-- delisted. Voided trades refund size_usd to free_capital with
-- realized_pnl=0. pnl-tracker is the only writer for this transition.
CREATE INDEX idx_poly_paper_trades_status ON poly_paper_trades(status);

-- Denormalized view of open positions. Maintained by paper-broker on
-- trade execution/close and by pnl-tracker on each hourly tick — the
-- two are the only writers. No DB triggers; app-level reconciliation.
CREATE TABLE poly_positions (
  paper_trade_id    INTEGER PRIMARY KEY REFERENCES poly_paper_trades(id),
  market_slug       TEXT NOT NULL,
  current_price     REAL NOT NULL,
  unrealized_pnl    REAL NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- Rolling 24h price history for /poly trending deltas.
-- One row per (token_id, scan_tick). Rows >36h old pruned on each scan.
CREATE TABLE poly_price_history (
  token_id          TEXT NOT NULL,
  captured_at       INTEGER NOT NULL,
  price             REAL NOT NULL,
  PRIMARY KEY (token_id, captured_at)
);

-- Persisted per-market evaluation cache so Opus tokens aren't re-burned
-- on every restart. Keyed by (slug, outcome, prompt_hash). TTL 2h —
-- rows older than 2h are ignored and eventually pruned.
CREATE TABLE poly_eval_cache (
  cache_key         TEXT PRIMARY KEY,       -- sha256(slug|outcome|prompt_hash)
  slug              TEXT NOT NULL,
  outcome_token_id  TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  probability       REAL NOT NULL,
  confidence        TEXT NOT NULL,
  reasoning         TEXT NOT NULL,
  contrarian        TEXT
);
CREATE INDEX idx_poly_eval_cache_created ON poly_eval_cache(created_at);
```

Runtime flags (halt, alerts on/off, last-scan-stale-alerted) live in the existing `kv` table under keys `poly.halt`, `poly.alerts_enabled`, `poly.scan_stale_flag`. These are runtime state, not config — see §4.1.

## 3. Phase A — Read-only intel

### 3.1 Telegram commands

All routed through a single `/poly` command handler mirroring the `/trade` pattern in `src/trading/telegram-commands.ts`.

**Message length policy**: Telegram caps at 4096 characters. Every command output is truncated at ~3800 chars with a trailing `"… (truncated, N more)"` footer indicating how many items were omitted. List commands (`/poly markets`, `/poly signals`, `/poly positions`) cap at 20 rows; rows with long strings (questions, reasoning) truncate each string to a per-row budget computed so the full message stays under the cap. Detail commands (`/poly market <slug>`) that can't fit send only the essential fields and hint `"/poly market <slug> full"` as a future affordance (not implemented in Phase A).

| Command | Behavior |
|---------|----------|
| `/poly markets` | Top 10 markets by 24h volume from `poly_markets` cache. Format: rank, question (truncated 80 chars), current YES price, 24h volume. |
| `/poly market <slug>` | Full detail: question, category, outcomes table (label, price, implied prob), 24h volume, liquidity, orderbook depth (top 3 levels both sides), end date, time to close. If slug not in cache, reply `"No market '<slug>'. Try /poly markets to see active markets."` (no fuzzy match in Phase A). |
| `/poly trending` | Top 10 by absolute 24h price delta. Requires tracking price history — see §3.3. |
| `/poly closing` | Markets resolving in next 24h with volume ≥ $10k, ordered by close time. |
| `/poly status` | Bot health: last scan timestamp, markets cached, signals last 24h (approved/rejected counts), active paper positions, mode (paper/live), halt status. |
| `/poly help` | Command list. |

### 3.2 Gamma and CLOB API usage

Base URL: `https://gamma-api.polymarket.com`. No auth. Endpoints used (field names subject to verification — see below):

- `GET /markets?active=true&closed=false&limit=500&offset=N` — paginate to fetch full active-market set (~1000-2000 markets at steady state)
- `GET /markets/<slug>` — single-market detail (or `?slug=<slug>` if path form is unsupported)
- `GET /events/<slug>` — event grouping (for multi-outcome markets)

CLOB base URL: `https://clob.polymarket.com`:

- `GET /book?token_id=<id>` — best bids/asks
- `GET /midpoint?token_id=<id>` — midpoint price

**API-shape verification is task 0 of implementation.** Before any code is written, a throwaway script hits both endpoints against a known live market and dumps the raw JSON. Real Gamma is known to use camelCase (`conditionId`, `endDate`, `outcomeTokenIds`), return `outcomes` as a stringified JSON array, and put some volume fields on the parent `event` rather than the market. The types in `src/poly/types.ts` must be written against the actual JSON, not the spec's field names. Zod schemas with `.passthrough()` decode the raw response; a small adapter layer in `gamma-client.ts` normalizes into the internal shape used everywhere else.

Rate limits are generous (unauthenticated ~60 req/min observed). Scanner paces requests at 200ms minimum spacing and backs off exponentially on 429. A single scan completing in under 90s against 1500 markets is the target.

### 3.3 Scan loop

`market-scanner.ts` runs every 15 minutes:

1. Fetch all active markets via Gamma paginated endpoint
2. For each market: upsert into `poly_markets` (slug is PK)
3. Compute 24h price delta: insert current YES price into `poly_price_history`, then look up the row with `captured_at` closest to `now - 24h` (within ±1h tolerance). If no row in range, delta is null and `/poly trending` degrades to "insufficient history" until the table fills. Prune rows older than 36h.
4. Update `last_scan_at`
5. Emit `scan_complete` event; strategy engine subscribes

Scanner is tolerant to transient API failures: exponential backoff, skip-and-log. A hard failure that leaves scan >1h stale triggers an alert.

### 3.4 Daily digest

`digest.ts` runs at 6:00 local time. Composition:

```
Polymarket daily — YYYY-MM-DD

Top 5 by volume (24h):
  1. <question> — YES $0.XX — $XXk vol
  2. ...

High-edge signals pending review:
  • <question> — market YES $0.XX, model est 0.XX, edge +X.X%
  • (none, if empty)

Open paper positions: N  |  Realized P&L today: $XX.XX
```

If there are zero high-edge signals, that section still prints "(none)" so the message shape stays predictable.

### 3.5 Phase A is self-contained

Phase A ships without any strategy or broker code. It proves the API integration, caching, scheduler wiring, and Telegram surface with zero capital risk.

## 4. Phase C — Autonomous paper trading

### 4.1 Configuration vs runtime state

**Configuration** = immutable for a process lifetime, read once from env at boot (the constants table below). Changing requires restart.

**Runtime state** = mutable during a run, persisted in the `kv` table so it survives restart: halt flag (`poly.halt`), alerts-on-off (`poly.alerts_enabled`), last-digest date (`poly.last_digest_yyyymmdd`), scan-stale-already-alerted (`poly.scan_stale_flag`). `/poly halt` / `/poly resume` / `/poly alerts on|off` are runtime-state toggles, not config changes.

Defaults set at module load; all overridable via env:

| Constant | Default | Env var |
|----------|---------|---------|
| Starting paper capital | $5,000 | `POLY_PAPER_CAPITAL` |
| Max per-trade size | $50 | `POLY_MAX_TRADE_USD` |
| Max open positions | 10 | `POLY_MAX_OPEN_POSITIONS` |
| Max total deployed | 50% of capital | `POLY_MAX_DEPLOYED_PCT` |
| Min edge threshold | 8% | `POLY_MIN_EDGE_PCT` |
| Min time to resolution | 24h | `POLY_MIN_TTR_HOURS` |
| Min 24h volume | $10,000 | `POLY_MIN_VOLUME_USD` |
| Daily loss pause | 5% of capital | `POLY_DAILY_LOSS_PCT` |
| Portfolio halt drawdown | 20% of capital | `POLY_HALT_DD_PCT` |
| Kelly fraction | 0.25 | `POLY_KELLY_FRACTION` |
| Evaluation model | `claude-opus-4-6` | `POLY_MODEL` |
| Timezone (digest + daily P&L boundary) | `America/New_York` | `POLY_TIMEZONE` |

All constants read once at startup. Changes require restart. A single timezone governs both the 6am digest and the daily-loss rollover so the two always agree. Stored as an IANA zone name; `luxon` (already a transitive dep of grammy? if not, add it) handles DST correctly.

### 4.2 Strategy: AI-probability

For each candidate market (passes scanner filters: binary outcome, ≥$10k volume, ≥24h to resolution), evaluate at most once per 2 hours per (slug, outcome) pair. Cache lookup hits `poly_eval_cache` (see §2.4); cache key is `sha256(slug|outcome_token_id|prompt_hash)` where `prompt_hash` is a hash of the prompt-template version plus all dynamic fields rounded to the nearest 1% (price) / $1k (volume). Persistent cache survives restart.

Prompt skeleton for Claude Opus 4.6 (final prompt lives in `strategies/ai-probability.ts`):

```
System: You are a prediction-market probability estimator. Given a market
question and the context below, return a JSON object with your estimate of
the true probability of YES, a confidence level, your key reasoning, and
the strongest contrarian evidence you can find.

Output schema (JSON only, no prose):
{
  "probability": 0.0-1.0,
  "confidence": "low" | "medium" | "high",
  "reasoning": "1-3 sentences",
  "contrarian": "strongest evidence against your estimate, 1-2 sentences"
}

Context:
  Question: <market.question>
  Category: <market.category>
  End date: <market.end_date ISO>
  Description: <market.description, if present>
  Current YES ask: $<ask>
  Orderbook summary: best bid $X / best ask $Y, spread Z%, depth $N each side
  Recent activity: 24h volume $V, price 24h ago $P_old vs now $P_now
```

Edge calculation (always uses the ask — that's what we'd pay to enter):

```
edge_pct = (estimated_probability - market_ask_price) * 100
```

Only `BUY YES` in Phase C. Short/sell-to-close is reserved for Phase D.

Claude is called via a direct Anthropic SDK client as described in §2.2 — single completion, no tools, JSON-only output, parsed with Zod. If parsing fails, the signal is discarded (logged at warn level); never execute on malformed output.

### 4.3 Risk gates (all three must pass)

Gate evaluation is pure-functional in `risk-gates.ts` — each gate takes `(signal, portfolio_state, config)` and returns `{ passed: boolean, reason?: string }`. Rejections are logged into `poly_signals.rejection_reasons` as a JSON array.

**Gate 1: Position limits**
- `portfolio.open_position_count < POLY_MAX_OPEN_POSITIONS`
- `portfolio.deployed_usd + trade_size_usd ≤ POLY_MAX_DEPLOYED_PCT × paper_capital`
- No existing open position on the same `(market_slug, outcome_token_id)`
- Trade size ≤ `POLY_MAX_TRADE_USD`

**Gate 2: Portfolio health**
- `portfolio.daily_realized_pnl > -POLY_DAILY_LOSS_PCT × paper_capital` (else pause new entries until next midnight in `POLY_TIMEZONE`)
- `portfolio.total_drawdown_pct < POLY_HALT_DD_PCT` (else set `poly.halt=1` in kv, emit `risk_breach` alert — requires manual `/poly resume`)
- `portfolio.free_capital ≥ trade_size_usd`

**Gate 3: Signal quality**
- `signal.edge_pct ≥ POLY_MIN_EDGE_PCT`
- `market.end_date - now ≥ POLY_MIN_TTR_HOURS`
- Orderbook depth summed across ask levels ≥ `trade_size_usd` AND best-ask level is non-empty (reject if orderbook returns no asks — treated as unpriced)
- `abs(current_ask - signal_ask) / signal_ask ≤ 0.03` — relative 3% drift check, not 3 percentage points

### 4.4 Position sizing (Fractional Kelly)

```
p = estimated_probability
q = 1 - p
b = (1 - market_price) / market_price      // net odds per $1
full_kelly = (p * b - q) / b
size_fraction = max(0, full_kelly * POLY_KELLY_FRACTION)
size_usd = min(
  size_fraction * free_capital,
  POLY_MAX_TRADE_USD
)
```

Edge-case guards: if `full_kelly ≤ 0`, skip. If `size_usd < $1`, skip (not worth the noise). If somehow `size_usd > POLY_MAX_TRADE_USD`, hard-cap.

### 4.5 Paper broker

`paper-broker.ts` simulates fills. On `execute(signal)`:

1. Re-fetch current best ask for the outcome. If the orderbook returned is empty OR the best ask has moved >3% from `signal_ask` (Gate 3 re-validation), abort execution, mark the `poly_signals` row rejected with reason `"orderbook_changed_at_exec"`, and return.
2. Compute `shares = size_usd / entry_price`
3. In a single DB transaction: insert row into `poly_paper_trades` with `status='open'`; insert row into `poly_positions`; update the originating `poly_signals` row with `paper_trade_id`
4. Emit `trade_executed` event → alerts → Telegram

Paper-broker is the only writer of `poly_paper_trades` for `status='open'`. pnl-tracker is the only writer of transitions to `won | lost | voided`. This single-writer discipline prevents the race called out in review.

No slippage model in MVP: assumes fill at observed best ask. This is optimistic; the blueprint's Phase D work will replace with a proper orderbook-walk simulator.

### 4.6 P&L reconciliation

`pnl-tracker.ts` runs hourly:

1. Query `poly_paper_trades` where `status = 'open'`
2. For each: fetch current mid-price → update `poly_positions.current_price` and `unrealized_pnl`
3. Fetch resolution status from Gamma. If `closed=true`:
   - Winning outcome pays $1/share, losers pay $0
   - `realized_pnl = shares × (payout - entry_price)`
   - `status = 'won' | 'lost'`
   - Remove from `poly_positions`
   - Emit `position_resolved` event

A final daily summary alert (part of the 6am digest the next morning) reports the day's closed trades.

### 4.7 Telegram commands (Phase C additions)

| Command | Behavior |
|---------|----------|
| `/poly signals` | Last 20 signals from `poly_signals` with approved/rejected status and reasons |
| `/poly positions` | All open paper positions with live unrealized P&L |
| `/poly pnl` | Realized + unrealized totals, win rate (last 30 days), count toward 200-trade paper threshold |
| `/poly halt` | Sets `poly.halt=1` in kv; evaluator and paper-broker both check this flag at the start of every tick/execute and bail. Any Anthropic call already in flight completes (its result goes to cache but no trade executes). Scanner and P&L tracker are unaffected — halt only stops new entries. |
| `/poly resume` | Clears `poly.halt` |
| `/poly mode [paper\|live]` | Shows current mode. Flipping to `live` requires `SECURITY_PIN_HASH` match AND explicit confirmation string — deliberately awkward to prevent accidents. In Phase C the handler refuses `live` entirely with the message "Live mode unlocks after 200+ paper trades; separate design required." |

### 4.8 Alerts

Event-driven via `alerts.ts` (mirrors `src/trading/alerts.ts` shape):

| Event | Telegram text |
|-------|---------------|
| `signal_approved` | `🎯 New paper trade: <question> YES @ $0.XX — edge +X.X%, size $YY, conf <level>` |
| `risk_breach` | `🛑 HALT: <gate> — <reason>. New entries paused.` |
| `position_resolved` | `✅ Won` or `❌ Lost` + `<question>: $+X.XX` |
| `scan_stale` | `⚠ Market scan stale >1h` (fires once; resets on next successful scan) |

Alerts respect an on/off toggle (`/poly alerts on|off`) persisted in the existing `kv` table.

## 5. Verification criteria

Phase A is done when:
1. Migration runs clean inside a single transaction; all five poly tables exist and re-running the migration is a no-op
2. Scanner completes a full scan without error in <90s and `poly_markets` has >500 rows
3. All five Phase A commands return correctly-formatted responses, respect the 4096-char cap, and handle unknown-slug gracefully
4. One successful 6am digest delivers (one-day criterion, not two — shipping shouldn't gate on wall clock)
5. `npm run build` passes with zero type errors
6. No `console.log` in shipped code; logs go through `src/logger.ts`

Phase C is done when:
1. Strategy engine has emitted at least 20 signals (approved + rejected) — achievable in hours, not days
2. At least 5 paper trades execute and persist across a process restart
3. At least Gate 1 and Gate 3 have each produced one rejection observable in `poly_signals.rejection_reasons`. Gate 2 (portfolio health) is exempt from the check — forcing a drawdown event as an acceptance criterion was an error in the first draft.
4. One market resolves and `realized_pnl` is correctly recorded in `poly_paper_trades`
5. `/poly halt` immediately blocks new entries; `/poly resume` restores them
6. All commands work; build passes; manual QA in Telegram against a live bot instance

## 6. Environment variables (addition to `src/config.ts`)

```
# Polymarket bot (paper trading only in Phase C)
POLY_ENABLED=true
POLY_PAPER_CAPITAL=5000
POLY_MAX_TRADE_USD=50
POLY_MAX_OPEN_POSITIONS=10
POLY_MAX_DEPLOYED_PCT=0.5
POLY_MIN_EDGE_PCT=8
POLY_MIN_TTR_HOURS=24
POLY_MIN_VOLUME_USD=10000
POLY_DAILY_LOSS_PCT=0.05
POLY_HALT_DD_PCT=0.2
POLY_KELLY_FRACTION=0.25
POLY_MODEL=claude-opus-4-6
POLY_SCAN_INTERVAL_MIN=15
POLY_DIGEST_HOUR=6
POLY_TIMEZONE=America/New_York
```

All added via the existing `readEnvFile` pattern in `src/config.ts`. The existing `ANTHROPIC_API_KEY` (already used by the bot for chat) supplies the Claude credentials.

## 7. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Gamma API rate limits or downtime | Exponential backoff, cache-until-next-scan, `scan_stale` alert after >1h failure |
| Claude returns malformed JSON | Zod validation; on parse failure, skip the signal and log. Never execute on ambiguous data. |
| Optimistic fills underestimate slippage | Phase C is paper-only — results are directional, not bankable. Known limitation, documented. |
| Market resolves between signal and execution | Gate 3's TTR check and the 3% price-drift check cover the common cases |
| Kelly sizing produces outsize bets on high-confidence AI estimates | `POLY_KELLY_FRACTION=0.25` plus the hard `POLY_MAX_TRADE_USD=50` cap |
| Cost of Opus evaluations | 2h per-market cache + filter gates limit evaluations to ~50-200 markets/day; well inside Max-plan headroom |
| Halted bot forgets state on restart | Halt flag stored in `kv` table, loaded on boot |

## 8. What this design does not build

The following are called out so they don't silently leak into the implementation:

- No multi-model consensus (single model: Opus 4.6)
- No bull/bear debate agents
- No news or social-sentiment pipelines (Claude reasons from market metadata only)
- No Polymarket CLI, no wallet, no signing keys
- No dashboard UI (command surface is Telegram-only for Phase A/C)
- No backtest harness (future work; Phase C is forward-only paper trading)
- No Phase D strategies (consensus, arb, market making)

## 9. Relationship to the full blueprint

`docs/mega-prompt-polymarket-bot.md` remains the canonical research-backed design doc for the end-state system. This spec is the practical first slice — ~20% of the blueprint, chosen to deliver a running, learning-producing paper trader with minimal architectural lock-in. When Phase D work begins, it will extend these modules (add strategies to `strategies/`, add analyst agents that feed a debate pipeline above `strategy-engine.ts`) rather than replace them.
