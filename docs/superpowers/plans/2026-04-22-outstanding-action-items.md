# Outstanding Action Items — ClaudeClaw 2026-04-22

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining real-money-gate blockers and run the operator runbook that has been pending since plan cheerful-rossum shipped (2026-04-21 evening).

**Architecture:** Mix of operator-required actions (env edits, sign-offs, drill outputs) and Claude-executable actions (codex review, status verification). Operator actions are clearly labeled — Claude cannot complete those steps, only verify them afterward.

**Tech Stack:** pm2, TypeScript/tsx, SQLite (claudeclaw.db), Polymarket paper broker, MISSION.md sign-off log.

---

## Gate Status Entering This Session

| Box | Status | Blocker |
|-----|--------|---------|
| 1. 30-day no-intervention | Day 1/30 (clock: 2026-05-21) | Time only |
| 2. ≥50 resolved trades, positive P&L | 0/50 | Market activity |
| 3. regime-trader Sharpe ≥60d | Pending fetch-window fix | Different repo |
| 4. Drawdown ≤ POLY_HALT_DD_PCT | **Green** | — |
| 5. No P0/P1 codex findings | **BLOCKED** | Codex review Sprint 12-19 |
| 6. Kill-switch procedure tested | **BLOCKED** | Operator runbook steps 7-9 |
| 7. Operator written sign-off | **BLOCKED** | A1-A3 PROPOSED acks in MISSION.md |

---

## Task 1: Verify Current Bot Health Before Touching Anything

**Actor:** Claude
**Files:** none (read-only)
**Rationale:** Rule 1 of CLAUDE.md — processes before logic. Confirm bot is still online from last session.

- [ ] **Step 1.1: Check pm2 status**

```bash
rtk pm2 list
```

Expected: claudeclaw id 8, space-agent id 10, both `online`. If claudeclaw is `errored` or `stopped`, diagnose before proceeding — do NOT restart blindly.

- [ ] **Step 1.2: Tail recent logs**

```bash
rtk pm2 logs claudeclaw --lines 20 --nostream
```

Expected: scan_complete events within last 5 minutes. If last event is >30 minutes old, check heartbeat alert history in Telegram.

- [ ] **Step 1.3: Verify runbook scripts exist**

```bash
ls src/scripts/ 2>/dev/null; ls scripts/ | grep -E "activate|drill|news-sync|db-backup"
```

Expected: `activate-news-sync.ts`, `activate-db-backup.ts`, `news-sync.ts`, `db-backup.ts`, `drill-halt-resume.ts`, `drill-db-restore.ts` all present.

- [ ] **Step 1.4: Check migration state**

```bash
cat store/claudeclaw.db 2>/dev/null | head -1 || sqlite3 /c/claudeclaw-store/claudeclaw.db "SELECT version FROM applied_migrations ORDER BY applied_at DESC LIMIT 3;" 2>/dev/null || npx tsx scripts/audit-schema.ts 2>/dev/null | head -10
```

Expected: v1.12.0 is the latest applied; v1.13.0 migration (news_items table) is PENDING because PPLX_API_KEY is not yet set.

---

## Task 2: Operator Runbook — Environment Variables

**Actor:** OPERATOR (Richard) — Claude cannot do this
**Estimated time:** 3 minutes
**Blocks:** v1.13.0 migration, news-sync cron, kill-phrase drill

The following two values must be added to `.env` before the single Phase B restart. Do them together so the bot only restarts once.

- [ ] **Step 2.1: Add EMERGENCY_KILL_PHRASE (operator)**

```bash
# Pick a non-obvious passphrase. Example format: three random words + number.
# Record it somewhere safe (not in this repo).
echo 'EMERGENCY_KILL_PHRASE=<your-passphrase-here>' >> .env
```

Verify: `grep EMERGENCY_KILL_PHRASE .env` should return exactly one non-empty line.

- [ ] **Step 2.2: Add PPLX_API_KEY (operator)**

