# MISSION — Current Quarter

## North Star

Build a trading system that **earns its right to trade real money** by demonstrating profitability and reliability on paper across multiple market regimes.

## Q2 2026 Objectives

1. **Polymarket Phase C runs unattended for 30 consecutive days** with zero unplanned restarts.
2. **Statistically meaningful sample of resolved trades** (target: ≥50 settled positions) so we can compute real win rate, average edge captured, and Sharpe.
3. **One refined strategy per market** — Polymarket has the AI-probability strategy; equities flow through regime-trader. Don't add a third until both have a track record.
4. **Research foundation built** — codified knowledge base on quant techniques, Polymarket microstructure, prompt strategies for prediction markets, and risk frameworks. Stored as durable docs we can revisit.

## Out of Scope (declined work)

- Personal assistant features (gmail, calendar, todos, profile management, generic chat).
- New asset classes (crypto spot/perps, options, futures) until equities + Polymarket are stable.
- Web UI / standalone dashboard beyond the existing `:3141` health endpoint.
- Multi-tenant or multi-user features. One operator, one bot.
- Auto-scaling capital from realized P&L. Human approves capital changes.

## Real-Money Gate

Before any real-money trading is enabled on either system, ALL of these must be true:

- [x] 30+ consecutive days of paper trading without manual intervention.
      (2026-06-16) Operator accepted the elapsed paper-clock evidence in Codex session. Gate evidence: 56/30 days since the 2026-04-21 restart, target was 2026-05-21, A1 permissive restart reading is already ACKed. This closes Box 1 only; it does not enable real money or satisfy final live-money sign-off.
- [ ] ≥50 resolved Polymarket trades with positive realized P&L.
      (2026-06-17) 0 won + 0 lost / 50. Current paper book after the paper-slot restart: 23 open, 68 voided, $0.00 realized P&L, -$10.96 unrealized P&L, paper equity $4,989.04. The current paper book can cover at most 23/50 settled-trade slots, so at least 27 more resolved trade opportunities are still needed after the current book. Keep `POLY_REFLECTION_ENABLED`, `POLY_EXIT_ENABLED`, and `POLY_EXPOSURE_AWARE_SIZING` disabled until resolved-trade calibration data exists.
      (2026-06-29) Current evidence still does not pass: 0 won + 0 lost / 50, 30 open, 107 voided, $0.00 realized P&L, -$763.31 unrealized P&L, paper equity $4,236.69. Operator explicitly requested more paper activity; Codex raised only paper activity capacity: slot ceiling from 30 to 50, scan candidate set from 20 to 40, and paper min-edge threshold from 5pp to 3pp while leaving per-trade dollars, paper capital, deployed-cap percentage, drawdown limits, live flags, and halt behavior unchanged. Box 2 stays open until settled trades and positive realized P&L exist.
      (2026-06-29 sprint update) Current evidence still does not pass: 0 won + 0 lost / 50, 50 open, 107 voided, $0.00 realized P&L, -$506.76 unrealized P&L, paper equity $4,493.24. The current open book can cover the 50/50 settled-trade sample target if the open positions resolve normally, but Box 2 remains open because there are still 0 actual settled trades and $0.00 realized P&L. Resolution monitoring is now tighter: a prioritized `fetch-resolutions.ts --limit 75` scheduler runs at odd-hour :55 and the read-only resolution watchdog runs at even-hour :00. This records evidence freshness only; Box 2 remains open until actual settled trades and positive realized P&L exist.
      (2026-06-29 calibration checkpoint) Current evidence still does not pass: 0 won + 0 lost / 50, 50 open, 108 voided, $0.00 realized P&L, -$667.14 unrealized P&L, paper equity $4,332.86. `npm run poly:settled:calibration` is now wired into `npm run capacity:status`; it reports `waiting_for_settlements` until actual won/lost paper trades exist and will only pass once sample size, positive realized P&L, and linked calibration samples all pass. This is evidence/reporting hardening only, not a live-money authorization.
      (2026-06-29 11:17 CT evidence refresh) Current evidence still does not pass: 0 won + 0 lost / 50, 50 open, 108 voided, $0.00 realized P&L, -$678.16 unrealized P&L, paper equity $4,321.84. The open book can still cover 50/50 potential settlements, with 36 positions due within 7 days and 50 due within 30 days. This is pipeline capacity, not Box 2 completion. Box 2 stays open until actual settled trades and positive realized P&L exist.
