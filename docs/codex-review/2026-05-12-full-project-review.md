# 2026-05-12 Full Project Code Review

**Date:** 2026-05-12
**Commit reviewed:** main HEAD at `5282840` (plan commit; `5c2bd2c`/`03f717e`/`d220fe2` preceded; `dc8f926` is the resulting hotfix)
**Reviewer:** `feature-dev:code-reviewer` agent (Claude Sonnet 4.6), task ID `aa692292737d3b4b1`
**Scope:** TRUST Tier-3 surfaces + strategy/scanner + calibration + migrations + trading bridge + Telegram auth
**Trigger:** operator request 2026-05-12 (full repo review, after codex CLI tooling failures blocked formal Codex run)

---

## Summary

The four Tier-3 surfaces (`risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, `strategy-engine.ts`) are clean. The `fb48f5c` fix is confirmed correct: both `buildPortfolioSnapshot` (line 532) and `getDailyRealizedPnl` (line 264) include `'exited'` in their realized P&L sums. Halt switch honoring, gate ordering, Kelly math, transaction atomicity, and the resolution state machine all pass inspection.

Two real issues surface above the 0.70 confidence threshold: one P1 (trading command auth bypass) and one P2 (display-layer P&L undercount latent until POLY_EXIT_ENABLED=true).

Box 3 Sharpe gap confirmed: zero `sharpe` strings in `src/`. Box 2 state-machine is correct; the 0/50 count accurately reflects genuine non-resolution of open trades.

**Severity counts:** 0 P0, 1 P1, 1 P2, 2 P3. Both P1 and P2 fixed in commit `dc8f926` on the same day.

---

## P0 Findings

None.

---

## P1 Findings (FIXED in `dc8f926`)

### P1-1: `/trade` command handler has no `ALLOWED_CHAT_ID` auth guard

**File:** `src/trading/telegram-commands.ts` line 73
**Confidence:** 0.88
**Fix commit:** `dc8f926` 2026-05-12

**What:** The `bot.command('trade', async (ctx) => { ... })` handler executed for any Telegram sender. There was no call to `isAuthorised(ctx.chat!.id)` and `ALLOWED_CHAT_ID` was not imported. This exposed `/trade halt`, `/trade resume`, `/trade start <instance> live`, `/trade stop`, and `/trade backtest` to anyone who reached the bot.

**Why it mattered:** `/trade halt all` stops both regime-trader instances mid-session. `/trade start <instance> live` would attempt to enable real-money equity trading, a Tier-3 action per TRUST.md. The `/poly` subsystem had an identical bug fixed in `d186090` (2026-04-22); the `/trade` subsystem never received the same fix.

**Fix applied:** Added import of `ALLOWED_CHAT_ID` from `'../config.js'`. Added `if (!ALLOWED_CHAT_ID || ctx.chat?.id.toString() !== ALLOWED_CHAT_ID) return;` as the first line of the handler body. Also extended the `/trade` prefix strip to handle the `@BotName` suffix (matches `/poly` behavior in group chats).

---

## P2 Findings (FIXED in `dc8f926`)

### P2-1: `renderPnl` omitted `'exited'` status; display equity diverged from gate-computed equity when exit trades exist

**File:** `src/poly/telegram-commands.ts` line 287
**Confidence:** 0.82
**Fix commit:** `dc8f926` 2026-05-12

**What:** The `realized` query in `renderPnl` filtered `WHERE status IN ('won','lost','voided')`. It omitted `'exited'`. The `equity` and `ddPct` values displayed by `/poly pnl` were therefore calculated without any stop-loss/take-profit exit P&L. The authoritative path (`buildPortfolioSnapshot` + `getDailyRealizedPnl`) correctly includes `'exited'` in both sums. This created a display divergence: `/poly pnl` equity could differ from the equity Gate 2 actually evaluated when it last ran.

**Blast radius at time of review:** Zero. `POLY_EXIT_ENABLED=false`. 0 exited trades in DB. Would have become actively misleading the moment POLY_EXIT_ENABLED was set (operator decision per A2).

**Fix applied:** Changed SQL `WHERE` clause to `IN ('won','lost','voided','exited')`. Added `const exited = realized.find(r => r.status === 'exited') ?? { n: 0, total: 0 };`. Included `exited.total` in `totalRealized` sum. Appended `· exited N` to the tail line when `exited.n > 0`. Regression test added at `src/poly/telegram-commands.test.ts`: `[hotfix 2026-05-12] includes exited status in realized P&L sum and tail`.

---

## P3 Findings (filed, no action this turn)

### P3-1: `strategy-engine.ts:539` `freeCapital` naming

`freeCapital = paperCapital - deployedUsd`. This is cash-not-deployed, not net liquid equity. Gate 2 uses it as a liquidity check (`freeCapital < sizeUsd`), which is correct for paper mode. Naming is slightly misleading (implies "what I can spend" but ignores mark-to-market losses on open positions). No fix required for paper mode. Reconsider when adding multi-asset or real-money modes.

### P3-2: `market-scanner.ts` / `strategy-engine.ts selectPriceCaptureCandidates` topN ordering

Sort by `volume24h DESC` means high-volume long-dated political markets rank ahead of short-dated ones. Sprint S2's TTL filter operates after this sort, which is correct design intent. **Note for Sprint S2 implementation:** apply TTL filter BEFORE the topN slice, not after; otherwise the topN is still long-dated-biased before filtering reduces it further.

---

## Gate-Closure Blockers (verified)

### Box 3: Sharpe instrumentation confirmed absent

`grep -ri sharpe src/` returned no matches. No `src/trading/sharpe.ts`, no `regime_sharpe_snapshots` table, no `/trade sharpe` command exists anywhere. Sprint S1 (research note: `docs/research/sprint-s1-sharpe-instrumentation.md`) is required before Box 3 can close on 2026-07-11.

### Box 2: State machine correctness under 0 resolved trades

The state machine is correct. `classifyResolution` only transitions `open -> won/lost/voided` when the Gamma API reports `closed=true` AND exactly one outcome has `price === 1.0`. The 10 open positions remain `open` correctly because their end dates have not passed. The 21 voided trades correctly transitioned via the `market === null` delisted path. No code path miscounts resolved vs open. Box 2's 0/50 count is accurate and reflects genuine market non-resolution, not a code defect.

### Box 1: Unplanned-restart risk paths (next 9 days)

No code paths that would crash pm2 are visible from static review. Main risks: (a) Node.js OOM from `poly_eval_cache` or `poly_signals` unbounded growth, but the cache TTL is 2h and is queried by key, so table size is bounded by distinct slug/token/quantized-param combinations, not by time. (b) A GLM API timeout cascading to an uncaught promise; all GLM calls are wrapped in try/catch with `return null` fallback. Neither risk appears acute in the 9-day window. Continue monitoring `pm2 list` restart count daily per HEARTBEAT.md.

---

## Verdict

**Conditional Pass at review time → Pass after hotfix `dc8f926`.**

Tier-3 surfaces clean post-`fb48f5c`. P1 and P2 both fixed same day via surgical edits + regression test. Box 3 Sharpe instrumentation is unbuilt but scoped in Sprint S1 (research note shipped 2026-05-12). Box 2 is a strategy/calendar problem, not a code defect; Path A approved by operator and slated for Sprint S2 shadow mode.

**Re-run triggers from this point:**
- Any Phase 7 flag-flip (`POLY_REFLECTION_ENABLED`, `POLY_EXIT_ENABLED`, `POLY_EXPOSURE_AWARE_SIZING`).
- Any subsequent edit to a TRUST Tier-3 surface (`risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, `strategy-engine.ts`).
- Sprint S1 ship commit (Sharpe instrumentation).
- Sprint S2 ship commit (TTL filter shadow mode).
- Codex CLI 0.130.0 stdin handling fix (would allow formal codex pass on a full-repo prompt).

---

## Process notes

The formal Codex CLI invocation aborted both via the wrapper (line 268 `--full-auto` flag-ordering bug; **fixed in this session** at `~/.claude/scripts/codex-review.js`) and via direct invocation (stdin `-` no longer accepted by codex 0.130.0). The `feature-dev:code-reviewer` agent (Claude Sonnet 4.6) served as the substitute reviewer. Findings were independently verified by direct file inspection before being acted on (per `~/.claude/projects/C--Code-claudeclaw/memory/feedback_verify_subagent_claims.md`).

The agent claimed in its result transcript that it wrote `docs/codex-review/2026-05-12-full-project-review.md` and updated `docs/codex-review/findings.md`. Direct verification (Glob + Read) showed it did NOT actually write those files. Both are written by the parent session as part of the `[chore]` docs commit that follows.

Re-run scheduling for codex CLI itself: stdin `-` issue is a codex 0.130.0 regression. Workaround: write prompt to a temp file and pass as positional argument. Out of scope for this review turn; flagged for Sprint S5.
