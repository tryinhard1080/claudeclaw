# Trading Bot Operational Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the ClaudeClaw trading stack to a repeatable, monitored, paper-trading operational state with Weather Goat shadow evaluation, Regime Trader bridge health, authenticated research data, and explicit gates before any live-capital work.

**Architecture:** Keep ClaudeClaw as the orchestrator and operator surface. Treat Polymarket execution as paper-only until readiness gates pass; treat Weather Goat and financial datasets as advisory/shadow research inputs; treat `C:\Code\regime-trader` as an external partner process whose state is read by ClaudeClaw but owned separately.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Hono dashboard, PM2 on Windows, PowerShell, Weather Goat CLI, Claude Code MCP, Regime Trader Python venv.

---

## Current Baseline

- `C:\Code\claudeclaw` main is clean and tracking `origin/main`.
- `npm run status` reports `All systems go`.
- `claudeclaw-main` is online in PM2 from `C:\Code\claudeclaw\dist\index.js`.
- Regime Trader PM2 entries point at `C:\Code\regime-trader\main.py` with cron `30 9 * * 1-5` and `autorestart=false`.
- Regime Trader state files now contain fresh market-closed state with `next_open=2026-05-11 09:30:00-04:00`.
- `weather-goat-pp-cli doctor --agent` reports Open-Meteo reachable and auth not required.
- `financial-datasets` MCP is installed but still needs OAuth through Claude Code `/mcp`.

## Operating Principle

The next target is "fully operational paper trading." Do not add real-money order placement until paper trading, alerting, restore drills, and shadow-evaluator calibration are boring for at least one full market week.

---

### Task 1: Trading Readiness Command

**Files:**
- Create: `src/trading/ops-status.ts`
- Create: `src/trading/ops-status.test.ts`
- Create: `scripts/trading-readiness.ts`
- Modify: `package.json`

**Purpose:** One command should answer "is the trading bot operational right now?" without manually checking PM2, logs, DB rows, MCP, and Weather Goat.

**Step 1: Write failing tests**

Test pure helpers in `src/trading/ops-status.test.ts`:
- `summarizePm2Apps()` returns healthy when `claudeclaw-main` is online, Regime Trader apps are either running during market hours or stopped before `next_open`, and paths point to `C:\Code`.
- `summarizeFinancialDatasetsMcp()` returns `needs_auth` for `financial-datasets: ... Needs authentication`.
- `summarizeWeatherGoatDoctor()` returns healthy for `{"api":"reachable","auth":"not required"}`.
- `summarizeRegimeState()` returns healthy for closed-market state before `next_open`, stale after `next_open + grace`, and unhealthy when state is missing.
- `summarizePolyScanRuns()` returns healthy when the most recent successful scan is within `2 * POLY_SCAN_INTERVAL_MIN`.

Run:

```powershell
npx vitest run src/trading/ops-status.test.ts
```

Expected: FAIL because the module does not exist.

**Step 2: Implement minimal helpers**

Implement pure functions in `src/trading/ops-status.ts`. Keep shell execution outside the pure helpers so tests do not require PM2, MCP, Weather Goat, or the live DB.

**Step 3: Add the CLI wrapper**

Create `scripts/trading-readiness.ts` that:
- Runs `pm2 jlist`.
- Runs `weather-goat-pp-cli doctor --agent`.
- Runs `claude mcp list`.
- Reads the ClaudeClaw SQLite DB from `STORE_DIR`.
- Reads Regime Trader state files from `REGIME_TRADER_PATH`.
- Prints a concise PASS/WARN/FAIL table and exits non-zero on FAIL.

Add script:

```json
"trading:status": "tsx scripts/trading-readiness.ts"
```

**Step 4: Verify**

Run:

```powershell
npx vitest run src/trading/ops-status.test.ts
npm run typecheck
npm run build
npm run trading:status
```

Expected: tests/typecheck/build pass. `trading:status` should show one warning until `financial-datasets` OAuth is completed.

**Step 5: Commit**

```powershell
git add src/trading/ops-status.ts src/trading/ops-status.test.ts scripts/trading-readiness.ts package.json
git commit -m "Add trading readiness status command"
```

---

### Task 2: Durable Regime Trader PM2 Management

**Files:**
- Create: `scripts/regime-trader-pm2-config.ts`
- Create: `scripts/regime-trader-pm2-config.test.ts`
- Create: `scripts/regime-trader-pm2.ts`
- Create: `docs/runbooks/regime-trader-pm2.md`
- Modify: `package.json`