- [ ] Equity strategies (regime-trader) have positive paper Sharpe over ≥60 days.
      (2026-06-16) Current evidence is positive but incomplete: spy-aggressive n_days=19, Sharpe=4.08; spy-conservative n_days=19, Sharpe=4.07. Both instances are `open_full` and outperform SPY buy-and-hold by +0.72%, but Box 3 stays open until the 60-day sample completes.
      (2026-06-29) Current evidence remains positive but time-blocked: spy-aggressive n_days=28, Sharpe=2.69; spy-conservative n_days=28, Sharpe=2.69. Both show strategy return +1.88% vs SPY buy-and-hold +1.58%, excess +0.30%. Box 3 stays open until the 60-day sample completes.
      (2026-06-29 11:17 CT evidence refresh) Current evidence remains positive but time-blocked: spy-aggressive n_days=29, Sharpe=2.82; spy-conservative n_days=29, Sharpe=2.81. Both show strategy return +2.00% vs SPY buy-and-hold +1.58%, excess +0.42%. Box 3 stays open until the 60-day sample completes.
- [x] Drawdown never exceeded `POLY_HALT_DD_PCT` during paper period.
      (2026-05-11) Green throughout. `maybeAutoHaltOnDrawdown` correct after hotfix `fb48f5c`.
- [x] No P0/P1 codex-review findings outstanding.
      (2026-05-11) Codex pass `2026-05-11-sprints-20-27-plus-readiness.md` found 1 P1 in `strategy-engine.ts:532` (latent until Phase-7 flag-flip); fixed in commit `fb48f5c` with regression test. 0 P0, 0 P1 outstanding. Re-run trigger: any Phase-7 flag-flip OR any subsequent edit to a TRUST Tier-3 surface.
- [x] Documented kill-switch and roll-back procedure tested.
      (2026-05-09) halt/resume + DB-restore + bloat all PASS. (2026-05-11) Independent of today's regime-trader drill outcome; claudeclaw-side kill-switch path intact. Re-drill quarterly.
- [ ] Operator (Richard) has explicitly signed off in writing in this file.
      (2026-06-16) Final live-money authorization remains pending. A1/A2/A3 were interim operating decisions only; they did not close final Box 7 sign-off. Do not enable real money until Boxes 1-6 pass and Richard adds a final written approval here.
      (2026-06-29) Operator asked Codex to "make the decision" for Box 2, Box 3, and sign-off. Codex records that instruction as authorization for a paper-only activity increase, not as final live-money sign-off, because Boxes 2 and 3 are objectively incomplete. Box 7 stays open. Live execution flags remain disabled.

Don't lobby for any of these to be waived. They exist to prevent ruin.

## Definition of Done (per change)

A change is "done" when:
1. Code merged to main with descriptive commit message.
2. Tests cover the new behavior + a regression test for the bug being fixed.
3. Codex review has been run and findings triaged.
4. `dist/` rebuilt and `pm2 restart claudeclaw` applied.
5. Memory + relevant docs updated.

Anything less is a draft.

## Operator Sign-Off Log

(Date — Decision — Reason)

- _2026-07-18_ - **Sprints R1-R4 shipped per operator-approved fix plan; resolution pipeline repaired; first settled trades in system history.** Root cause of Box 2's 0/50 freeze: Gamma's `/markets?slug=X` silently excludes closed markets, so resolved markets read as delisted forever (poly_resolutions: 468 rows, 0 ever closed). Fix: closed=true fallback in gamma-client (commits `96f7705`+`e35f079`), plus R2 reliability (fetch timeouts, book-full LLM short-circuit, news-sync retired as a silent-failure surface, commit `6311754`), R4 dependency cleanup (production npm audit now 0 vulnerabilities, was 13 incl. 1 critical, commit `000e5b2`), and R3 risk-integrity (real pre-fill drift re-validation, best-level depth gate, realized-equity-anchored caps/sizing, commit `1c40d50` — zero edits to risk-gates.ts/paper-broker.ts/pnl-tracker.ts). Same-day settlement wave: 54 trades settled (21 won +$1,010.30, 33 lost -$1,455.47), net realized **-$445.17**; 23 voided trades recovered by the parallel Codex session's Sprint 30 sweep. **Box 2 sample now flowing but remains OPEN: realized P&L is negative and must be organically positive to pass. Backfill-day artifact: today's daily-loss gate correctly suppressed new entries (historic P&L concentrated into one window). This entry does not enable real money, change any monetary parameter, lift a halt, or satisfy Box 7.** Plan: docs/plans/2026-07-18-repo-review-and-fix-plan.md.