```bash
# Get key from https://perplexity.ai/account/api/keys
echo 'PPLX_API_KEY=pplx-<your-key-here>' >> .env
```

Verify: `grep PPLX_API_KEY .env` should return exactly one non-empty `pplx-...` value.

- [ ] **Step 2.3: Confirm both are present before restart**

```bash
grep -c "^EMERGENCY_KILL_PHRASE=.\+" .env && grep -c "^PPLX_API_KEY=pplx-" .env
```

Expected: `1` then `1`. If either is `0`, recheck step 2.1/2.2 before continuing.

---

## Task 3: Phase B Restart (Single pm2 Restart)

**Actor:** OPERATOR — this is a Tier 3 action (restarts production process)
**Blocks:** v1.13.0 migration, news-sync/db-backup cron activation
**Rationale:** One restart picks up both new .env values AND runs the pending v1.13.0 migration that adds the news_items table.

- [ ] **Step 3.1: Stop service before restart (Rule 2 — stop before config edit)**

This step is already done (restart handles it). Just confirm no pending writes:

```bash
rtk pm2 logs claudeclaw --lines 5 --nostream
```

Expected: no active scan in progress (scan_complete should be the last event, not scan_start).

- [ ] **Step 3.2: Single pm2 restart (operator)**

```bash
pm2 restart claudeclaw
```

- [ ] **Step 3.3: Verify restart + migration (Claude verifies)**

```bash
rtk pm2 logs claudeclaw --lines 40 --nostream
```

Expected in output:
- Restart count increments from 12 → 13
- Migration log line: `[migrate] applying v1.13.0` (news_items table)
- `Polymarket module initialized` (Phase C: scanner + strategy + pnl tracker)
- No `PPLX_API_KEY` missing errors
- No `EMERGENCY_KILL_PHRASE` missing errors

If migration error appears, report exact error message before proceeding.

---

## Task 4: Activate Crons + Smoke Tests

**Actor:** Claude (operator has confirmed restart in Task 3)
**Blocks:** gate box 6 drill readiness, news-sync health, db-backup health

- [ ] **Step 4.1: Activate news-sync cron**

```bash
npx tsx scripts/activate-news-sync.ts
```

Expected: `[activate-news-sync] ok — task 3d623e0e set active, kind=shell`

- [ ] **Step 4.2: Activate db-backup cron**

```bash
npx tsx scripts/activate-db-backup.ts
```

Expected: `[activate-db-backup] ok — task <id> set active, kind=shell`

- [ ] **Step 4.3: Smoke test news-sync**

```bash
npx tsx scripts/news-sync.ts
```

Expected: `[news-sync] ok (inserted N items from M feeds)` or similar. If PPLX quota error: check key validity at perplexity.ai/account/api/keys.

- [ ] **Step 4.4: Smoke test db-backup**

```bash
npx tsx scripts/db-backup.ts
```

Expected: `[db-backup] ok /c/claudeclaw-store/backup-YYYY-MM-DD/` with today's date. Verify the directory was created:

```bash
ls /c/claudeclaw-store/ | grep backup
```

---

## Task 5: Gate Box 6 — Drill C10 (Halt + Resume)

**Actor:** Claude runs script; operator pastes sign-off block
**Blocks:** Gate box 6 closure

- [ ] **Step 5.1: Run halt+resume drill**

```bash
npx tsx scripts/drill-halt-resume.ts
```

Expected output terminates with:
```
=== DRILL OK ===
[paste this block under MISSION sign-off log]
...sign-off text...
```

If `DRILL FAIL` appears instead, report the error before continuing.

- [ ] **Step 5.2: Paste drill sign-off into MISSION.md (operator)**

Copy the full `=== DRILL OK ===` block from step 5.1 output and append it to the `## Operator Sign-Off Log` section in `MISSION.md`:

```
- _2026-04-22_ — DRILL C10 halt+resume: [paste output here]
```

- [ ] **Step 5.3: Verify bot still online after drill**

```bash
rtk pm2 list
```

Expected: claudeclaw still `online` (drill is non-destructive — should not have restarted the bot).