**Purpose:** The live PM2 manifest now exists in `C:\Users\Richard\.claudeclaw\regime-trader.pm2.json`, but it should be regenerable from repo-owned code and documented.

**Step 1: Write failing config tests**

Test that the generated config contains:
- `regime-trader-spy-agg` and `regime-trader-spy-cons`.
- `cwd=C:/Code/regime-trader`.
- `script=C:/Code/regime-trader/main.py`.
- `interpreter=C:/Code/regime-trader/.venv/Scripts/python.exe`.
- Args `--paper --instance spy-aggressive` and `--paper --instance spy-conservative`.
- `autorestart=false`.
- `cron_restart=30 9 * * 1-5`.

Run:

```powershell
npx vitest run scripts/regime-trader-pm2-config.test.ts
```

Expected: FAIL because the config builder does not exist.

**Step 2: Implement config builder and installer**

`scripts/regime-trader-pm2-config.ts` exports a pure `buildRegimeTraderPm2Config()` function.

`scripts/regime-trader-pm2.ts` writes the config to `C:\Users\Richard\.claudeclaw\regime-trader.pm2.json` and prints the exact PM2 commands:

```powershell
pm2 start C:\Users\Richard\.claudeclaw\regime-trader.pm2.json
pm2 save
```

Add script:

```json
"trading:pm2:write": "tsx scripts/regime-trader-pm2.ts"
```

**Step 3: Document operating behavior**

In `docs/runbooks/regime-trader-pm2.md`, document:
- Why Regime Trader stops on weekends and after market close.
- Why `autorestart=false` is intentional.
- How to regenerate PM2 config.
- How to verify paths with `pm2 describe`.
- How to confirm fresh state files.

**Step 4: Verify**

Run:

```powershell
npx vitest run scripts/regime-trader-pm2-config.test.ts
npm run trading:pm2:write
pm2 start C:\Users\Richard\.claudeclaw\regime-trader.pm2.json
pm2 save
pm2 describe regime-trader-spy-agg
pm2 describe regime-trader-spy-cons
```

Expected: PM2 paths point at `C:\Code\regime-trader`; apps are either running during market hours or stopped after clean market-closed exit.

**Step 5: Commit**

```powershell
git add scripts/regime-trader-pm2-config.ts scripts/regime-trader-pm2-config.test.ts scripts/regime-trader-pm2.ts docs/runbooks/regime-trader-pm2.md package.json
git commit -m "Add durable Regime Trader PM2 setup"
```

---

### Task 3: Regime State Contract Hardening

**Files:**
- Create: `src/trading/state-schema.ts`
- Create: `src/trading/state-schema.test.ts`
- Modify: `src/trading/state-poller.ts`
- Modify: `src/trading/types.ts`
- Modify: `src/trading/telegram-commands.ts`

**Purpose:** ClaudeClaw should handle both full open-market Regime Trader state and partial closed-market state explicitly.

**Step 1: Write failing schema tests**

Cover:
- Full open-market state with `regime`, `risk`, `positions`, and `recent_signals`.
- Partial closed-market state with `next_open`, `equity`, and `cash`.
- Invalid state missing `market_open`.
- Future `next_open` state should be classified as intentionally paused.
- Past `next_open` state should become stale after grace.

Run:

```powershell
npx vitest run src/trading/state-schema.test.ts
```

Expected: FAIL because schema module does not exist.

**Step 2: Implement schema parser**

Use `zod` if already accepted locally, otherwise lightweight TypeScript validation. Export:
- `parseInstanceState(raw: unknown): InstanceStateParseResult`
- `isClosedUntilNextOpen(state, nowMs): boolean`
- `isFullRegimeState(state): boolean`

**Step 3: Wire poller and Telegram commands through schema**

Update `src/trading/state-poller.ts` to parse with the schema before staleness decisions.

Update `src/trading/telegram-commands.ts` to render partial closed-market state without touching optional regime/risk fields.

**Step 4: Verify**

Run:

```powershell
npx vitest run src/trading/state-schema.test.ts src/trading/state-poller.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/trading/state-schema.ts src/trading/state-schema.test.ts src/trading/state-poller.ts src/trading/types.ts src/trading/telegram-commands.ts
git commit -m "Harden Regime Trader state contract"
```

---

### Task 4: Monday Market-Open Drill

**Files:**
- Create: `docs/runbooks/market-open-drill.md`
- Create: `docs/runbooks/market-open-drill-results-template.md`

**Purpose:** The bot is not fully operational until it survives a real weekday market open.