- _2026-06-29_ - **Readiness gate evidence refreshed during the 5-trading-day sprint.** `npm run capacity:status` and `npm run readiness:evidence` show zero current system blockers, Box 2 still objectively incomplete at 0/50 settled paper trades with $0.00 realized P&L, Box 3 still objectively incomplete at 29/60 paper Sharpe days, and Box 7 pending. This updates the evidence trail only. It does not enable real money, change paper capital, change max trade dollars, change deployed-cap percentage, change drawdown limits, lift a halt, touch risk-gate or paper-broker code, enable live flags, mark Box 2 or Box 3 complete, or satisfy final Box 7 live-money sign-off.

- _2026-06-29_ - **Prioritized Polymarket resolution-cache refresh and read-only resolution watch scheduled for the 5-trading-day sprint.** Codex registered `poly-resolution-fetch-872d` to run `scripts/fetch-resolutions.ts --limit 75` every 2 hours at odd-hour :55 and `poly-resolution-watch-a7be` to run `scripts/poly-resolution-watch.ts` every 2 hours at even-hour :00. This keeps Box 2 settlement evidence and closed-cache-still-open mismatches operator-visible while the paper book matures. It does not settle trades manually, change P&L logic, change paper capital, change max trade dollars, change deployed-cap percentage, change drawdown limits, lift a halt, touch risk-gate or paper-broker code, enable live flags, mark Box 2 or Box 3 complete, or satisfy final Box 7 live-money sign-off.

- _2026-06-29_ - **Paper scan cadence tightened from 5 minutes to 2 minutes for the 5-trading-day launch-readiness sprint.** Codex selected the bounded `POLY_SCAN_INTERVAL_MIN` lever after `npm run capacity:status` showed zero avoidable system blockers, Box 2 still incomplete at 0/50 settled with 38 open paper positions, and paper learning velocity on pace but still short of the 50-trade sample. This stays inside the `TRUST.md` bounded range, does not change paper capital, max trade dollars, deployed-cap percentage, drawdown limits, halt state, risk-gate code, paper-broker code, live flags, Box 2, Box 3, or Box 7.

- _2026-06-29_ - **Paper activity cap raised from 30 to 50 open Polymarket positions, scan candidate set widened from 20 to 40, and paper min-edge lowered from 5pp to 3pp.** Richard explicitly requested more paper activity and told Codex to "just trade already." Codex changed local paper-only `POLY_MAX_OPEN_POSITIONS` to 50, `POLY_SCAN_TOP_N` to 40, and `POLY_MIN_EDGE_PCT` to 3. `POLY_MAX_TRADE_USD=50`, `POLY_PAPER_CAPITAL=5000`, `POLY_MAX_DEPLOYED_PCT=0.5`, `POLY_TTL_FILTER_ENABLED=true`, and `POLY_MARKET_QUALITY_FILTER_ENABLED=true` remain unchanged. This does not enable real money, change paper capital, change max trade dollars, change deployed-cap percentage, change drawdown limits, lift a halt, add a new live strategy, mark Box 2 or Box 3 complete, or satisfy final Box 7 live-money sign-off.

- _2026-06-17_ - **Paper activity cap raised from 20 to 30 open Polymarket positions.** Richard asked to get the traders more active and specifically requested raising max open positions. Codex changed the local paper-only `POLY_MAX_OPEN_POSITIONS` setting to 30 and left `POLY_MAX_TRADE_USD=50`, `POLY_PAPER_CAPITAL=5000`, and `POLY_MAX_DEPLOYED_PCT=0.5` unchanged. This does not enable real money, change paper capital, change max trade dollars, change drawdown limits, lift a halt, or satisfy final Box 7 live-money sign-off.