---

## Task 6: Gate Box 6 — Drill C11 (DB Restore)

**Actor:** Claude runs script; operator pastes sign-off block
**Blocks:** Gate box 6 closure

- [ ] **Step 6.1: Run DB-restore drill**

```bash
npx tsx scripts/drill-db-restore.ts
```

Expected output terminates with:
```
=== DRILL OK ===
[paste this block under MISSION sign-off log]
...sign-off text...
```

Drill runs against `/tmp` scratch — does NOT touch production DB. Safe to run while bot is online.

- [ ] **Step 6.2: Paste drill sign-off into MISSION.md (operator)**

Append to `## Operator Sign-Off Log`:

```
- _2026-04-22_ — DRILL C11 DB-restore: [paste output here]
```

After C10 + C11 sign-offs are pasted, **gate box 6 is closed** (procedure documented + drilled).

---

## Task 7: Gate Box 7 — MISSION.md A1-A3 Operator Acks

**Actor:** OPERATOR — decisions only Richard can make
**Blocks:** Gate box 7 closure

Three PROPOSED entries in MISSION.md are waiting for operator ack. Read each and either accept (strike "PROPOSED", sign) or override with alternative reasoning.

- [ ] **Step 7.1: Ack A1 — Gate-clock permissive reading (operator)**

In `MISSION.md` under `### Phase A decisions for plan cheerful-rossum`, change:

```
- _2026-04-21 PROPOSED_ — **A1. Gate-clock reading: PERMISSIVE.** ...
```

to:

```
- _2026-04-21_ — **A1. Gate-clock reading: PERMISSIVE.** ... **Operator ACK: Richard, 2026-04-22.**
```

Or override if you prefer a different reading (e.g., reset clock to today).

- [ ] **Step 7.2: Ack A2 — Flag-enable defer (operator)**

Similarly strike PROPOSED from A2 and add ack, OR specify which flags you want enabled now.

- [ ] **Step 7.3: Ack A3 — Adversarial-review auth defer (operator)**

Similarly strike PROPOSED from A3 and add ack.

- [ ] **Step 7.4: Commit MISSION.md acks**

```bash
rtk git add MISSION.md
rtk git commit -m "docs(mission): operator acks A1-A3 + drill C10/C11 sign-offs"
```

---

## Task 8: Codex Review — Sprints 12-19 (Gate Box 5)

**Actor:** Claude
**Blocks:** Gate box 5 closure
**Scope:** Sprints 12-19 = positions-view, dashboard-charts, signals-recent, calibration/drift endpoints, /poly halt, auto-halt on drawdown, news-sync revival, db-backup.

- [ ] **Step 8.1: Run codex review on changed files**

Use the `code-review:code-review` skill or equivalent to review the Sprint 12-19 surface:

Key files to review:
- `src/poly/positions-view.ts` (Sprint 12 — unrealized P&L join)
- `src/dashboard-charts.ts` (Sprint 13 — SVG bar primitives)
- `src/dashboard.ts` (Sprints 12-15 — 4 new routes)
- `src/dashboard-html.ts` (Sprints 12-15 — client-side fetch logic)
- `src/poly/telegram-commands.ts` (Sprint 16 — /poly halt + /poly resume)
- `src/poly/risk-gates.ts` (Sprint 17 — auto-halt on drawdown)
- `src/poly/news-sync.ts` or `scripts/news-sync.ts` (Sprint 18)
- `scripts/db-backup.ts` (Sprint 19)

Focus areas: risk logic correctness (Sprints 16-17 are execution-side), SQL injection / DB correctness, data integrity under concurrent writes.

- [ ] **Step 8.2: Triage findings**

For each finding:
- P0 (data loss / real-money risk): block gate, fix immediately
- P1 (behavioral bug): fix before enabling real money
- P2/P3 (advisory): log in `docs/codex-review/` for later sprints

- [ ] **Step 8.3: Apply any P0/P1 fixes**

Each fix: failing test → implementation → passing test → commit with `fix(poly):` prefix.

