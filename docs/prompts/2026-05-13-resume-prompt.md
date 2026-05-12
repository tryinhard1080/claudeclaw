# Resume prompt — 2026-05-13 (next session after 2026-05-12 wrap)

> Paste the **fenced section below** as the opening prompt of the next session.

```
READ FIRST (in order):
  C:\Code\claudeclaw\TRUST.md
  C:\Code\claudeclaw\SOUL.md
  C:\Code\claudeclaw\MISSION.md
  C:\Code\claudeclaw\HEARTBEAT.md
  C:\Code\claudeclaw\CLAUDE.md
  C:\Code\claudeclaw\docs\plans\2026-05-12-real-money-gate-closure.md
  ~\.claude\projects\C--Code-claudeclaw\memory\MEMORY.md
  C:\Code\claudeclaw\HANDOFF.md  (top section: "2026-05-12 — Plan, Path A lock, codex review, Sprint S1 ship, codex wrapper hardening")

GROUND TRUTH SWEEP (run before any action):
  date
  cd C:\Code\claudeclaw && git log --oneline -12
  git status
  npm run status
  npm run trading:status
  pm2 list
  cat docs\codex-review\findings.md
  cd C:\Code\regime-trader && git fetch && git log --oneline -5
  cd C:\Code\claudeclaw && node -e "const D=require('better-sqlite3');const d=new D('C:/claudeclaw-store/claudeclaw.db',{readonly:true});console.log(d.prepare('SELECT instance,snapshot_date,equity,daily_return,rolling_sharpe_60d,n_days FROM regime_sharpe_snapshots ORDER BY created_at DESC LIMIT 8').all());d.close();"

WHAT YOU INHERIT FROM 2026-05-12 SESSION

claudeclaw `main` at HEAD or near it (11 commits shipped 2026-05-12):
  + session-wrap (this HANDOFF + this resume prompt)
  734c317 feat(trading): Sprint S1 ship — Box-3 Sharpe instrumentation end-to-end
  b2419f8 feat(trading): Sprint S1 part 1 — sharpe.ts pure functions
  8a2802d [chore] research: Sprint S1 Sharpe scope + audit
  f5abff2 [chore] docs(codex-review): 2026-05-12 full-project review + findings
  dc8f926 [hotfix] fix(telegram): /trade auth guard + renderPnl include 'exited'
  5c2bd2c [chore] mission: Path A authorized for Box 2 by operator
  5282840 [chore] plan: 2026-05-12 real-money gate closure path
  03f717e [chore] mission: Box-3 60-day clock starts 2026-05-12
  d220fe2 [chore] docs: close Sprint 27 codex entry; mark checklist item 8 done
  2553972 [audit] docs: finance MCP vendor catalog (operator-authored)

Sprint S1 (Sharpe instrumentation) is fully live:
- Migration v1.15.0 applied. Table `regime_sharpe_snapshots` exists.
- Cron `regime-sharpe-9a08` active, fires 17:00 CT weekdays.
- Day-1 row written 2026-05-12. Yesterday's 17:00 CT auto-fire should
  have refreshed it. Today (2026-05-13) at 17:00 CT writes the FIRST
  row with non-null daily_return.
- /trade sharpe Telegram command live.
- npm run trading:status shows `regime-sharpe` row (WARN until n_days>=1).
- Tests 813/813 pass.

Box state at 2026-05-12 close (Day 1/60 on Box 3, Day 22/30 on Box 1):
- Box 1: Day 22/30, target 2026-05-21 (calendar)
- Box 2: 0/50 resolved. Path A authorized; Sprint S2 not yet built.
- Box 3: Day 1/60, target 2026-07-11. Instrumentation live.
- Box 4/5/6: Green
- Box 7: 3 acks PROPOSED since 2026-04-21 (A1/A2/A3 still need operator)

Codex CLI wrapper hardened but partially broken (see HANDOFF for full
list). What works: `-` positional removed, raw-output logging to
~/.claude/cache/codex-review/, --full-auto → --sandbox workspace-write
in full mode. What still breaks: `-c model=gpt-5.5` Windows-shell
quote stripping, --fast path, 18 malformed ~/.agents/skills/*/SKILL.md
files cause codex startup load errors. Sprint S5 candidate.

regime-trader observations (file for the sibling repo, not blocking):
- Both spy-aggressive and spy-cons share one Alpaca paper account
  (state.json shows identical equity). Box 3 effectively measures ONE
  Sharpe signal across both instances.
- Signal-direction anomaly: bot emits LONG when target < current,
  should emit SELL to rebalance down. Risk gate correctly rejects;
  no trades fired wrong. Filed for regime-trader.

PRIORITY SEQUENCE FOR THIS SESSION

1. VERIFY S1 IS PRODUCING REAL DATA. Run the ground-truth DB query
   above. Confirm 2026-05-13 row(s) exist with non-null daily_return.
   If 17:00 CT cron has not yet fired (you're starting before 17:00 CT),
   confirm 2026-05-12 row was REFRESHED by yesterday's auto-fire (its
   created_at timestamp should be 2026-05-12 17:00 CT-ish, not the
   manual 2026-05-12 12:01 CT run).
2. SPRINT S2 — TTL filter shadow mode for Box 2. Path A authorized
   2026-05-12 (see MISSION sign-off log). Spec is in
   docs/plans/2026-05-12-real-money-gate-closure.md §6 Sprint S2.
   Build discipline applies: existing-code audit first, research note
   at docs/research/sprint-s2-ttl-filter-shadow.md, plan + TDD + ship.
   Ship by 2026-05-20 per plan. Per Build Mode (your inherited memory),
   execute end-to-end through Tier 1/2 without sub-phase approval gates;
   only halt at hard Tier-3 boundaries (risk-gates, paper-broker,
   strategy parameter flips, real-money). For S2 the Tier-3 boundary
   is the eventual flag-flip from shadow→active AFTER 14 days of
   shadow data — that's Sprint S4 and stays operator-only.
3. SPRINT S3 watch — Bug 2 fresh-retrain verification window opens
   2026-05-18 (5 days from today). pkl files dated 2026-05-11 13:53
   so retrain_interval_days=7 hits 2026-05-18. Watch regime-trader
   pm2 logs around that date for the instrumented BIC trace.
   No code action this session unless retrain fires early.
4. OPERATOR Q QUEUE — docs/handoff/2026-05-11-operator-action-checklist.md.
   7 of 9 items still PROPOSED. Item 8 done, Q9 (Path A) decided.
   Surface in a clean copy-paste block if operator hasn't worked
   through them. Do NOT act on Tier-3 items autonomously.
5. CODEX WRAPPER SPRINT S5 (optional fill if S2 ships fast) — fix
   the three remaining codex 0.130.0 incompatibilities. The cleanest
   approach is probably to refactor codex-review.js to use spawnSync
   with args array instead of execSync with shell string, bypassing
   Windows cmd.exe quote-handling entirely. Then triage the 18
   malformed ~/.agents/skills/*/SKILL.md files.

REAL-MONEY GATE STATE (from MISSION.md 2026-05-12 entries)
  Box 1: Day 22/30, target 2026-05-21 (9 days to land)
  Box 2: 0/50 resolved, Path A flag-flip eligible 2026-06-05+
         (after 14-day shadow). Target real-money date with Path A
         working: ~2026-08-01 per plan
  Box 3: Day 2/60 (after today's 17:00 CT cron fires), target 2026-07-11
  Box 4: Green
  Box 5: Ackable (zero P0/P1 after dc8f926)
  Box 6: Green (drilled 2026-05-09, next quarterly re-drill due)
  Box 7: A1/A2/A3 still PROPOSED since 2026-04-21

HARD CONSTRAINTS (TRUST.md, unchanged):

- DO NOT edit src/poly/risk-gates.ts, paper-broker.ts, pnl-tracker.ts,
  strategy-engine.ts without operator chat approval. Tier 3.
- DO NOT flip POLY_REFLECTION_ENABLED, POLY_EXIT_ENABLED,
  POLY_EXPOSURE_AWARE_SIZING. Gated on >=15-20 resolved trades; you
  have 0.
- DO NOT change POLY_PAPER_CAPITAL, POLY_MAX_TRADE_USD,
  POLY_HALT_DD_PCT or any monetary risk param.
- DO NOT push real-money. Period.
- DO NOT bypass the Sprint S2 shadow window. The whole point of
  shadow-first is to gather 14 days of comparison data before the
  flag-flip. Honor it.

OPERATING MODE (per 2026-05-12 operator directives):

- Autonomous execution mode. The operator does not want checkpoints
  on every code turn. Execute end-to-end through Tier 1/2 without
  sub-phase approval gates; only halt at hard Tier-3 boundaries.
- Selection rule (per plan §5): a sprint ships only if it names
  which gate box it moves and by how much. No infrastructure
  ratchet. Sprints that depend on a PROPOSED operator item stay
  on the freeze list until that item resolves.
- Use parallel sub-agents for independent slices. File-ownership
  conflict check is mandatory before spawning >=2 parallel agents.
- Verify subagent claims independently. "Agent says it wrote X"
  requires Glob+Read confirmation. This pattern has burned weeks.
- Friday retro at 16:00 CT (operator + bot): 15 min review of which
  gate moved this week and what's still PROPOSED. Bot fires a
  Telegram alert with the cost-of-delay summary if any gate has
  not advanced in 7 days. (This automation is NOT yet built; design
  in S1.5 candidate or alongside S2.)

ANTI-PATTERN GUARDS (lessons from this week, codified):

- Before working on a sibling repo (regime-trader): always
  `git fetch && git log --oneline origin/main..main` first.
- Subagent claims need independent verification. Glob + Read the
  file paths they say they wrote BEFORE relaying success upward.
- Don't trust warm-running logs as evidence about startup-path bugs.
- Build mode means execute, not ask. Do not interrupt sub-phases
  with approval gates if the work is inside the authorized envelope.
- A sprint with no gate-box tie should not ship as "feat". Re-tag
  as `[chore]` if it's pure infra; or scope it to land alongside
  a gate-moving sprint.

Stay in trader-voice. No em dashes. No sycophancy. Push back on
anything that weakens a risk gate or lobbies for gate relaxation.
```
