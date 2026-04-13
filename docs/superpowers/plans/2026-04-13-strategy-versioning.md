# Strategy Versioning Implementation Plan (Sprint 2)

> **For agentic workers:** This plan is executed autonomously by the authoring agent under Sprint-level autonomy (TRUST.md §Tier 2). No per-task sign-off required. Codex review + test suite are the quality gates.

**Goal:** Tag every new signal with `(prompt_version, model)` so we can compare strategy variants on overlap and ship only improvements. Build the offline compare harness that turns Sprint 1's Brier metric into a decision tool.

**Architecture:** New migration v1.4.0 adds two nullable columns to `poly_signals`. `ai-probability.ts` exports `PROMPT_VERSION`; strategy engine writes both values on insert. New pure module `src/poly/strategy-compare.ts` computes paired Brier deltas on the overlap set with a paired t-test for significance. CLI script `scripts/poly-strategy-compare.ts` drives it ad-hoc. No change to live trading behavior.

**Tech Stack:** TS + better-sqlite3 + vitest. One small math addition (paired t-test — implement inline, no stats lib).

---

## File Map

**Create:**
- `migrations/v1.4.0/v1.4.0-strategy-versioning.ts`
- `src/poly/strategy-compare.ts`
- `src/poly/strategy-compare.test.ts`
- `src/poly/strategy-versioning-migration.test.ts`
- `scripts/poly-strategy-compare.ts`

**Modify:**
- `migrations/version.json`
- `tsconfig.json` (exclude new migration test)
- `src/poly/strategies/ai-probability.ts` — export `PROMPT_VERSION`
- `src/poly/strategy-engine.ts` — pass version + model through `insertSignal`
- `src/poly/strategy-engine.test.ts` — assert new columns populated

**Schema delta (v1.4.0):**
```sql
ALTER TABLE poly_signals ADD COLUMN prompt_version TEXT;
ALTER TABLE poly_signals ADD COLUMN model TEXT;
CREATE INDEX IF NOT EXISTS idx_poly_signals_version ON poly_signals(prompt_version);
```

Nullable: rows inserted before the migration keep `NULL` for both columns, which correctly represents "unknown historical version". No backfill.

---

## Tasks

### Task 1: Migration v1.4.0
- Write migration test asserting both columns + index exist; idempotent.
- Write migration using `ALTER TABLE ADD COLUMN` (must be outside transaction on some sqlite builds; use explicit `.exec` without BEGIN/COMMIT for ALTER statements; `CREATE INDEX IF NOT EXISTS` is safe inside).
- Register in `version.json`.
- Apply to prod DB.
- tsconfig excludes the new test.
- Commit.

### Task 2: Export PROMPT_VERSION + add getter for full identity
- Make `PROMPT_VERSION` exported from `ai-probability.ts`.
- Export `POLY_MODEL` is already config — ok.
- Commit.

### Task 3: Thread version + model into signal inserts
- Update `strategy-engine.ts` `insertSignal` to accept and write `prompt_version` + `model`.
- Pull `PROMPT_VERSION` from `ai-probability.ts` and `POLY_MODEL` from config.
- Update test that reads inserted rows to assert the columns populated.
- Typecheck + test.
- Commit.

### Task 4: Pure compare module
- `src/poly/strategy-compare.ts`:
  - `pairedBrierDelta(samples)` — returns per-sample delta array.
  - `pairedTTest(deltas)` — returns `{t, df, pValue, meanDelta}` using two-tailed t-distribution via Welch-style computation (no lib).
  - `compareStrategies(db, versionA, versionB)` — joins resolved trades with signals grouped by slug+tokenId; only markets evaluated by BOTH versions count; returns `{nPaired, brierA, brierB, meanDelta, tTest, winner}`.
- Math ≤ 40 lines. Hand-implement t-distribution CDF via series expansion, or use a well-known rational approximation. Acceptable because samples small, only need p-value resolution to ~0.001.
- 10+ tests covering edge cases: empty overlap, tie, clear winner, significance threshold.
- Commit.

### Task 5: CLI script
- `scripts/poly-strategy-compare.ts` — args `<versionA> <versionB> [lookbackDays]`; prints a human-readable block showing nPaired, Brier each, mean delta, p-value, winner-or-tie verdict.
- Manual-test against live DB (expect empty overlap, script exits cleanly).
- Commit.

### Task 6: Codex review
- `--commit HEAD` on each functional commit; triage findings; apply P1/P2; regress-test.
- Commit fixes.

### Task 7: Build + smoke + merge
- `npm run build`, `pm2 restart claudeclaw --update-env`, verify Phase C reinitializes cleanly with the new columns.
- Merge feature branch to main. Push. Delete branch.

---

## Acceptance criteria

- [ ] New `poly_signals` rows carry non-null `prompt_version` + `model`.
- [ ] Historical rows keep `NULL` — no data corruption.
- [ ] `npx tsx scripts/poly-strategy-compare.ts v3 v4` runs without throwing (empty overlap is expected output today).
- [ ] 15+ tests across migration + compare + engine; typecheck clean.
- [ ] Codex review pass; all P0/P1 applied.

## Risks + mitigations

1. **ALTER TABLE + WAL + running process.** The live bot writes to `poly_signals` continuously. `ALTER TABLE ADD COLUMN` is non-blocking on SQLite WAL, but I'll time it for a quiet moment (between scans). If a writer is active mid-ALTER, SQLite serializes — worst case 1s delay.
2. **Paired comparison with zero overlap (today).** All existing signals are `prompt_version=NULL`. Until we actually ship a v4 prompt and run both in parallel, compare script returns empty. Document this clearly; script's output says "no overlap — need dual-eval mode first" rather than crashing.
3. **Statistical power.** With ~24 signals/hour and most unresolved, a meaningful A/B takes weeks. Compare script shows n and p-value so we never draw conclusions from n=3.

## Out of scope (later sprints)

- **Dual-eval mode** (running v3 + v4 simultaneously for paired data) — Sprint 2.5.
- **Multi-armed bandit routing** — Sprint 7+.
- **Automated winner-adoption** (bot auto-switches strategies) — never without operator sign-off.