- [ ] **Step 8.4: Log review results**

Create or update `docs/codex-review/sprints-12-19-2026-04-22.md` with findings + disposition. If no P0/P1 found, **gate box 5 is closed**.

---

## Task 9: Iran Position Resolution Verification

**Actor:** Claude (monitoring, read-only)
**Timing:** Tonight after 2026-04-22 EOD (market `us-x-iran-diplomatic-meeting-by-april-22-2026` expires today)
**Rationale:** First real test of the resolution → PnlTracker → sparkline pipeline end-to-end.

- [ ] **Step 9.1: Check if resolution has hit the DB**

```bash
sqlite3 /c/claudeclaw-store/claudeclaw.db "SELECT slug, outcome_label, status, realized_pnl, updated_at FROM poly_paper_trades WHERE slug LIKE '%iran%' ORDER BY updated_at DESC LIMIT 5;"
```

Expected after resolution: `status='lost'`, `realized_pnl` is a negative number, row present in `poly_resolutions`.

- [ ] **Step 9.2: Check sparkline endpoint**

```bash
curl -s "http://localhost:3141/api/poly/pnl/chart?token=$(grep DASHBOARD_TOKEN .env | cut -d= -f2)" | head -20
```

Expected: SVG content with at least one bar (the Iran loss bar). Previously returned placeholder text.

- [ ] **Step 9.3: Verify PnlTracker deleted position row**

```bash
sqlite3 /c/claudeclaw-store/claudeclaw.db "SELECT COUNT(*) FROM poly_positions WHERE slug LIKE '%iran%';"
```

Expected: `0` (position row removed on resolution).

If any step shows the resolution hasn't hit yet, check back after the Sunday 2026-04-26 resolution-fetch cron (07:00 ET). The cron is the authoritative settlement path.

---

## Task 10: Update Handoff + Gate Scorecard

**Actor:** Claude
**Timing:** After Tasks 1-9 are complete

- [ ] **Step 10.1: Update gate scorecard in HANDOFF.md**

Update the `### Real-money-gate progress` table:

| Box | New Status |
|-----|-----------|
| 5 | Closed (if no P0/P1 found) or "P1 fix pending" |
| 6 | Closed (drills C10 + C11 signed off) |
| 7 | Closed (A1-A3 acked) |

- [ ] **Step 10.2: Write session wrap entry**

Append a new `## ✅ 2026-04-22 — Operator Runbook + Gate Closure` section summarizing:
- Which gate boxes closed this session
- Drill outputs
- Iran resolution status
- Next milestone: Sun 2026-04-26 first calibration batch

- [ ] **Step 10.3: Commit**

```bash
rtk git add HANDOFF.md
rtk git commit -m "docs: 2026-04-22 session wrap — runbook complete, gates 5/6/7 status"
```

---

## Execution Order

```
Task 1 (health check)           — Claude, RIGHT NOW
Task 2 (env vars)               — Operator, ~3 min
Task 3 (pm2 restart)            — Operator, ~2 min
Task 4 (cron activation)        — Claude, after restart
Task 5 (Drill C10)              — Claude + Operator, ~3 min
Task 6 (Drill C11)              — Claude + Operator, ~3 min
Task 7 (A1-A3 acks)             — Operator, ~5 min (reading + deciding)
Task 8 (Codex review)           — Claude, ~30-60 min
Task 9 (Iran resolution check)  — Claude, tonight / async
Task 10 (Handoff wrap)          — Claude, after Tasks 5-8 done
```

## What Remains After This Plan

- **Box 1**: Time (30-day clock, target 2026-05-21)
- **Box 2**: Market activity (≥50 resolved trades — first batch Sun 2026-04-26)
- **Box 3**: regime-trader fetch-window extension + 60-day Sharpe (separate repo sprint)
- **Sprint 2.5/8/9 flag-enable**: Defer until calibration data exists post-2026-04-26

Real-money evaluation earliest: **2026-05-21** (box 1) + calibration data from late April/May.
