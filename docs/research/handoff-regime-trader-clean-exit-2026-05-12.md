# Handoff to regime-trader: silent clean-exit at 13:25 CT 2026-05-12

**For:** `C:\Code\regime-trader` maintainer.
**From:** claudeclaw-main session 2026-05-12 17:36 CT.
**Severity:** Medium. Both paper instances stopped silently mid-market; Box-3 60-day Sharpe clock measures passive equity drift instead of strategy activity for any window where the bot is down. Not a code-edit ask in claudeclaw.

## What happened

| Time (CT) | Event |
|---|---|
| 08:30 | pm2 `cron_restart: '30 8 * * 1-5'` fires (Bug 1 fix `6affa57` confirmed working). Both `regime-trader-spy-agg` and `regime-trader-spy-cons` start. |
| 08:35 | First 5-min bar. Both produce `Signal: SPY LONG ... regime=WEAK_BULL conf=1.00 rebal=True`. Both correctly rejected by `Max total exposure reached` (existing 120-share SPY position fills the cap). |
| 08:35 → 13:25 | Bot loop runs cleanly. 5-min bars every five minutes. Every signal logged + rejected for the same exposure-cap reason. State.json refreshes. No errors visible in stderr/stdout. |
| ~13:25 | **Bot exits cleanly.** PM2 records `exit_code=0`, `unstable_restarts=0`, `restart_time=2`. No traceback. No `[!] HMM error` near the exit. Last log line is the routine `Signal rejected: Max total exposure reached`. |
| 13:25 → 16:18 | Both instances STOPPED. PM2 cron_restart only fires for running processes (or cron events scheduled for already-running apps), so no auto-recovery. |
| 16:18 | claudeclaw operator notices stopped state during session resume. |
| 17:33 | Operator-directed `pm2 start regime-trader-spy-agg && pm2 start regime-trader-spy-cons`. Both connect to Alpaca: `equity=$103495.64 cash=$14930.84 status=ACTIVE`. |
| 17:33 | Both immediately exit gracefully: `Market is CLOSED. Next open: 2026-05-13 09:30:00-04:00. Exiting gracefully.` Expected behavior of `main.py`'s post-close exit path. PM2 `exit_code=0`. |
| 17:00 (independent path) | Box-3 Sharpe cron `regime-sharpe-9a08` fired exactly on schedule and wrote two rows: `equity=$103,259.24 daily_return=null n_days=0` for both instances. Independent of regime-trader running because it reads the Alpaca account directly. |

## Evidence

- `pm2 jlist` post-restart: both instances `pid=0 status=stopped restart=2 unstable=0 exit=0`.
- `pm2 logs regime-trader-spy-agg --err --nostream --lines 60` last entries before the gap:
  ```
  13:25:01 [INFO] core.regime_strategies: vol_rank=0.33 conf=1.00 -> mid_vol_cautious alloc=0.70 (delta=0.70, rebal=True)
  13:25:01 [INFO] core.signal_generator: Signal: SPY LONG alloc=0.70 stop=694.58 regime=WEAK_BULL conf=1.00 rebal=True
  13:25:01 [INFO] __main__: Signal rejected: Max total exposure reached
  17:33:23 [INFO] __main__: Instance: spy-aggressive
  17:33:23 [INFO] __main__: Connecting to Alpaca (paper mode)...
  17:33:23 [INFO] __main__: Account connected: equity=$103495.64 cash=$14930.84 status=ACTIVE
  17:33:24 [INFO] __main__: Market is CLOSED. Next open: 2026-05-13 09:30:00-04:00. Exiting gracefully.
  ```
- Identical pattern on `regime-trader-spy-cons` (alloc=0.40 stop=695.36).
- `e8c6b59` faulthandler instrumentation present but did not fire — exit was Python-level, not C-level segfault.

## Hypotheses for the 13:25 CT clean exit

Since `exit_code=0` and no traceback, ranked by likelihood:

