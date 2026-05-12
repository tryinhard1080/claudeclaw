# Sprint S1: Sharpe Instrumentation (Box 3 prerequisite)

**Date:** 2026-05-12
**Plan reference:** `docs/plans/2026-05-12-real-money-gate-closure.md` §6 Sprint S1
**Gate box closed:** Box 3 prerequisite (positive paper Sharpe over ≥60 days)
**Verdict:** NOVEL with existing-infrastructure complement
**Effort estimate:** 3-5 hours
**Tier:** 2 (additive only, no Tier-3 surface touched)

---

## 1. Why this sprint exists

MISSION.md Box 3 requires "Equity strategies (regime-trader) have positive paper Sharpe over ≥60 days." The clock started 2026-05-12; target completion 2026-07-11.

The bot has zero Sharpe instrumentation today. Grep `sharpe|Sharpe` across `src/` and `scripts/` returns zero hits. There is no daily-return capture, no rolling-window math, no persistence table, no Telegram command, no dashboard tile.

Without this sprint, Box 3 cannot close at Day 60 even if the underlying strategy is producing positive returns. The data simply isn't being recorded.

This is the smallest, safest sprint that closes a hard gate prerequisite.

---

## 2. Existing-code audit (mandated by build discipline)

Grep evidence collected 2026-05-12:

```
$ grep -r "sharpe\|Sharpe" src/ scripts/ migrations/
(zero hits)

$ grep -r "daily_return\|annualized\|risk_free" src/
(zero hits in code; only doc references in EVOLUTION.md and plan files)

$ grep -r "equity\|account_equity" src/
src/poly/strategy-engine.ts          (Polymarket equity, separate context)
src/poly/telegram-commands.ts        (poly equity reporting)
src/trading/types.ts                 (FullRegimeInstanceState.equity)
src/trading/state-schema.ts          (parseInstanceState validates equity)
src/trading/state-poller.ts          (reads state.json periodically)
src/trading/state-poller.test.ts
src/trading/ops-status.ts            (MinimalRegimeState.equity)
src/trading/ops-status.test.ts
```

**Existing infrastructure that S1 builds on (no duplication):**

| Component | File | What it does | S1 uses it how |
|---|---|---|---|
| State.json schema validation | `src/trading/state-schema.ts:parseInstanceState` | Validates `equity` (finite number), `cash`, `regime`, `risk`, `positions`, `recent_signals` | S1 calls this to parse the daily snapshot input |
| State.json poller | `src/trading/state-poller.ts` | 5-sec poll for live ops monitoring | S1 does NOT use the poller; daily snapshot uses a separate read at fixed UTC time |
| Ops-status summarizer | `src/trading/ops-status.ts:summarizePm2Apps` | `npm run trading:status` consumer; reports per-instance health | S1 adds a Sharpe row to the trading-status output once data exists |
| Trading Telegram commands | `src/trading/telegram-commands.ts` | `/trade <subcommand>` dispatcher | S1 adds a new `/trade sharpe` subcommand |
| Scheduled tasks table | `migrations/0011*.sql` (or equivalent) + `scripts/schedule-cli.ts` | Persisted cron jobs with prompts | S1 adds one new `kind=shell` task running daily |

**Verdict:** NOVEL primary work (sharpe math + snapshot table + cron + command). COMPLEMENT to four existing infrastructure pieces. NO DUPLICATION. NO CONFLICT.

---

## 3. Design decisions

### 3.1 Data source