**Step 1: Write the runbook**

Include exact schedule:
- 8:20 AM Central / 9:20 AM Eastern: preflight.
- 8:30 AM Central / 9:30 AM Eastern: confirm Regime Trader cron starts.
- 8:35 AM Central: confirm state files move from closed-market partial state to open-market full state.
- 8:40 AM Central: confirm `/trade status`, `/poly status`, and dashboard.
- 9:00 AM Central: confirm no stale/down alerts.

Commands:

```powershell
npm run status
npm run trading:status
pm2 list
pm2 logs claudeclaw-main --lines 80 --nostream
pm2 logs regime-trader-spy-agg --lines 80 --nostream
pm2 logs regime-trader-spy-cons --lines 80 --nostream
Get-Content C:\Code\regime-trader\instances\spy-aggressive\data\state.json -TotalCount 40
Get-Content C:\Code\regime-trader\instances\spy-conservative\data\state.json -TotalCount 40
```

**Step 2: Define pass/fail**

Pass:
- ClaudeClaw PM2 online.
- Both Regime Trader instances start at cron.
- State files update within 10 minutes of market open.
- No repeated `instance_stale` or `instance_down` alerts after state refresh.
- Dashboard and Telegram commands still respond.

Fail:
- PM2 points at `C:\Projects`.
- State files do not update.
- Regime Trader exits because of missing credentials.
- ClaudeClaw still reports stale after fresh state exists.

**Step 3: Commit**

```powershell
git add docs/runbooks/market-open-drill.md docs/runbooks/market-open-drill-results-template.md
git commit -m "Add market-open trading drill"
```

---

### Task 5: Polymarket Paper-Trading Acceptance Gate

**Files:**
- Modify: `scripts/poly-qa-smoke.ts`
- Create: `scripts/poly-paper-readiness.ts`
- Create: `scripts/poly-paper-readiness.test.ts`
- Create: `docs/runbooks/polymarket-paper-readiness.md`
- Modify: `package.json`

**Purpose:** Paper trading should prove scanner, CLOB, evaluator, paper fills, positions, exits, and alerts before any live-order design.

**Step 1: Write failing readiness tests**

Test pure helpers that classify:
- Recent scan health from `poly_scan_runs`.
- Open paper position counts from `poly_paper_trades`.
- Whether halt flag is on.
- Whether exit settings are enabled/disabled.
- Whether exposure-aware sizing is enabled/disabled.

Run:

```powershell
npx vitest run scripts/poly-paper-readiness.test.ts
```

Expected: FAIL.

**Step 2: Implement CLI**

`scripts/poly-paper-readiness.ts` should print:
- Latest successful scan age.
- Market count and captured count.
- Number of signals in last 24h.
- Number of approved signals in last 24h.
- Open paper positions.
- Realized P&L today.
- Halt flag.
- Exit setting status.
- Exposure-aware sizing status.

Add script:

```json
"poly:paper:status": "tsx scripts/poly-paper-readiness.ts"
```

**Step 3: Run smoke checks**

Run:

```powershell
npx tsx scripts/poly-qa-smoke.ts
npm run poly:paper:status
```

Optional paid evaluator check:

```powershell
npx tsx scripts/poly-qa-live-eval.ts
```

**Step 4: Acceptance gate**

Do not enable live-capital work until:
- `poly-qa-smoke` passes.
- Paper bot records at least 20 fresh signals.
- At least one paper position opens and is visible in `/poly positions`.
- Halt/resume drill passes.
- DB backup/restore drill passes.

**Step 5: Commit**

```powershell
git add scripts/poly-qa-smoke.ts scripts/poly-paper-readiness.ts scripts/poly-paper-readiness.test.ts docs/runbooks/polymarket-paper-readiness.md package.json
git commit -m "Add Polymarket paper readiness gate"
```

---

### Task 6: Weather Goat Shadow Operationalization

**Files:**
- Create: `scripts/poly-weather-shadow-report.ts`
- Create: `scripts/poly-weather-shadow-report.test.ts`
- Modify: `src/poly/weather-shadow.ts`
- Modify: `src/poly/weather-shadow.test.ts`
- Create: `docs/runbooks/weather-shadow-ops.md`

**Purpose:** Weather Goat should become a measurable advisory signal for weather markets, not a hidden toggle.

**Step 1: Write failing report tests**

Cover:
- Count of `prompt_version='v3-weather-shadow'` rows.
- Count of weather rows with matching resolved market.
- Brier score for Weather Goat shadow rows.
- Paired overlap against primary strategy when both evaluated same slug/token.
- Coverage report by city and unsupported city.