- _2026-06-16_ - **Box 1 paper-clock evidence accepted; live money still blocked.** Richard asked Codex to get the readiness updates applied. Codex closed the Box 1 checkbox based on current gate evidence (`56/30` elapsed days since 2026-04-21, A1 permissive reading ACKed). Current blockers after this update remain Box 2 (`0/50` settled Polymarket trades and `$0.00` realized P&L), Box 3 (`19/60` regime Sharpe days), and Box 7 (final written live-money sign-off). This entry does not enable real money, change paper capital, change max trade dollars, change drawdown limits, lift a halt, or weaken any risk gate.

- _2026-06-01_ - **Active TTL and market-quality paper filters approved.** Richard approved continuing the full-operational trading goal after the dashboard showed that Polymarket Box 2 remained stuck at 0/50 settled trades and the TTL shadow data showed the current candidate universe was dominated by long-dated markets. The running PM2 process now has `POLY_TTL_FILTER_ENABLED=true` and `POLY_MARKET_QUALITY_FILTER_ENABLED=true`; latest scans show the active paper candidate set narrowed from 9 shadow candidates to 4 active candidates. This is a paper-learning behavior change only. It does **not** enable real money, change paper capital, change max trade dollars, change drawdown limits, lift any halt, or satisfy final operator live-money sign-off.

- _2026-05-12 (evening session)_ — **Sprint S2 (TTL filter shadow) shipped + interim operating approvals recorded.** Sprint S2 (Path A instrumentation) shipped end-to-end this session: migration v1.16.0 applied; pure module `src/poly/ttl-filter.ts` + 19 tests; scanner wired in shadow mode (no candidate-list mutation); `scripts/poly-ttl-shadow-report.ts`; codex review found 1 P2 (`created_at` ms→sec convention violation), FIXED same-session via hotfix with regression test. 832/832 tests pass. claudeclaw-main pm2 restarted (count 9→10) per A1 PERMISSIVE reading authorized in this same session. First post-restart scan tick wrote a real `poly_ttl_shadow_ticks` row at 18:17 CT: 20 topN candidates, 2 inside [1,30] day band, 18 long-dated (avg 205 days). Confirms plan §3 hypothesis. 14-day shadow window opens now; Sprint S2 comparison report due 2026-06-03; Sprint S4 flag-flip eligibility 2026-06-05+ (Tier-3 operator-only, separate from this entry). Box-5 stays ackable (0 P0 / 0 P1 outstanding). **Operator authorizations A1/A2/A3 cleared the interim operating-decision bundle only; final live-money Box 7 sign-off remains pending. Q5 (`EMERGENCY_KILL_PHRASE`) + Q7 (`OPERATOR_EMAIL`) were initially selected but operator aborted the bundled .env edit before it landed — both remain unset.**

- _2026-05-12_ — **A1 ACK: Gate-clock reading PERMISSIVE.** Operator-directed sprint deploys (Sprint S1 ship 13:30 CT, Sprint S2 ship 18:17 CT, future authorized sprint deploys) do NOT reset the Box-1 30-day "no manual intervention" clock. Only failure-driven unplanned restarts reset it. Bot has been operating under this reading implicitly since 2026-04-21; this entry codifies it. Closes interim operating-decision item A1 (1/3). Retroactively legitimizes today's S1 + S2 deploys.

- _2026-05-12_ — **A2 ACK: Defer reflection / exit / exposure-aware flag flips pre-calibration.** `POLY_REFLECTION_ENABLED`, `POLY_EXIT_ENABLED`, `POLY_EXPOSURE_AWARE_SIZING` all stay `false` until ≥15-20 resolved trades exist (Phase-4 finding: 0 resolved today, projection mid-June at earliest under Path A). Mandatory because the flags depend on calibration data the bot does not have. Re-evaluate per-flag once resolutions land. Closes interim operating-decision item A2 (2/3).

- _2026-05-12_ — **A3 ACK: Defer adversarial-review OAuth (`CLAUDE_CODE_OAUTH_TOKEN`).** Adversarial review of strategy without resolution data produces speculative critique, not actionable findings. Sun 18:00 ET cron currently skips correctly when auth absent. Re-evaluate after Box 2 has data to ground critique. Closes the A1/A2/A3 interim operating-decision bundle (3/3). **Final live-money Box 7 sign-off remains pending.**

