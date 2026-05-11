# Codex Review — Sprints 20-27 + Readiness Plan (2026-05-11)

**Reviewer:** Claude Sonnet 4.6 (feature-dev:code-reviewer agent, background)
**Range:** `git log d186090..HEAD` — ~30 commits since the 2026-04-22 review.
**Files reviewed:** `src/poly/risk-gates.ts`, `src/poly/paper-broker.ts`, `src/poly/pnl-tracker.ts`, `src/poly/strategy-engine.ts`, `src/poly/strategies/ai-probability.ts`, `src/poly/news-sync.ts`, `scripts/news-sync.ts`, `migrations/v1.14.0/v1.14.0-news-position-alerts.ts`, `src/poly/news-intersection.ts`.
**Verdict:** **1 P1 — FIXED THIS SESSION** before pm2 restart. Box 5 ackable on this pass after fix landed.

---

## Findings

### [P1 — FIXED] `src/poly/strategy-engine.ts:532` — `buildPortfolioSnapshot` realized-P&L sum missing `'exited'`

**Fix commit:** _(this session — see git log)_
**Regression test:** `src/poly/strategy-engine.test.ts` — `[hotfix 2026-05-11] exited trades count toward drawdown auto-halt`

**Reviewer confidence:** 95.

**Description.** Sprint 8 `exitPosition` (`src/poly/paper-broker.ts:177`) writes `status='exited'` for take-profit and stop-loss closes. `buildPortfolioSnapshot` at line 532 summed realized P&L with `WHERE status IN ('won','lost','voided')` — `'exited'` was absent.

**Consequence chain:**

1. `totalRealized` undercounts when any Sprint-8 exit has fired.
2. `equity = paperCapital + totalRealized + unrealized` is overstated.
3. `totalDrawdownPct = max(0, (paperCapital - equity) / paperCapital)` is understated.
4. Both `gate2PortfolioHealth` (`risk-gates.ts:113`) and `maybeAutoHaltOnDrawdown` (`risk-gates.ts:152`) consume `portfolio.totalDrawdownPct` from this snapshot. The drawdown auto-halt could fail to fire after a string of stop-loss exits.

**Asymmetry that surfaced the bug.** `getDailyRealizedPnl` (`pnl-tracker.ts:264`) uses the correct filter `status IN ('won','lost','voided','exited')`. The daily loss floor sees accurate P&L. The portfolio drawdown computation did not. Codex caught the divergence.

**Current production exposure.** `POLY_EXIT_ENABLED=false` (per `.env.example` and `docs/runbooks/trading-feature-flags.md`), so `'exited'` rows do not currently exist in the live DB. **The bug is latent** — it would activate the moment Phase 7 flips `POLY_EXIT_ENABLED`. Fix lands now to prevent shipping the flag-flip into a known-broken drawdown computation.

**Fix applied.**

```diff
   const realizedRow = this.db.prepare(`
     SELECT COALESCE(SUM(realized_pnl), 0) AS total
-      FROM poly_paper_trades WHERE status IN ('won','lost','voided')
+      FROM poly_paper_trades WHERE status IN ('won','lost','voided','exited')
   `).get() as { total: number };
```

**Regression test.** Seeds a single `'exited'` row with `realized_pnl=-200` and `paperCapital=1000` configured with `haltDdPct=0.10`. Drawdown is `200/1000 = 0.20`, crossing the threshold. After `engine.onScanComplete()`, the test asserts `poly_kv['poly.halt']='1'`. Without the fix, drawdown computes to 0 (the exited row is excluded), threshold is not crossed, halt does not fire, test fails.

---

## TRUST-Tier-3 Surface Verdicts

All re-verified against current HEAD (`ebfddf6`).

### `src/poly/risk-gates.ts` — **PASS**
- Auto-halt idempotency correct: `prior !== '1'` edge-trigger, `INSERT … ON CONFLICT DO UPDATE` prevents double-write.
- Gate 1 / 2 / 3 ordering correct (sizer ceiling → drawdown → minimum edge).
- Gate-1 ceiling math (`maxDeployedPct * paperCapital`) consistent with `computeAvailableCapital` in `strategy-engine.ts` — Sprint 25 sizer alignment confirmed (the ceiling-refinement nit from `docs/research/sprint-9-exposure-aware-sizing.md` is now in sync).

### `src/poly/paper-broker.ts` — **PASS**
- No real-money path. Paper-only fill semantics.
- All three writes (paper_trade + position + signal link) wrapped in a single `db.transaction()`.
- Exit guard `WHERE id = ? AND status = 'open'` prevents concurrent double-close.
- `status='exited'` correctly excluded from Brier/A-B comparison queries (line 149 comment confirms).

### `src/poly/pnl-tracker.ts` — **PASS**
- Resolution accounting correct: `winners.length !== 1` → voided.
- `realizedFor` math correct (won = `shares * (1 - entryPrice)`, lost = `-shares * entryPrice`).
- `getDailyRealizedPnl` includes all four terminal statuses including `'exited'`. Tz-aware via Luxon.

### `src/poly/strategy-engine.ts` — **FAIL → FIXED**
- P1 above. Now fixed.
- Sprint 25 sizer ↔ gate-1 alignment confirmed separately.
- `isHalted()` and auto-halt per-tick call correct.

### `src/poly/strategies/ai-probability.ts` — **PASS**
- Cache key composition: `PROMPT_TEMPLATE_HASH | slug | tokenId | ask | vol | spread | depth | endDay | cat | question`.
- News context is NOT passed into `evaluateMarket` and is not part of the cache key — correct, because news lives in the intersection pass, not the eval call. No cache collision risk after Sprint 24.

### `src/poly/news-sync.ts` + `scripts/news-sync.ts` — **PASS**
- Sprint 26 pwm CLI path correct; `PPLX_API_KEY` is on/off sentinel only after the swap.
- Sprint 27 refusal detection: 12 patterns matched case-insensitively, maps to `exit 0` on `sonar-refusal`. Exit-code contract correct.

### `migrations/v1.14.0/v1.14.0-news-position-alerts.ts` — **PASS**
- `PRIMARY KEY (news_item_id, paper_trade_id)` is composite and non-nullable.
- `INSERT OR IGNORE` dispatch gate in `news-intersection.ts:176` uses `db.changes() === 1` correctly.
- `ensureTable` mirrors migration DDL exactly. Deploy/migrate gap safe.

---

## Gate Recommendation

**P0 count:** 0
**P1 count:** 1 (fixed this session — verified by passing regression test and 733/733 full suite)

**MISSION Box 5: ackable on this pass.** Codex baseline established. Next run should be triggered by either (a) a Phase 7 flag-flip touching the Sprint 8 exit path, or (b) any subsequent edit to a TRUST Tier-3 surface.
