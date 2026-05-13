# Resume prompt for next session (2026-05-13)

```
READ FIRST (in order):
  C:\Code\claudeclaw\TRUST.md
  C:\Code\claudeclaw\SOUL.md
  C:\Code\claudeclaw\MISSION.md
  C:\Code\claudeclaw\HEARTBEAT.md
  C:\Code\claudeclaw\CLAUDE.md
  C:\Code\claudeclaw\docs\plans\2026-05-12-real-money-gate-closure.md
  ~\.claude\projects\C--Code-claudeclaw\memory\MEMORY.md
  C:\Code\claudeclaw\HANDOFF.md  (top section: "2026-05-12 (evening) — regime-trader recovery, Sprint S2 ship + hotfix, Box 7 closed")

GROUND TRUTH SWEEP (run before any action):
  date
  cd C:\Code\claudeclaw && git log --oneline -12
  git status
  npm run status
  npm run trading:status
  pm2 list
  cat docs\codex-review\findings.md
  cd C:\Code\regime-trader && git fetch && git log --oneline -5
  cd C:\Code\claudeclaw && node -e "const D=require('better-sqlite3');const d=new D('C:/claudeclaw-store/claudeclaw.db',{readonly:true});console.log('sharpe:',JSON.stringify(d.prepare('SELECT instance,snapshot_date,equity,daily_return,rolling_sharpe_60d,n_days FROM regime_sharpe_snapshots ORDER BY created_at DESC LIMIT 4').all()));console.log('shadow:',JSON.stringify(d.prepare('SELECT scan_tick_at,candidates_total,candidates_ttl_pass,filtered_max,avg_ttl_pass,avg_ttl_filtered FROM poly_ttl_shadow_ticks ORDER BY scan_tick_at DESC LIMIT 4').all()));d.close();"

WHAT YOU INHERIT FROM 2026-05-12 EVENING SESSION

claudeclaw `main` at HEAD or near it. Sprint S2 fully shipped end-to-end:
- Migration v1.15.0 + v1.16.0 applied. Tables `regime_sharpe_snapshots`
  and `poly_ttl_shadow_ticks` exist.
- Cron `regime-sharpe-9a08` writing 2 rows daily at 17:00 CT.
  Day-2 row tomorrow (2026-05-13) writes the FIRST non-null
  daily_return. By session start tomorrow that row should be present.
- TTL shadow rows accumulating at scan cadence (~96/day at default
  15-min interval). First row showed 18/20 topN are long-dated
  (avg 205 days, vs 19 days for the [1,30]-day pass set). The
  comparison report due 2026-06-03 will run on ~14 days × ~96 ticks
  = ~1,344 tick rows.
- /trade sharpe Telegram command live.
- /poly-ttl-shadow-report.ts script live (read-only).
- 832/832 tests pass (Sprint S1 + Sprint S2 + S2 hotfix coverage).

Box state at 2026-05-12 evening close:
- Box 1: Day 21/30, target 2026-05-21 (calendar). A1 ACK landed in
  MISSION this session — operator-directed deploys are now
  unambiguously non-resetting. So this session's two pm2 restarts
  (S2 deploy + the previous S1 deploy yesterday) do not reset.
- Box 2: 0/50 resolved. Path A SHADOW running. S4 flag-flip
  eligibility 2026-06-05+ (Tier-3 operator-only).
- Box 3: Day 1/60, target 2026-07-11. Sharpe cron live.
- Box 4: Green.
- Box 5: Ackable (0 P0/P1 outstanding after S2 hotfix + codex pass).
- Box 6: Green (drilled 2026-05-09).
- Box 7: A1/A2/A3 all ACKed this session — **closed (3/3)**.
- Final real-money authorization line in MISSION still pending until
  Boxes 1–6 close.

regime-trader pm2 state:
- Both spy-agg and spy-cons were STOPPED at the previous session's
  resume time (silent mid-market exit at 13:25 CT). Restarted in
  the evening session; both gracefully exited via main.py's
  "Market is CLOSED → exit gracefully" path (intentional behavior).
- pm2 cron_restart `30 8 * * 1-5` should auto-start both at
  08:30 CT tomorrow. UNVERIFIED LIVE that pm2 cron_restart starts
  STOPPED processes (per pm2 docs it should). If they stay stopped
  past 08:35 CT, that's a new finding worth filing.
- The 13:25 CT mid-market exit remains UNEXPLAINED. Faulthandler
  did not fire. Most likely hypothesis: external `pm2 stop` from
  another shell. See docs/research/handoff-regime-trader-
  clean-exit-2026-05-12.md and the
  reference_regime_trader_market_closed_exit memory.

PRIORITY SEQUENCE FOR THIS SESSION

1. VERIFY tomorrow's 08:30 CT pm2 cron_restart fired and brought
   both regime-trader instances ONLINE. Check `pm2 list` and the
   first 5-min bar logs (08:35 CT). If they did NOT auto-start,
   restart manually and file the pm2 cron_restart-on-stopped finding.

2. VERIFY S1 day-2 Sharpe row landed at 17:00 CT yesterday with
   non-null daily_return (the FIRST real Sharpe data point of the
   60-day window). Query in the ground-truth sweep above.

3. VERIFY S2 shadow rows accumulating. Run
   `npx tsx scripts/poly-ttl-shadow-report.ts --days 1` to see
   yesterday's distribution. Expect ~96 ticks if claudeclaw-main
   stayed up overnight.

4. OPERATOR Q QUEUE — Q4, Q6, Q8 still PROPOSED. Q5 + Q7 were
   abandoned in the 2026-05-12 evening session (operator typed
   "KILL THIS" → operator selected Abort on the disambiguation
   prompt). Surface again ONLY if operator asks; otherwise leave.

5. SPRINT S3 watch period opens 2026-05-18. Bug 2 fresh-retrain
   verification window. No code action this session unless
   retrain fires early. pkl files dated 2026-05-11 13:53 CT;
   retrain_interval_days=7 hits 2026-05-18 13:53 CT.

6. SPRINT S5 (codex CLI repair) — optional fill. Outside the
   claudeclaw repo (~/.claude/scripts/codex-review.js). Three
   issues unfixed: (a) `-c model=gpt-5.5` Windows-shell quote
   stripping, (b) `--fast` path failure, (c) 18 malformed
   ~/.agents/skills/*/SKILL.md files at codex startup. Cleanest
   approach: refactor codex-review.js from execSync to spawnSync
   with args array (bypasses cmd.exe entirely).

7. SPRINT S2 SHADOW ACCUMULATION — passive. Just let it run.
   Comparison report due 2026-06-03. Nothing to do until then
   unless the operator asks for an interim snapshot.

REAL-MONEY GATE STATE (from MISSION.md 2026-05-12 evening)
  Box 1: Day 21/30, target 2026-05-21 (5 days to land tomorrow)
  Box 2: 0/50 resolved, S2 shadow running, S4 flag-flip
         eligibility 2026-06-05+. Target with Path A: ~2026-08-01
  Box 3: Day 2/60 (after today's 17:00 CT cron), target 2026-07-11
  Box 4: Green
  Box 5: Ackable (0 P0/P1)
  Box 6: Green (next quarterly re-drill due ~2026-08-09)
  Box 7: CLOSED 2026-05-12 evening (A1/A2/A3 acks)

HARD CONSTRAINTS (TRUST.md, unchanged)

- DO NOT edit src/poly/risk-gates.ts, paper-broker.ts,
  pnl-tracker.ts, strategy-engine.ts without operator chat
  approval. Tier 3.
- DO NOT flip POLY_REFLECTION_ENABLED, POLY_EXIT_ENABLED,
  POLY_EXPOSURE_AWARE_SIZING — A2 ACK 2026-05-12 made this
  explicit; needs ≥15-20 resolved trades AND operator nod.
- DO NOT change POLY_PAPER_CAPITAL, POLY_MAX_TRADE_USD,
  POLY_HALT_DD_PCT, POLY_MAX_MARKET_TTL_DAYS, POLY_MIN_MARKET_TTL_DAYS.
  The TTL band tuning specifically is now a Sprint S4 / Tier-3 surface.
- DO NOT push real-money. Period.
- DO NOT bypass the Sprint S2 14-day shadow window. The whole point
  is to gather 14 days of comparison data before the flag-flip.

OPERATING MODE (per 2026-05-12 operator directives, unchanged)

- Autonomous execution mode for Tier 1/2 work. Halt at hard Tier-3
  boundaries. ALSO: when operator gives ambiguous text input that
  could be a directive OR a literal answer, ASK to disambiguate
  before acting. Pattern from this session.
- Selection rule (per plan §5): a sprint ships only if it names
  which gate box it moves and by how much. No infrastructure
  ratchet. Sprints depending on a PROPOSED operator item stay on
  the freeze list until that item resolves.
- Use parallel sub-agents for independent slices. File-ownership
  conflict check is mandatory before spawning ≥2 parallel agents.
- Verify subagent claims independently (Glob + Read).
- Friday retro at 16:00 CT (operator + bot): 15 min review of which
  gate moved this week. Bot fires Telegram alert if any gate has
  not advanced in 7 days. (Automation NOT yet built.)

ANTI-PATTERN GUARDS (lessons codified)

- Before working on a sibling repo (regime-trader): always
  `git fetch && git log --oneline origin/main..main` first.
- Subagent claims need independent verification.
- Don't trust warm-running logs as evidence about startup-path bugs.
- Build mode means execute, not ask. Do not interrupt sub-phases
  with approval gates if the work is inside the authorized envelope.
- A sprint with no gate-box tie should not ship as "feat". Re-tag
  as `[chore]` if pure infra.
- regime-trader's "Market is CLOSED → exit gracefully" path in
  main.py is INTENTIONAL behavior, NOT Bug 2. When seeing a
  clean exit_code=0 with the "Next open" log line, do not
  diagnose Bug 2.
- Before pm2 restart of claudeclaw, name the gate box that
  justifies it. A1 PERMISSIVE covers operator-directed deploys
  but does not cover speculative restarts.
- When in doubt about user intent, ASK once (AskUserQuestion or
  plain text). The cost of the round-trip is always less than
  the cost of a misinterpreted action.

Stay in trader-voice. No em dashes. No sycophancy. Push back on
anything that weakens a risk gate or lobbies for gate relaxation.
```