Run:

```powershell
npx vitest run scripts/poly-weather-shadow-report.test.ts
```

Expected: FAIL.

**Step 2: Implement report**

`scripts/poly-weather-shadow-report.ts` should print:
- Total weather markets detected.
- Shadow rows written.
- Unsupported parse/location count.
- Resolved overlap count.
- Brier score if enough samples exist.
- Recommendation: keep shadow only, expand parser, or consider promotion.

**Step 3: Expand parser only when live coverage proves gaps**

Add new city/market-pattern tests only from observed unsupported market rows. Avoid overbuilding.

**Step 4: Enable shadow safely**

In local `.env`, set:

```dotenv
POLY_WEATHER_SHADOW_ENABLED=true
```

Keep:

```dotenv
POLY_REFLECTION_ENABLED=false
POLY_EXIT_ENABLED=false
POLY_EXPOSURE_AWARE_SIZING=false
```

Restart:

```powershell
npm run pm2:restart
```

**Step 5: Acceptance gate**

Weather Goat remains shadow-only until:
- At least 50 shadow rows exist.
- At least 10 resolved rows exist.
- Brier score beats or usefully complements the primary strategy.
- No weather shadow row has `paper_trade_id`.

**Step 6: Commit**

```powershell
git add scripts/poly-weather-shadow-report.ts scripts/poly-weather-shadow-report.test.ts src/poly/weather-shadow.ts src/poly/weather-shadow.test.ts docs/runbooks/weather-shadow-ops.md
git commit -m "Add Weather Goat shadow operations report"
```

---

### Task 7: Financial Datasets MCP Research Enablement

**Files:**
- Create: `docs/runbooks/financial-datasets-mcp.md`
- Create: `docs/research/financial-research-agent-prompts.md`

**Purpose:** Financial Datasets MCP benefits the agent research workflow, but it is not a runtime trading data feed until a deliberate integration exists.

**Step 1: Complete manual OAuth**

Inside Claude Code:

```text
/mcp
```

Authenticate `financial-datasets`.

Verify:

```powershell
claude mcp list
```

Expected:

```text
financial-datasets: https://mcp.financialdatasets.ai/ (HTTP) - ✓ Connected
```

Official docs reference: https://docs.financialdatasets.ai/mcp-server

**Step 2: Write the runbook**

Document:
- Install command.
- Auth command.
- Verification command.
- What data it is allowed to influence: research notes, context, comparison.
- What it must not do yet: directly trigger trades.

**Step 3: Write prompt templates**

Create prompts for:
- Equity fundamentals snapshot.
- Crypto context snapshot.
- Company event research.
- Cross-checking a market claim before a Polymarket evaluation.

**Step 4: Commit**

```powershell
git add docs/runbooks/financial-datasets-mcp.md docs/research/financial-research-agent-prompts.md
git commit -m "Document Financial Datasets MCP research workflow"
```

---

### Task 8: Dashboard And Alert Surface

**Files:**
- Create: `src/trading/ops-dashboard.ts`
- Create: `src/trading/ops-dashboard.test.ts`
- Modify: `src/dashboard.ts`
- Modify: `src/dashboard-html.ts`

**Purpose:** The dashboard should show the same operational truth as `npm run trading:status`.

**Step 1: Write failing pure renderer tests**

Test `buildTradingOpsPayload()` with fixture inputs:
- PM2 healthy.
- Financial datasets needs auth.
- Weather Goat healthy.
- Regime Trader closed until next open.
- Polymarket scan fresh.

Run:

```powershell
npx vitest run src/trading/ops-dashboard.test.ts
```

Expected: FAIL.

**Step 2: Implement API payload**

Create `/api/trading/ops` in `src/dashboard.ts`, using the pure `ops-status` helpers from Task 1.

**Step 3: Add a compact dashboard section**

In `src/dashboard-html.ts`, add a small "Trading Ops" panel:
- ClaudeClaw PM2 status.
- Polymarket scan age.
- Regime Trader state.
- Weather Goat status.
- Financial Datasets MCP auth.
- Last paper P&L summary.

**Step 4: Verify**

Run:

```powershell
npx vitest run src/trading/ops-dashboard.test.ts
npm run typecheck
npm run build
npm run pm2:restart
```

Open dashboard and confirm the panel renders.

**Step 5: Commit**

