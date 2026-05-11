# Next session resume prompt — 2026-05-12

Copy-paste into the next Claude Code session at C:\Code\claudeclaw.

---

Resume ClaudeClaw + regime-trader operational readiness.

READ FIRST (in order):
  C:\Code\claudeclaw\TRUST.md
  C:\Code\claudeclaw\SOUL.md
  C:\Code\claudeclaw\MISSION.md
  C:\Code\claudeclaw\HEARTBEAT.md
  C:\Code\claudeclaw\CLAUDE.md
  ~\.claude\projects\C--Code-claudeclaw\memory\MEMORY.md
  ~\.claude\projects\C--Code-claudeclaw\memory\project_2026-05-11_session_close.md
  C:\Code\claudeclaw\HANDOFF.md  (top section: "2026-05-11 afternoon — Sprint 27 ship + hygiene")

GROUND TRUTH SWEEP (run before any action):
  date
  cd C:\Code\claudeclaw && git log --oneline -10
  git status
  npm run status
  npm run trading:status
  pm2 list
  cat docs\codex-review\findings.md
  cd C:\Code\regime-trader && git fetch && git log --oneline -5

WHAT YOU INHERIT FROM 2026-05-11 AFTERNOON SESSION

claudeclaw `main` ahead at 5 fresh commits pushed 2026-05-11:
  25089cc [chore] docs: HANDOFF entry for 2026-05-11 afternoon
  e40955c feat(poly): Sprint 27 — open-trade slug priority + coverage alarm
  18ce57b [chore] docs: forensic 10-K veto-filter handoff to regime-trader
  9ee256c [chore] gitignore: add .env*.bak
  6affa57 [hotfix] pm2 cron fires at 09:30 ET (08:30 CT), not 10:30 ET
  fb48f5c [hotfix] include 'exited' in buildPortfolioSnapshot realized P&L sum (codex P1 fix)

regime-trader `main` ahead at 1 fresh commit pushed 2026-05-11:
  e8c6b59 diag(bug2): faulthandler + BIC-loop tracing for silent-exit diagnosis

Sprint 27 details:
  - src/poly/resolution-coverage.ts (new module, 4 pure helpers)
  - src/poly/resolution-coverage.test.ts (26 new tests)
  - scripts/fetch-resolutions.ts modified to prioritize open-trade slugs
  - poly_kv-backed history under key 'poly.coverage.history' (last 5)
  - [coverage-alarm] stderr line fires after 2 consecutive cycles <80%
  - 759/759 tests pass (was 733). No new migration. No Tier-3 surface touched.
  - Codex review on e40955c: <PASTE RESULT HERE FROM PRIOR SESSION>

Bug 2 diagnostic instrumentation (regime-trader e8c6b59):
  - main.py: faulthandler.enable() at module top — catches segfaults
  - core/hmm_engine.py fit(): per-iteration "BIC search: trying n_components=N"
    log lines, logger.exception() instead of logger.warning() in except.
  - 144 passed + 10 skipped on pytest. No algorithm change.

regime-trader pm2 instances still STOPPED at session close.
claudeclaw-main online, restart count 7, healthy.

PRIORITY SEQUENCE FOR TOMORROW MORNING

1. FOREGROUND DEBUG REGIME-TRADER (do this during market hours,
   08:30-15:00 CT, Mon-Fri):
       cd C:\Code\regime-trader
       git pull
       .venv\Scripts\python.exe main.py --paper --instance spy-aggressive
   With Bug 2 instrumentation in place, you will now see one of:
   - (a) "BIC search: trying n_components=5" then SEGV traceback from
     faulthandler → that's the smoking gun. Fix by capping n_components_range
     in instances/spy-*/settings.yaml to [3, 4] (config-only, low blast radius)
     OR by upgrading/downgrading hmmlearn pin in pyproject.toml / requirements.
   - (b) "BIC search: trying n_components=5" then a Python traceback from
     logger.exception → that's an uncaught error elsewhere; address per the
     stack trace.
   - (c) "BIC search: trying n_components=5" then full BIC completes and
     "Selected N-state model" prints + "Paper trading started" appears →
     Bug 2 is intermittent or env-specific; capture the timestamped fresh-
     startup log and operator decides next move.
   - (d) Silent exit BEFORE "BIC search: trying n_components=5" log line →
     the bug is upstream of the BIC loop (feature engineering, data fetch,
     or HMM constructor); reread main.py startup flow to find it.

2. IF (a) IS THE CASE — config-only fix:
       Edit instances/spy-aggressive/settings.yaml and
       instances/spy-conservative/settings.yaml:
         hmm:
           n_components_range: [3, 4]
       Commit + push. pm2 start regime-trader-spy-agg regime-trader-spy-cons.
       Watchman is foreground proof + first real prediction log line.

3. ONCE PREDICTIONS ARE LIVE — start Box-3 60-day clock annotation in
   MISSION.md. Earliest gate eligibility: today + 60 days = 2026-07-10.

4. OPERATOR-ACTION QUEUE — docs/handoff/2026-05-11-operator-action-
   checklist.md. 8 Tier-3 items unchanged from morning of 2026-05-11.

5. CODEX REVIEW ON SPRINT 27 — <STATUS FROM PRIOR SESSION>. If a finding
   landed P0/P1, fix before any new sprint starts. Otherwise note as
   closed in docs/codex-review/findings.md.

REAL-MONEY GATE STATE (from MISSION.md)
  Box 1 — Day 21/30, target 2026-05-21
  Box 2 — 0/50 resolved, Q4 2026 projection (STRUCTURAL — operator
          decision needed: accept longer Box-2 clock or change strategy
          toward shorter-dated markets)
  Box 3 — Cannot start until regime-trader producing real predictions
  Box 4 — Green
  Box 5 — Ackable after codex P1 fix in fb48f5c + Sprint 27 codex pass
  Box 6 — Green (drilled 2026-05-09 + halt path intact today)
  Box 7 — Awaiting operator A1/A2/A3 acks

HARD CONSTRAINTS (TRUST.md):
  - DO NOT edit src/poly/risk-gates.ts, paper-broker.ts, pnl-tracker.ts,
    strategy-engine.ts without operator chat approval. Tier 3.
  - DO NOT flip POLY_REFLECTION_ENABLED, POLY_EXIT_ENABLED,
    POLY_EXPOSURE_AWARE_SIZING. Gated on >=15-20 resolved trades; you have 0.
  - DO NOT change POLY_PAPER_CAPITAL, POLY_MAX_TRADE_USD, POLY_HALT_DD_PCT
    or any monetary risk param.
  - DO NOT push real-money. Period.

ANTI-PATTERN GUARDS (lessons from 2026-05-11):
  - Before working on a sibling repo (regime-trader): always
    `git fetch && git log --oneline origin/main..main` first to surface
    any parallel work and avoid duplicate commits.
  - Don't trust warm-running logs as evidence about startup-path bugs.
    Only fresh-startup logs prove or disprove startup behavior.
  - Subagent claims need independent verification (npm test, git diff,
    read the diff yourself).
  - Build mode — execute, don't ask permission inside scope. When the
    operator says "build it" / "use your best judgement", run end-to-end
    through Tier 1/2 without sub-phase approval gates; only halt at hard
    Tier-3 boundaries.

Stay in trader-voice. No em dashes. No sycophancy. Push back on anything
that weakens a risk gate or lobbies for gate relaxation.