**State.json field `equity`** is authoritative. Each regime-trader instance writes a fresh state.json atomically at every 5-min bar (per `8e33adb`'s atomic state writer). The `equity` field is a marked-to-market account-equity snapshot from Alpaca paper API at the moment of state write.

Alternative considered: query Alpaca directly via API call. **Rejected.** Reasons: (a) extra dependency on a second IPC path, (b) state.json already has the exact value Alpaca reports, (c) state.json's atomic write guarantees consistency with the regime/risk fields we'd also want.

### 3.2 Snapshot cadence

**Daily, at 17:00 CT (post-close).** US market closes at 15:00 CT for SPY (regular hours) and 19:00 CT for SPY (extended hours, Alpaca paper has zero activity post-close anyway).

17:00 CT picks the equity value with two hours of settling, accounts for any post-close adjustments Alpaca may apply. Runs as a `kind=shell` scheduled task: cron `0 17 * * 1-5`.

Alternative considered: per-bar (5-min) sharpe rolling computation. **Rejected.** Reasons: (a) MISSION Box-3 says "over ≥60 days" not "over ≥60 days * 78 bars/day"; a daily snapshot matches the spec, (b) per-bar Sharpe has noise dominating signal at this timescale, (c) storage cost grows ~78x for no measurement gain.

### 3.3 Daily return computation

```
daily_return = (today_equity - yesterday_equity) / yesterday_equity
```

If no `yesterday_equity` exists (first day or gap), daily_return is NULL and skipped from Sharpe denominator.

Weekend / holiday handling: if the cron fires on a non-trading day (it shouldn't per `* * 1-5` filter), skip the row. If it fires on a Monday after a 3-day weekend (Friday → Monday gap), daily_return uses Friday's equity vs Monday's. This is correct: Sharpe annualized using `√252` already assumes trading days, not calendar days.

### 3.4 Sharpe computation

Rolling-window over the last 60 trading days:

```
mean_return = mean(daily_returns[-60:])
std_return  = stddev(daily_returns[-60:], ddof=1)
risk_free   = 0.0                          # see §3.5
annualized_sharpe = (mean_return - risk_free) * sqrt(252) / std_return
```

Returns NULL until `len(daily_returns) >= 2` (need at least one std-dev). Returns sample-sized Sharpe for windows 2-59 days with a `n_days` field so consumers can decide whether to trust the partial-window number. Box 3 closure requires `n_days >= 60`.

### 3.5 Risk-free rate

**Default to 0.0%** for v1. Justified: (a) regime-trader is paper, no real T-bill comparison, (b) MISSION Box 3 says "positive paper Sharpe" without specifying risk-free rate, (c) introducing a non-zero RF rate adds a config knob and an external data dependency (T-bill yield) for no Box-3 gain.

Future: a `POLY_SHARPE_RF_RATE` env var could be added when we need risk-adjusted comparison. Out of scope for S1.

### 3.6 Per-instance vs aggregated

**Per-instance snapshots.** Each row has `instance` ∈ {`spy-aggressive`, `spy-conservative`}. Box 3 closure check is then: "BOTH instances show positive Sharpe over their respective 60-day windows" OR "either instance shows positive Sharpe and the other is non-negative" OR some operator-defined rule. The data structure supports any of these.

Aggregated portfolio Sharpe (across both instances) requires reconciling them against shared capital, which they don't share (separate Alpaca paper accounts). Out of scope; not needed for Box 3.

---

## 4. Schema

### 4.1 New table `regime_sharpe_snapshots`

Migration `v1.15.0` (next available; current is `v1.14.0`).

```sql
CREATE TABLE IF NOT EXISTS regime_sharpe_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  instance        TEXT    NOT NULL,                -- 'spy-aggressive' | 'spy-conservative'
  snapshot_date   TEXT    NOT NULL,                -- 'YYYY-MM-DD' in US/Central
  equity          REAL    NOT NULL,
  cash            REAL,
  peak_equity     REAL,
  daily_return    REAL,                            -- NULL for first row per instance
  rolling_sharpe_60d  REAL,                        -- NULL until n_days >= 2
  n_days          INTEGER NOT NULL,                -- count of daily returns in window
  source          TEXT    NOT NULL DEFAULT 'state_json',
  created_at      INTEGER NOT NULL,
  UNIQUE(instance, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_regime_sharpe_snapshots_instance_date
  ON regime_sharpe_snapshots(instance, snapshot_date DESC);
```

UNIQUE(instance, snapshot_date) guards against the cron firing twice on the same day (idempotent INSERT OR REPLACE).

### 4.2 No edits to existing tables

S1 does not touch `poly_*` tables, `scheduled_tasks` schema, or any Tier-3 surface.

---

## 5. Modules

### 5.1 `src/trading/sharpe.ts` (NEW, pure functions)

```typescript
export interface SharpeSnapshot {
  instance: string;
  snapshotDate: string;       // YYYY-MM-DD (US/Central)
  equity: number;
  cash: number | null;
  peakEquity: number | null;
  dailyReturn: number | null;
  rollingSharpe60d: number | null;
  nDays: number;
}

export function computeDailyReturn(
  todayEquity: number,
  yesterdayEquity: number | null
): number | null;

export function computeRollingSharpe(
  dailyReturns: ReadonlyArray<number>,
  options?: { riskFreeRate?: number; periodsPerYear?: number }
): { sharpe: number | null; nDays: number };

export function summarizeSharpe(
  snapshots: ReadonlyArray<SharpeSnapshot>
): {
  instance: string;
  latestSharpe60d: number | null;
  nDays: number;
  trend: 'rising' | 'falling' | 'flat' | 'insufficient';
}[];
```

All pure functions. No I/O. No SQL. Unit-tested with known-answer fixtures (see §7).

### 5.2 `scripts/regime-sharpe-snapshot.ts` (NEW, cron entry point)

```typescript
// Reads state.json for each instance, computes daily return + rolling Sharpe,
// upserts to regime_sharpe_snapshots, exits 0 on success.
// Logs to stderr; no Telegram side effects in v1.
```

Pseudocode:
1. Resolve `STORE_DIR` and DB path.
2. For each instance in `['spy-aggressive', 'spy-conservative']`:
   a. Read `C:/Code/regime-trader/instances/<instance>/data/state.json`.
   b. Validate via `parseInstanceState`.
   c. Compute today's snapshot date in US/Central.
   d. Query last snapshot row for this instance to get `yesterdayEquity`.
   e. Compute `dailyReturn`.
   f. Query last 60 `daily_return` values, append today's, compute rolling Sharpe.
   g. INSERT OR REPLACE into `regime_sharpe_snapshots`.
3. Emit one stdout line: `regime-sharpe-snapshot: instance=X equity=Y daily_return=Z sharpe60=W n_days=N`.

### 5.3 Scheduled-task registration script (NEW, one-shot)

`scripts/register-regime-sharpe-cron.ts` — adds one row to `scheduled_tasks`:

```
kind:        'shell'
prompt:      'Daily 17:00 CT regime-trader Sharpe snapshot. Reads state.json per instance, computes daily return + rolling Sharpe-60d, writes to regime_sharpe_snapshots.'
command:     'node dist/scripts/regime-sharpe-snapshot.js'
cron:        '0 17 * * 1-5'
enabled:     1
```

### 5.4 `src/trading/telegram-commands.ts` (EXTEND)

Add `/trade sharpe` subcommand. Output:

```
Regime Trader Sharpe (rolling 60d):
  spy-aggressive:   sharpe=+0.42  n_days=21/60  trend=rising
  spy-conservative: sharpe=+0.28  n_days=21/60  trend=rising
  spark: ▁▁▂▃▄▄▅▆▇
```

If `n_days < 2`, output: `not enough data yet (n_days=N)`.

### 5.5 `src/trading/ops-status.ts` (EXTEND)

Add new check `regime-sharpe`:
- `pass` if latest snapshot is within 24h AND `n_days >= 1`.
- `warn` if latest snapshot is 1-3 days stale.
- `fail` if latest snapshot is >3 days stale OR `n_days = 0` after 5 trading days.

---

## 6. Implementation order (TDD)

Each step is independently shippable.

1. **Pure-function module + tests.** `src/trading/sharpe.ts` + `src/trading/sharpe.test.ts`. Known-answer fixtures (see §7). Ship green. ~45 min.
2. **Migration v1.15.0.** New table. Add to `migrations/`. Verify `npm run migrate` plays clean against the live schema. ~15 min.
3. **Snapshot script + tests.** `scripts/regime-sharpe-snapshot.ts` + integration test using a fixture state.json and an ephemeral SQLite DB. Verify upsert correctness. ~60 min.
4. **Cron registration.** `scripts/register-regime-sharpe-cron.ts`. One-shot. ~15 min.
5. **Telegram command.** `/trade sharpe` subcommand + tests. ~30 min.
6. **Ops-status integration.** Add `regime-sharpe` check + tests. ~30 min.
7. **Codex review.** Required per DoD. ~variable.

Total estimate: 3-4 hours of implementation + ≤1 hour for codex + restart + verification.

---

## 7. Known-answer test fixtures

### Fixture A: constant 0.5% daily return

```typescript
const returns = Array(60).fill(0.005);
// mean = 0.005, std = 0 (degenerate; expect null Sharpe)
expect(computeRollingSharpe(returns).sharpe).toBeNull();
```

Sharpe is undefined when std = 0. The implementation returns `null` in that case rather than `+Infinity`.

### Fixture B: 0.5% daily return with 0.1% noise

```typescript
// Generate seeded array with mean 0.005, std ~0.001
// Expected annualized Sharpe ≈ (0.005 * sqrt(252)) / 0.001 ≈ 79.4
// (Far higher than any real strategy; fixture proves math direction not realism)
```

### Fixture C: zero mean return

```typescript
const returns = [0.01, -0.01, 0.01, -0.01, ...];
// mean = 0, std > 0, Sharpe = 0
expect(computeRollingSharpe(returns).sharpe).toBe(0);
```

### Fixture D: insufficient data

```typescript
expect(computeRollingSharpe([]).sharpe).toBeNull();
expect(computeRollingSharpe([0.01]).sharpe).toBeNull();  // n=1, can't compute std
expect(computeRollingSharpe([0.01, 0.02]).nDays).toBe(2);
```

### Fixture E: realistic SPY-like return series

Generate 60 days from a normal distribution N(μ=0.0004, σ=0.012) (SPY-ish daily return).
Expected annualized Sharpe ≈ 0.53. Asserted within ±0.1 to handle seed variance.

### Fixture F: rolling window correctness

```typescript
const returns = [0.01, 0.02, 0.03, /* 57 more */, 0.04];
// computeRollingSharpe(returns) uses last 60.
// computeRollingSharpe(returns.slice(0, 30)) uses all 30, sets n_days=30.
```

---

## 8. Verification (Definition of Done)

Sprint S1 is "done" when ALL of these hold:

| Check | Method |
|---|---|
| All sharpe.ts unit tests pass | `npm test src/trading/sharpe.test.ts` |
| Migration v1.15.0 applies clean against live DB | `npm run migrate` |
| `regime_sharpe_snapshots` table exists with correct schema | Schema dump |
| Cron registered in `scheduled_tasks` | DB query for `name='regime-sharpe-snapshot'` |
| First snapshot row written | Manual `npm run regime-sharpe-snapshot` once after deploy |
| `/trade sharpe` returns at least one instance row | Telegram |
| `npm run trading:status` shows new `regime-sharpe` check (warn until first row) | Status output |
| `npm test` passes 100% | Full test run |
| `npm run typecheck` clean | tsc |
| `npm run build` clean | Build |
| Codex review pass (zero P0/P1) | `node ~/.claude/scripts/codex-review.js --commit <SHA>` |
| pm2 restart | New dist running |

Box 3 progress check after S1 ships:
- `n_days` for each instance increments by 1 per trading day.
- At `n_days = 60`, the latest `rolling_sharpe_60d` value drives Box-3 closure decision.
- Target date: 2026-07-11.

---

## 9. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| State.json missing or malformed when cron fires | medium | one missed day | `parseInstanceState` returns explicit `ok: false`; script logs and exits 0 without writing a bad row |
| Cron fires twice on same day (e.g., manual run after auto-run) | low | overwritten row | UNIQUE(instance, snapshot_date) + INSERT OR REPLACE makes it idempotent |
| pm2 restart during cron window | low | one missed day | scheduled_tasks dispatcher retries on next fire; gap is acceptable |
| Equity field semantics change in regime-trader state.json | low | wrong Sharpe values | `parseInstanceState` validates equity is a finite number; semantic drift would need a regime-trader code change |
| Box 3 60-day clock window inclusive vs exclusive | low | off-by-one on target date | Use `>= 60` not `> 60` in closure check; document as "≥60 trading days of daily returns" |
| Sharpe value swings wildly on small n_days (< 30) | medium | misleading dashboard | `/trade sharpe` outputs `n_days/60` so reader knows confidence; Box 3 closure rule requires n_days ≥ 60 |
| Risk-free rate of 0% understates true Sharpe | low | conservative bias | Acceptable for v1; document as design choice in §3.5 |

---

## 10. What S1 explicitly does NOT do

- Does not modify `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, `strategy-engine.ts` (TRUST.md Tier-3 surfaces).
- Does not modify any existing migration; only adds v1.15.0.
- Does not change Polymarket logic in any way.
- Does not introduce a non-zero risk-free rate (deferred to a future env-var sprint).
- Does not aggregate across instances into a "portfolio Sharpe" (deferred; not needed for Box 3).
- Does not auto-fire alerts on Sharpe drops (defer to a future Sprint S1.5 or similar; current sprint just records).
- Does not modify the regime-trader Python code (state.json producer is upstream).

---

## 11. Definition of Done (gate-tied)

This sprint closes Box 3's prerequisite. **Box 3 itself does not close until 2026-07-11** when n_days hits 60 with positive Sharpe.

Sprint S1's "shipped" state is when the Definition-of-Done table in §8 is fully checked. The downstream Box-3 closure check runs on cron from then on.

---

## 12. Selection-rule compliance (per active plan)

Per `docs/plans/2026-05-12-real-money-gate-closure.md` §5, this sprint passes the acceptance test:

| Acceptance test | This sprint |
|---|---|
| Names a specific MISSION.md gate box | ✅ Box 3 |
| States expected days-shaved on that box's clock OR % movement | ✅ Closes Box 3's instrumentation prerequisite; without S1, Box 3 cannot close at Day 60 regardless of returns |
| Does not depend on another PROPOSED operator item | ✅ Zero operator dependencies |
| Has a research note in `docs/research/sprint-<N>-<topic>.md` | ✅ This file |
| Has a target metric tied to the gate box | ✅ `n_days >= 60` and `rolling_sharpe_60d > 0` |
| Estimated effort ≤ 1 day | ✅ 3-5 hours |

---

Plan committed as a frozen snapshot. To revise: edit this file, commit with `[chore] research:` prefix.
