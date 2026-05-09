# Weather Shadow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add disabled-by-default Weather Goat shadow signals for measurable Polymarket weather-market evaluation.

**Architecture:** Keep `ai-probability` as the live strategy. Add a standalone weather parser/evaluator module, then have `StrategyEngine` optionally write advisory `v3-weather-shadow` rows that never execute trades.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, `child_process.spawn`, Weather Goat CLI.

---

### Task 1: Weather Parser And Adapter

**Files:**
- Create: `src/poly/weather-shadow.ts`
- Test: `src/poly/weather-shadow.test.ts`

**Steps:**
1. Write failing tests for strict weather-market detection, high-temperature parsing, static location resolution, forecast-day argument construction, Weather Goat JSON parsing, and deterministic probability estimates.
2. Run `npx vitest run src/poly/weather-shadow.test.ts` and verify failure.
3. Implement the smallest parser, location map, CLI runner wrapper, and estimator to pass.
4. Run `npx vitest run src/poly/weather-shadow.test.ts` and verify pass.

### Task 2: StrategyEngine Shadow Rows

**Files:**
- Modify: `src/config.ts`
- Modify: `src/poly/strategy-engine.ts`
- Test: `src/poly/strategy-engine.test.ts`

**Steps:**
1. Write failing tests showing `weatherShadowEnabled=true` writes a `v3-weather-shadow` row, and `false` writes no shadow row.
2. Run targeted StrategyEngine tests and verify failure.
3. Add `POLY_WEATHER_SHADOW_ENABLED`, StrategyEngine option injection, and shadow row insertion.
4. Run targeted StrategyEngine tests and verify pass.

### Task 3: Verification

**Files:**
- Modify: `scripts/poly-strategy-compare.ts`
- Test: `scripts/poly-strategy-compare.test.ts`

**Steps:**
1. Write a failing test showing the comparison script includes shadow rows that have no `paper_trade_id`.
2. Switch the script to the resolution-based comparator and keep the no-overlap guidance accurate.
3. Run `npm run typecheck`.
4. Run `npm run build`.
5. Run targeted weather/strategy/script tests.
6. Run full `npm test` with a temporary test `DB_ENCRYPTION_KEY` and isolated `STORE_DIR`.
7. Report remaining manual OAuth step for `financial-datasets`.