- _2026-05-12_ — **Path A authorized for Box 2.** Operator approved Path A in chat: add `POLY_MAX_MARKET_TTL_DAYS=30` filter to scanner, run 14-day shadow comparison via existing A/B harness, flip live if shadow shows positive lift. Reversible via env-var revert. Plan reference: `docs/plans/2026-05-12-real-money-gate-closure.md` §4. Sprint S1 (Sharpe instrumentation, Box 3 prerequisite) begins immediately. Sprint S2 (TTL filter shadow, Box 2 acceleration) begins after S1 ships. Target real-money date with Path A working: ~2026-08-01. **Tier-3 strategy parameter change authorized by operator in chat 2026-05-12; flag-flip from shadow to active still requires separate operator nod after shadow data lands.**

- _2026-05-12_ — **Box-3 60-day paper-Sharpe clock started.** Today's 08:30 CT pm2 cron fired cleanly (Bug 1 fix `6affa57` proven on the live cron); both regime-trader instances loaded the May-11 cached `hmm_model.pkl` and produced real `SPY LONG ... regime=WEAK_BULL` signals at the 08:35 CT bar boundary; signals correctly rejected by the exposure cap (gates working). Bug 2 (HMM size-0 IndexError) was caught by origin's `8e33adb` T=0 guard on each startup; error visible in stderr but bot ran through. `npm run trading:status` now reports both instances `open_full`. Day 1/60, target completion 2026-07-11. Operator action: none required for this entry — bot-side documentation of the clock start. Real-money gate state movement: Box 3 went from "clock cannot start" (2026-05-11) to "Day 1/60 ticking" (today). **No operator authorization required for this entry.**

- _2026-05-11_ — Operational-readiness sweep ran end-to-end per plan `review-this-code-base-rustling-whistle.md`. **Codex P1 in `strategy-engine.ts:532` found and fixed (commit `fb48f5c`); MISSION Box 5 ackable.** Phase-1 market-open drill **FAILED** on two regime-trader bugs (pm2 cron timezone misalignment + HMM size-0 IndexError on fresh startup), both scoped at `docs/research/sprint-2026-05-11-regime-trader-cron-tz-fix.md`. Box-2 P&L verification confirms 0 won/lost trades against the ≥50 target (Q4 2026 projection at current strategy pace) — the "79 resolved" figure cited earlier was the `poly_resolutions` market-cache, not trade outcomes. claudeclaw-main side healthy throughout, all drills clean, no operator action taken in this session beyond the surgical P1 hotfix. Operator decisions pending: A1/A2/A3 acks, `EMERGENCY_KILL_PHRASE`, `pwm login`, `OPERATOR_EMAIL`, regime-trader fix sequencing. Checklist at `docs/handoff/2026-05-11-operator-action-checklist.md`. **No operator authorization required for this entry — bot-side documentation of the sweep.**

- _2026-04-13_ — Pivot to trading-only identity (this MISSION + SOUL + HEARTBEAT) — "make this a first class trading bot, single focus".
- _2026-04-20_ — Authorized restart on GLM 5.1 subscription after $150 Anthropic API spend incident. Keys retained (private repo, acceptable). Stage 3 eval showed GLM more calibrated than pre-halt Claude (which was hallucinating 2025 data). 30-day gate-box-1 clock starts now. — "A" (restart now option selected in Phase 0.5 Stage 4 decision). **INVALIDATED SAME DAY** — that restart went silent 83 min in with zero signals; peaceful-turtle plan (below) replaced it.
- _2026-04-21_ — Peaceful-turtle recovery merged to main (`762b219`). DB rescued (9.31 GB → 140 MB), scanner narrowed 2500x per-tick writes, scheduler exorcised from mandatory Claude CLI, heartbeat watchdog installed, zombie tables dropped, migration tracker reconciled. Post-rescue scans verified: 30s total / 860ms DB-write / 5-min cadence. 562/562 tests pass. **30-day gate-box-1 clock restarts today. Target: 2026-05-21.** — "Do it. Push and merge to main and start our 30 days." (Richard, authorized in chat).
- 2026-04-22T22:31:04.459Z — Plan cheerful-rossum C10 kill-switch halt+resume drill: PASSED.
  - pre/post open positions: 10 → 10
  - halt flag set then cleared via DB UPSERT (mirrors /poly halt + /poly resume Telegram path).
  - bot remained ONLINE throughout (non-destructive drill); no pm2 restart cost.
  - Sprint 16 /poly halt + /poly resume verified working.
