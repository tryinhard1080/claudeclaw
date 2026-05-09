# Weather Goat Shadow Operations

## Trigger

Use this runbook when enabling, monitoring, or reviewing Weather Goat as an advisory shadow signal for Polymarket weather markets.

Weather Goat remains shadow-only. Its rows must never carry `paper_trade_id`, must never bypass risk gates, and must not drive paper or live orders until a separate promotion plan passes calibration review.

## Preconditions

- `weather-goat-pp-cli doctor --agent` reports Open-Meteo reachable.
- `npm run poly:paper:status` has no FAIL items.
- The bot is in paper mode.
- Real `.env` changes and PM2 restarts are operator-approved for the current session.

## Enable Shadow Collection

In local `.env` only:

```dotenv
POLY_WEATHER_SHADOW_ENABLED=true
POLY_REFLECTION_ENABLED=false
POLY_EXIT_ENABLED=false
POLY_EXPOSURE_AWARE_SIZING=false
```

Restart only when the operator has approved a live bot restart:

```powershell
npm run pm2:restart
```

## Monitor

Run:

```powershell
npm run trading:status
npx tsx scripts/poly-weather-shadow-report.ts
```

The report shows:

- Weather candidate markets detected from the market cache.
- Parsed weather markets and unsupported parse/location counts.
- Shadow rows written with `prompt_version='v3-weather-shadow'`.
- Any shadow rows accidentally linked to paper trades.
- Resolved Weather Goat Brier score when cached resolutions exist.
- Paired overlap against primary `v3` rows on the same slug and token.
- Coverage by city.

## Promotion Gate

Do not promote Weather Goat beyond shadow until all are true:

- At least 50 Weather Goat shadow rows exist.
- At least 10 resolved Weather Goat rows exist.
- Brier score beats or clearly complements the primary strategy on paired overlap.
- `shadow rows with paper_trade_id` is exactly 0.
- Parser gaps are reviewed and intentionally accepted or fixed.
- A separate promotion plan describes how the signal influences sizing, gates, and alerts.

## Failure Handling

If `paper_trade_id` is non-zero for any Weather Goat row:

1. Treat the report as FAIL.
2. Keep `POLY_WEATHER_SHADOW_ENABLED=false`.
3. Inspect `src/poly/strategy-engine.ts` shadow write paths.
4. Do not restart PM2 until the write path is fixed and tests pass.

If unsupported parse/location count is high:

1. Export the unsupported slugs from the DB.
2. Add only observed market patterns or cities to `src/poly/weather-shadow.ts`.
3. Add tests for each observed pattern before enabling again.

## Verification

```powershell
npx vitest run scripts/poly-weather-shadow-report.test.ts src/poly/weather-shadow.test.ts
npm run typecheck
npx tsx scripts/poly-weather-shadow-report.ts
```
