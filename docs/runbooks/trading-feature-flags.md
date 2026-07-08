# Trading Feature Flags

## Purpose

This runbook defines the supported trading flag profiles for ClaudeClaw paper trading. It also makes the live-capital boundary explicit: paper-mode flags must never imply live execution.

Only edit real `.env` during an operator-approved activation window. This repo update changes `.env.example` only.

## Baseline Paper Profile

Use this for normal paper-trading operation:

```dotenv
POLY_ENABLED=true
POLY_WEATHER_SHADOW_ENABLED=false
POLY_REFLECTION_ENABLED=false
POLY_EXIT_ENABLED=false
POLY_EXPOSURE_AWARE_SIZING=false
```

Expected behavior:

- Scanner runs on the configured interval.
- Primary strategy can write paper signals and paper trades.
- Advanced evaluators and exit rules stay disabled.
- No live orders exist.

Verify:

```powershell
npm run poly:paper:status
npm run trading:status
```

## Weather Shadow Profile

Use this when collecting advisory Weather Goat rows:

```dotenv
POLY_ENABLED=true
POLY_WEATHER_SHADOW_ENABLED=true
POLY_REFLECTION_ENABLED=false
POLY_EXIT_ENABLED=false
POLY_EXPOSURE_AWARE_SIZING=false
```

Expected behavior:

- Weather Goat rows are tagged with `prompt_version='v3-weather-shadow'`.
- Weather rows are written with `approved=0`.
- Weather rows have `rejection_reasons='shadow:weather'`.
- Weather rows must have `paper_trade_id` NULL.

Verify:

```powershell
npx tsx scripts/poly-weather-shadow-report.ts
```

No promotion is allowed until `docs/runbooks/weather-shadow-ops.md` gates pass.

## Advanced Paper Profile

Use this only after the halt/resume and DB restore drills pass:

```dotenv
POLY_ENABLED=true
POLY_WEATHER_SHADOW_ENABLED=false
POLY_REFLECTION_ENABLED=false
POLY_EXIT_ENABLED=true
POLY_TAKE_PROFIT_PCT=0.30
POLY_STOP_LOSS_PCT=0.50
POLY_EXPOSURE_AWARE_SIZING=true
```

Expected behavior:

- Intraday paper exits can close paper positions at take-profit or stop-loss thresholds.
- Exposure-aware sizing deducts open deployed capital before sizing new paper trades.
- These are still paper-only controls.

Verify:

```powershell
npm run poly:paper:status
npx tsx scripts/drill-halt-resume.ts
npx tsx scripts/drill-db-restore.ts
```

## Tuning Flags

Default paper sizing and scan controls:

```dotenv
POLY_PAPER_CAPITAL=5000
POLY_MAX_TRADE_USD=50
POLY_MAX_OPEN_POSITIONS=30
POLY_MAX_DEPLOYED_PCT=0.5
POLY_MIN_EDGE_PCT=8
POLY_MIN_TTR_HOURS=24
POLY_MIN_VOLUME_USD=10000
POLY_DAILY_LOSS_PCT=0.05
POLY_HALT_DD_PCT=0.2
POLY_KELLY_FRACTION=0.25
POLY_KELLY_LOW_MULT=0.3
POLY_KELLY_MED_MULT=0.7
POLY_KELLY_HIGH_MULT=1.0
POLY_SCAN_INTERVAL_MIN=15
POLY_SCAN_TOP_N=20
POLY_MIN_MARKET_PRICE=0.15
POLY_MAX_MARKET_PRICE=0.85
```

Changing risk, sizing, and strategy thresholds is a Tier 3 decision when it materially changes exposure or trade behavior. The 30-slot Polymarket setting is a paper-learning cap; max trade size and max deployed percentage still define the dollar exposure ceiling.

## Live-Capital No-Go Rule

No live Polymarket order adapter may be added until a separate plan covers:

- Wallet and key custody.
- Signing flow.
- Minimum order-size checks.
- Balance and allowance checks.
- Live kill switch.
- Live order dry-run review.
- Explicit operator sign-off.

`POLY_ENABLED=true` must never enable live orders. A future live path must require a separate flag named `POLY_LIVE_EXECUTION_ENABLED=true`, and startup must refuse live execution unless that flag, wallet configuration, and operator sign-off are all present.

## Activation Procedure

1. Select one profile above.
2. Edit real `.env` only during an approved activation window.
3. Run `npm run typecheck`.
4. Run `npm run build`.
5. Restart PM2 only if deploying the active bot process.
6. Run `npm run trading:status`.
7. Record the activation result in `docs/runbooks/trading-drill-log.md`.