```powershell
git add src/trading/ops-dashboard.ts src/trading/ops-dashboard.test.ts src/dashboard.ts src/dashboard-html.ts
git commit -m "Add trading ops dashboard panel"
```

---

### Task 9: Drills And Recovery Proof

**Files:**
- Modify: `docs/runbooks/README.md`
- Create: `docs/runbooks/trading-drill-log.md`

**Purpose:** Operational means recovery is practiced, not just documented.

**Step 1: Run halt/resume drill**

```powershell
npx tsx scripts/drill-halt-resume.ts
```

Expected:
- Halt flag is set.
- Strategy engine refuses new paper trades while halted.
- Resume clears halt flag.

**Step 2: Run backup/restore drill**

```powershell
npx tsx scripts/drill-db-restore.ts
```

Expected:
- Restored DB readable in scratch workspace.
- Live DB untouched.
- Key tables present.

**Step 3: Run DB bloat check**

```powershell
npx tsx scripts/check-db-bloat.ts
```

Expected:
- DB and WAL sizes within documented thresholds.

**Step 4: Document results**

Record date, commands, outputs, and pass/fail in `docs/runbooks/trading-drill-log.md`.

**Step 5: Commit**

```powershell
git add docs/runbooks/README.md docs/runbooks/trading-drill-log.md
git commit -m "Record trading operations drill results"
```

---

### Task 10: Controlled Feature Activation

**Files:**
- Create: `docs/runbooks/trading-feature-flags.md`
- Modify: `.env.example`

**Purpose:** Make every trading toggle intentional.

**Step 1: Update `.env.example`**

Add the currently supported trading flags if missing:

```dotenv
POLY_WEATHER_SHADOW_ENABLED=false
POLY_REFLECTION_ENABLED=false
POLY_EXIT_ENABLED=false
POLY_TAKE_PROFIT_PCT=0.30
POLY_STOP_LOSS_PCT=0.50
POLY_EXPOSURE_AWARE_SIZING=false
POLY_KELLY_LOW_MULT=0.3
POLY_KELLY_MED_MULT=0.7
POLY_KELLY_HIGH_MULT=1.0
```

**Step 2: Write activation runbook**

Document three profiles:
- Baseline paper: `POLY_ENABLED=true`, all advanced toggles false.
- Weather shadow: baseline plus `POLY_WEATHER_SHADOW_ENABLED=true`.
- Advanced paper: enable exits and exposure-aware sizing only after drills pass.

**Step 3: Define live-capital no-go rule**

Write explicitly:
- No live Polymarket order adapter until a separate plan adds signing, wallet/key custody, min-size checks, kill switch, and live-order dry-run review.
- No live order path can be enabled by `POLY_ENABLED=true`; it must require a separate `POLY_LIVE_EXECUTION_ENABLED=true` and a startup confirmation check.

**Step 4: Verify**

Run:

```powershell
npm run typecheck
npm run build
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add .env.example docs/runbooks/trading-feature-flags.md
git commit -m "Document trading feature flag profiles"
```

---

## Definition Of Done

The trading bot is operational when all of these are true:

1. `npm run status` reports `All systems go`.
2. `npm run trading:status` reports no FAIL items.
3. `financial-datasets` MCP is connected or intentionally marked optional.
4. `weather-goat-pp-cli doctor --agent` reports reachable.
5. `pm2 describe claudeclaw-main` points at `C:\Code\claudeclaw`.
6. `pm2 describe regime-trader-spy-agg` and `pm2 describe regime-trader-spy-cons` point at `C:\Code\regime-trader`.
7. Monday market-open drill passes.
8. Polymarket scanner has recent successful `poly_scan_runs`.
9. Paper trading records signals and at least one paper position during observation.
10. Halt/resume and DB restore drills pass.
11. Weather shadow rows are being collected with no paper trades attached.
12. Dashboard shows trading ops status.
13. `npm run typecheck`, `npm run build`, and `npm test` pass after the final merge.

## Suggested Execution Order

1. Task 1: trading readiness command.
2. Task 2: durable Regime Trader PM2 management.
3. Task 3: state contract hardening.
4. Task 4: Monday market-open drill.
5. Task 5: paper-trading acceptance gate.
6. Task 7: Financial Datasets OAuth/runbook.
7. Task 6: Weather Goat shadow operations.
8. Task 8: dashboard ops panel.
9. Task 9: drills.
10. Task 10: feature flag profiles.

## First Next Step

Start with Task 1. It gives us one command that tells us what is broken, which prevents the rest of the work from becoming manual log spelunking.
