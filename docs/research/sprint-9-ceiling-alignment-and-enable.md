# Sprint 9 Follow-up — Ceiling Alignment + Flag Enable

> Completes the work deferred in `sprint-9-exposure-aware-sizing.md`. Operator authorized flag-enable via "Do all of the above" in session on 2026-04-16.

## 1. Existing-code audit

Current state (post audit remediation):

- `src/poly/strategy-engine.ts:123-129` `computeAvailableCapital(db, paperCapital)` → `max(paperCapital - SUM(open exposure), 0)`.
- `src/poly/risk-gates.ts:88-91` `gate1PositionLimits` rejects when `deployedUsd + sizeUsd > maxDeployedPct * paperCapital`.
- `.env` line ~280: `POLY_EXPOSURE_AWARE_SIZING=false` (default).
- Sprint-9 audit flagged: sizer uses `paperCapital` as ceiling; gate uses `maxDeployedPct * paperCapital`. Ceilings disagree.

## 2. Literature / NotebookLM finding

Same as Sprint 9 audit: Thorp's Kelly with multiple simultaneous positions uses "capital at risk against the deployment cap" as the relevant bankroll. The deployment cap here is `maxDeployedPct * paperCapital`, not the full `paperCapital`.

## 3. Duplicate / complement / conflict verdict

**Complement (alignment fix).** The Sprint 9 audit identified a small but real misalignment. Aligning makes sizer and gate use the same frontier; Sprint 9 stops producing sizes that are more likely than necessary to hit gate 1.

## 4. Why now

Operator authorized flag-enable in session. Aligning before enable is the honest path — the audit already flagged the nit; shipping flag-on without the fix would leave a known imperfection in a money-relevant code path.

Measurable improvement after enable (30-day window): approval-rate conditional on `deployedUsd > 0.7 * maxDeployedPct * paperCapital` should rise vs flag-off baseline. Baseline currently zero (flag never enabled).

## 5. Out of scope

- Changing `POLY_MAX_DEPLOYED_PCT` itself (Tier 3 monetary risk parameter).
- Changing Kelly fraction, edge threshold, or other sizing params.
- Any change to `risk-gates.ts` or `paper-broker.ts` core logic.

## 6. Risk

Blast radius: **low.**

- Code change: 1 function signature change + internal math update, ~10 lines. Same return shape.
- Flag flip: enables a conservative sizing path (produces ≤ sizes vs flag-off, never larger). Gate 1 still catches anything that somehow exceeds the cap.
- Rollback: flip flag back to `false`. Code remains in place but dormant.

## 7. Verification plan

- New unit test asserting `computeAvailableCapital` respects `maxDeployedPct` ceiling.
- Existing Sprint 9 tests updated to reflect new semantics.
- Full test suite green.
- pm2 restart; confirm logs show new scan + no exceptions.
- Watch next 7 days for approval-rate change near the cap.

[audit]