1. **External `pm2 stop` issued in another shell session** between 13:25–13:30 CT. The previous claudeclaw session closed at ~13:30 CT; an automation hook or operator key-combo might have stopped both apps. PM2 records this as a clean stop with exit 0. **Most likely.**
2. **Internal `sys.exit(0)` reached on some condition.** A loop guard, a daily quota, or a time-of-day cutoff in `main.py` could fire a clean exit. Worth `grep -nE "sys\\.exit|raise SystemExit|^\\s*exit\\(" main.py core/`. The existing post-close path uses this pattern — there might be a sibling pre-close path.
3. **Unhandled `KeyboardInterrupt`** from a pm2 SIGINT (e.g., from `pm2 reload`, a watchdog action, or a Windows process-manager interaction). Exit 0 if caught at the right level.
4. **OS-level signal** that Python catches and converts to clean exit (SIGTERM with default handler exits 0 on POSIX; Windows behavior differs but pm2 sends `SIGINT`-equivalent).
5. **Memory pressure → pm2 graceful shutdown.** PM2 has `max_memory_restart` semantics; if the ecosystem config sets one and the process hits it, pm2 stops cleanly. Worth checking `ecosystem.config.cjs` (or wherever the regime-trader instances are registered with pm2).

What is **NOT** the cause:
- Bug 2 (HMM size-0 IndexError). The `[!] HMM error` lines appear in the early-startup `out.log` but the bot ran past them and produced 50+ signals over 5 hours. Bug 2's symptom is hung loop, not exit.
- Faulthandler-tracked C-level crash. The `e8c6b59` instrumentation would have written a trace; nothing in the log.
- Market-close exit path. Market closes at 15:00 CT, not 13:25 CT.

## Bot-side compensating control

- pm2 `cron_restart: '30 8 * * 1-5'` will start both instances tomorrow at 08:30 CT. PM2 in fork mode treats the cron event as a restart action; for stopped processes, this functions as a start.
- If pm2 cron_restart does NOT auto-start stopped processes (version-dependent), the operator will need to `pm2 start` manually. **Verification window opens 2026-05-13 08:30 CT.**
- Box-3 Sharpe cron `regime-sharpe-9a08` is independent: it reads the Alpaca account directly via the trading-readiness path. So Box-3 keeps recording rows even if the bot is down — but the recorded `daily_return` reflects SPY market drift on the existing 120-share position, not strategy activity. The Sharpe number is still meaningful as a measurement of "what the existing position is doing"; it just isn't measuring "what the strategy is doing."

## Suggested actions for regime-trader maintainer

1. `grep -nE "sys\\.exit|raise SystemExit|exit\\(0|exit\\(1" main.py core/` and audit each path. Add a log line immediately before each clean exit so a future silent-stop is self-explanatory.
2. Consider replacing the post-close `Exiting gracefully` path with a `time.sleep` until next-open boundary. Keeping the process running 24/7 means pm2 cron_restart works unambiguously and ANY exit becomes a real signal worth investigating.
3. Add a pm2 stop-event hook (or wrap `main.py` with a try/finally that logs an explicit `Process exiting (reason: X)` line) so future stops have a documented cause.
4. If `max_memory_restart` is set in the pm2 ecosystem config, check whether the bot was approaching that ceiling around 13:25 CT today.

## Action this session (claudeclaw side)

- pm2 start for both instances issued — bot exited gracefully (post-market path, expected).
- Sharpe cron verified writing rows (independent of bot run state).
- This handoff note committed.
- 11 unpushed claudeclaw commits pushed to `origin/main`.
- Awaiting tomorrow's 08:30 CT pm2 cron_restart fire for first-fresh-startup verification.

## Re-run trigger

If the bot exits cleanly mid-market again on or after 2026-05-13, escalate this note from "Medium" to "High" and add a Sprint S5-class ticket to claudeclaw to either (a) wrap pm2 management of regime-trader so claudeclaw auto-restarts it on stop, or (b) replace the cron-based startup with a long-running supervised process.
