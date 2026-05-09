# Sprint Weather Shadow Research

## Question

Can Weather Goat improve Polymarket weather-market probability estimates without changing live trading behavior?

## Existing System

ClaudeClaw currently runs one Polymarket strategy, `ai-probability` v3. The strategy evaluates top scanner candidates, writes primary rows to `poly_signals`, and sends approved rows through deterministic risk gates before paper execution. Reflection already provides the safe adoption pattern: write advisory shadow rows with a different `prompt_version`, then compare Brier on resolved markets before promoting anything.

## Duplicate / Complement / Conflict / Novel

- Duplicate: Not a replacement for `ai-probability`; it cannot parse every market type.
- Complement: Provides objective weather forecast and climate-normal context for a narrow class of weather markets.
- Conflict: Direct live adoption would violate the one-refined-strategy discipline and add unproven execution behavior.
- Novel: Adds an external, non-LLM weather signal that can be measured as `v3-weather-shadow` against resolved markets.

## Findings

`weather-goat-pp-cli 1.0.1` is installed and `doctor` reports Open-Meteo reachable with no auth required. Agent JSON works when latitude and longitude are supplied. Local free-form geocoding failed with `GET /search returned HTTP 404`, this version uses `--forecast-days` rather than the documented `--days` flag, and `--select results.daily` returned an empty `results` object in live smoke testing.

Polymarket category metadata is unreliable for weather discovery in the current scanner because active market rows commonly normalize to `category = unknown`. Keyword detection must be conservative because terms like Heat, Hurricanes, Storm, and Wind can describe sports teams or player names rather than weather.

## Implementation Shape

1. Add a narrow weather-market classifier and parser for high-temperature markets only.
2. Resolve known city names through a static coordinate map; do not use the broken geocoder at runtime.
3. Add a Weather Goat adapter that shells out with `--agent`, explicit `--latitude`, `--longitude`, and `--forecast-days`; parse the full response rather than using `--select`.
4. Convert forecast highs into a deterministic probability estimate.
5. Add a disabled-by-default StrategyEngine shadow writer tagged `v3-weather-shadow`, `approved=0`, `rejection_reasons='shadow:weather'`, `paper_trade_id=NULL`.
6. Use the resolution-based comparison path, currently exposed by `scripts/poly-strategy-compare.ts`, once matching resolved markets exist.

## How This Changes Code / Strategy

This adds a measured shadow evaluator, not a live strategy. It can accumulate weather-specific advisory rows while preserving the existing risk gates, paper broker, and one-strategy mandate. Promotion requires resolved-market Brier evidence and a separate operator decision.