- 2026-04-22T22:31:13.341Z — Plan cheerful-rossum C11 DB-restore drill: PASSED.
  - source: backup-2026-04-22
  - sha256 verified against recorded hash; copy to /tmp scratch verified hash-equal.
  - restored DB readable; ≥ 5 key tables present with positive row counts.
  - live /c/claudeclaw-store/ untouched; bot remained ONLINE throughout.
- 2026-04-29 — Phase 7 OneDrive retirement: COMPLETE.
  - Archive: C:\_archive\2026-04-26\claudeclaw-onedrive\ (410 MB).
  - Source removed from OneDrive sync; parent CCBot1080\ now holds only space-agent.
  - stash@{0} (25e9f9bb pre-cutover stale tree) dropped.
  - schedule-cli task c2acdc12 deleted; active crons reduced to 5 production tasks.
  - Bot online throughout (exec cwd C:\Code\claudeclaw, 0 unstable restarts).
  - Cutover plan tell-me-the-current-playful-koala.md complete: phases 1 through 7 closed.
  - Authorized in chat: "Yes execute now." — Richard, 2026-04-29.
- 2026-04-26T19:10:11Z — OneDrive → C:\Code\claudeclaw cutover: COMPLETE.
  - 70 commits synced (5e2ee0f → d906198, 132 files).
  - pm2: claudeclaw (id 8, OneDrive cwd) → claudeclaw-main (id 10, C:\Code\claudeclaw cwd). PID 54484 → 8492.
  - .env restored byte-identical (5,474 B, 8 mandatory keys); migrations/.applied.json synced (now v1.13.0 matching live DB schema).
  - Halt round-trip: 0→1 pre, 0 post. Open positions unchanged (10 → 10).
  - Boot logs clean. Dashboard :3141/health → 200. Telegram online. pm2 save persisted.
  - 24h verification cron registered as schedule-cli task 0169ab93 (next fire 2026-04-27 19:07 local; self-deletes on green-light, Telegram-alerts on any failure).
  - Plan file: C:\Users\Richard\.claude\plans\tell-me-the-current-playful-koala.md
  - Phase 7 (OneDrive retirement) gated 24h for rollback window. Authorized in chat: "All 4" — Richard, 2026-04-26.

### Phase A decisions for plan cheerful-rossum (PROPOSED — operator to confirm or override)

The four code commits of plan cheerful-rossum Phase B + D (Sprint 16-19) shipped 2026-04-21 evening. Three operator-decision items remain. Recommended values are PROPOSED below; operator strikes "PROPOSED" and signs once accepted, OR overrides with replacement reasoning.

- _2026-04-21 PROPOSED_ — **A1. Gate-clock reading: PERMISSIVE.** This session's 5 deploy-restarts (claudeclaw restart count 7 → 12) were all operator-directed feature work, NONE were failure-driven. The MISSION text "without manual intervention" is read as "without the operator stepping in to fix unplanned breakage" — planned deploys to ship operator-requested features don't reset the clock. Result: 30-day clock continues ticking from `762b219` merge timestamp. Target completion stays 2026-05-21. **Operator to ack.**
- _2026-04-21 PROPOSED_ — **A2. Sprint 8 (POLY_EXIT_ENABLED), Sprint 9 (POLY_EXPOSURE_AWARE_SIZING), Sprint 2.5 (POLY_REFLECTION_ENABLED) flag-enable: DEFER ALL THREE.** All three depend on calibration data we don't have yet (first batch arrives Sun 2026-04-26). Enabling pre-calibration means the bot acts on inferences we can't verify against ground truth. Re-evaluate individually after a 7-day calibration window post-resolutions. **Operator to ack.**
- _2026-04-21 PROPOSED_ — **A3. Adversarial-review auth (CLAUDE_CODE_OAUTH_TOKEN): DEFER.** Adversarial review of strategy without resolution data to ground it produces speculative critique, not actionable findings. Sun 18:00 ET cron currently skips with a Telegram message when auth is absent — that's correct behavior. Add auth in any later session; no urgency. **Operator to ack.**
