# Operational Trading Goal - 2026-06-01

## Enhanced Goal Prompt

Complete ClaudeClaw's operational trading-readiness loop in `C:\Code\claudeclaw`
without enabling real money until the documented `MISSION.md` gate is complete.

Read first:

- `TRUST.md`
- `SOUL.md`
- `MISSION.md`
- `HEARTBEAT.md`
- `AGENTS.md` / `CLAUDE.md`
- `docs/agent-shared/README.md`
- `docs/runbooks/full-capacity.md`

Scope:

- Do: keep equities paper-trading through regime-trader and Alpaca, keep
  Polymarket paper-trading through the current strategy, keep source freshness
  and gate progress visible, keep the dashboard truthful, and improve evidence
  generation inside existing risk gates.
- Do: make stale WARNs machine-checkable when the repo already has evidence.
- Do: document operator-approved strategy-parameter decisions in `MISSION.md`
  or research notes.
- Do not: enable real money, change monetary caps, lift halts, add new asset
  classes, or weaken deterministic risk gates.

Loop:

1. Run `npm run capacity:status` and identify the biggest remaining blocker.
2. Choose one focused change that improves gate evidence, data freshness, paper
   trade quality, or dashboard observability.
3. Make the smallest scoped edit.
4. Verify with targeted tests plus `npm run capacity:status`.
5. Update the checkpoint log below.
6. Continue only while the next action is inside the safety envelope and likely
   to improve verified readiness.

Stop when:

- All non-time/non-performance blockers are green, and the only remaining
  blockers are settled-trade count, 60-day equity Sharpe, and final operator
  sign-off, or
- the next action requires real-money enablement, monetary cap changes, risk-gate
  edits, or unclear operator authority.

Final report:

- Best verified state.
- Commands used as proof.
- Files changed.
- Remaining gates and operator decisions.

## Current Execution State

- Equities: Alpaca paper account is wired through regime-trader. After-hours
  states are expected to report `closed_until_next_open`; the next market-open
  sync is the next equity proof point.
- Polymarket: paper scanner is online with widened Gamma discovery, TTL filter,
  market-quality filter, source freshness, approval quality, open-book quality,
  and resolution queue evidence surfaced in CLI and dashboard.
- Dashboard: equity cockpit, Polymarket paper status, trading ops, gate progress,
  live flags, and source freshness are visible.
- Real money: still disabled. This is correct.

## Checkpoint Log

| Time | Result | Next action |
|---|---|---|
| 2026-06-01 12:00 CT | Active TTL and market-quality filters verified in PM2 logs. Latest scans captured 4 active candidates from 9 shadow candidates. | Make stale gate evidence machine-readable. |
| 2026-06-01 12:05 CT | Box 5 review ledger and Box 6 kill-switch evidence moved from manual WARN to machine-checked status. | Re-run full capacity status and commit. |
| 2026-06-01 12:15 CT | Added an enhanced-loop evidence target: prove Polymarket settlement pipeline, signal flow, TTL filter freshness, and regime Sharpe sample depth in one CLI/dashboard surface. | Verify `npm run readiness:evidence`, tests, build, dashboard API, then commit. |
| 2026-06-01 12:25 CT | Added persistent daily readiness evidence snapshots so dashboard evidence can trend instead of only showing the current tick. | Apply migration, record first snapshot, register daily snapshot task, verify. |
| 2026-06-01 12:35 CT | Mark-to-market Polymarket strategy evidence identified as the next missing proof surface. Settlement count is still time-blocked, but current open paper P&L can be tracked now. | Add realized + unrealized + equity evidence to CLI/dashboard snapshots. |
| 2026-06-01 12:40 CT | Box 1 paper-clock evidence moved from a static manual warning to machine-readable elapsed-day tracking. `npm run gate:status` now reports `elapsed_review_ready` at `41/30` days with A1 ACK present and the MISSION checkbox still open. | Keep live money disabled; continue with Box 2 settlement tracking, Box 3 Sharpe sample depth, and final operator sign-off. |
| 2026-06-01 12:45 CT | Browser verification found a false-green dashboard failure mode: a malformed or rate-limited readiness payload could render `All gate boxes pass`. The dashboard now treats malformed readiness payloads as red unavailable state, and the auth-gated local API limit is raised above normal polling bursts. | Rebuild, restart PM2, verify health, dashboard API, and browser surface. |
| 2026-06-01 12:50 CT | The dashboard Gate blockers card was still too thin for operator review: it showed WARN box names without states, details, or progress numbers. Added a detailed gate-blocker renderer with state, blocker detail, and current/target progress bars. | Rebuild, restart PM2, and browser-verify the dashboard shows `41/30`, `0/50`, and `8/60` directly. |
| 2026-06-01 12:55 CT | Box 2 tracking now needs position-level visibility, not only aggregate `0/50` counts. Added a read-only Polymarket resolution queue to operational evidence, CLI output, and the dashboard Evidence Path card. | Run full tests, rebuild, restart PM2, and browser-verify the queue shows the live open paper book. |
| 2026-06-01 13:00 CT | Resolution queue verified end-to-end: targeted tests `10/10`, full tests `908/908`, build PASS, PM2 restarted, `/health` healthy, readiness API returns the queue, dashboard DOM renders `10` rows, and `capacity:status` remains operationally green except expected live-money gates. | Commit and push, then continue only with non-Tier-3 evidence/ops improvements unless Richard authorizes a specific gate action. |
| 2026-06-01 13:15 CT | Added a read-only real-money gate audit classifier. It separates Box 1 and Box 7 operator actions from Box 2 and Box 3 sample/time blockers and flags any failed safety gate as a system blocker. | Verify targeted tests, full tests, build, PM2 health, `npm run gate:audit`, and `npm run capacity:status`, then commit and push. |
| 2026-06-01 13:20 CT | Final post-restart `capacity:status` passed operationally with the audit included: `3/7` boxes complete, `0` system blockers, live-money ready `NO`, and PM2 `/health` healthy. | Commit and push the gate-audit work; remaining blockers are Box 1 mission review, Box 2 settled trade sample, Box 3 60-day Sharpe sample, and Box 7 final sign-off. |
| 2026-06-01 13:22 CT | Dashboard chat quick actions were brought back inside the trading-only mandate: `Poly Status`, `Poly P&L`, `Trade Status`, and `Trade Sharpe` replace the old `Todo` and `Gmail` shortcuts. | Verify the static dashboard HTML, full tests, build, PM2 health, and capacity status, then commit and push. |
| 2026-06-01 13:24 CT | Quick-action pass verified after rebuild/restart: targeted dashboard test `5/5`, full test suite `913/913`, build PASS, `/health` healthy, served HTML contains the four trading commands and no `/todo` or `/gmail`, and post-restart `capacity:status` shows zero system blockers. | Commit and push the dashboard trading-scope guard. |
| 2026-06-01 13:31 CT | Added a separate equity live-sync proof surface so operator review can distinguish current regime-trader state freshness from daily post-close Sharpe sampling. `readiness:evidence` now reports both instances fresh/open-full while Regime Box 3 remains correctly time-blocked at `8/60`. | Verify focused tests, full tests, build, live dashboard payload, PM2 health, and capacity status, then commit and push. |
| 2026-06-01 13:30 CT | Began moving the real-money gate audit from CLI-only into the dashboard Live Readiness card so operator actions, sample/time blockers, and system blockers are visible in the same review surface. | Verify dashboard tests, API payload, browser DOM, full tests, build, PM2 health, then commit and push. |
| 2026-06-01 13:43 CT | Added the equity benchmark edge to readiness evidence so the dashboard can show current regime-trader paper return versus buy-and-hold benchmark separately from the 60-day Sharpe gate. Latest evidence shows both equity instances outperforming benchmark by roughly `+0.79%` to `+0.80%`. | Verify focused tests, full tests, build, live dashboard payload, PM2 health, and capacity status, then commit and push. |
| 2026-06-01 13:45 CT | Dashboard gate audit verified after rebuild/restart. API returns `3/7` complete, `2` operator actions, `2` sample/time blockers, `0` system blockers, `liveMoneyReady=false`; headless Chrome render shows the same panel and actions. | Commit and push the dashboard audit surface. |
| 2026-06-01 13:50 CT | Box 2 path clarity identified as the next gap: current evidence says `0/50` settled and `11` open but did not explicitly state the open book can only cover `11/50`, leaving `39` additional resolved trades needed after the current book. | Add read-only Box 2 pipeline capacity to CLI, dashboard, daily snapshots, docs, then verify and push. |
| 2026-06-01 13:58 CT | Re-baseline confirmed the bot is operationally running with `0` system blockers, but the shared Claude/Codex surface still described the nine requested functions as an open work queue even though code and handoff evidence show the surfaces exist. | Update `docs/agent-shared/README.md` to separate completed full-capacity surfaces from remaining live-money blockers, then run shared-surface and capacity checks. |
| 2026-06-01 14:05 CT | Box 2 evidence still blurred all open trades with near-term learning value. The open book can become `11/50` eventually, but only `5/50` is due within 30 days. | Add near-term Box 2 capacity to readiness evidence, snapshots, CLI, dashboard, and runbook, then verify and push. |
| 2026-06-01 14:10 CT | The next Box 2 gap is velocity: capacity says `5/50` due within 30 days, but the operator also needs to know whether the bot is opening enough near-term paper trades per day to fill the sample. | Add read-only Box 2 learning velocity and ETA to readiness evidence, snapshots, CLI, dashboard, and runbook, then verify and push. |
| 2026-06-01 14:15 CT | Box 2 learning velocity verified end-to-end: targeted tests `18/18`, full tests `919/919`, typecheck/build PASS, PM2 restarted, dashboard renders `box2 velocity 1/24h target 1.5/d ETA 2026-07-16`, and `capacity:status` still shows `0` system blockers. | Commit and push the read-only velocity evidence; next safe work is strategy-quality tuning inside existing gates because the live-money blockers are still Boxes 1, 2, 3, and 7. |
| 2026-06-01 14:25 CT | Live Gamma probe found `/markets` caps responses at 100 rows, so the scanner was stopping after the first page. `fetchActiveMarkets()` now uses ten 100-row, `volume24hr`-sorted pages by default; live selector proof improved to `992` raw markets and `20/20` active paper candidates. | Run full verification, rebuild, restart PM2, verify next scanner tick raises latest market count above the old `100` cap, then commit and push. |
| 2026-06-01 14:30 CT | Gamma discovery fix verified in production: full tests `921/921`, typecheck/build PASS, PM2 restart clean, `/health` healthy, `capacity:status` shows scans fresh with `markets=992`, dashboard renders `992 markets`, PM2 logs show `poly scan complete count=992`, and a new paper trade filled inside existing gates. | Commit and push. Remaining live-money blockers are still Box 1 operator review, Box 2 settled trade sample, Box 3 60-day Sharpe sample, and Box 7 final written sign-off. |
| 2026-06-01 14:35 CT | Gamma discovery depth moved from hidden scan metadata to a first-class readiness signal. `readiness:evidence` now reports `Market discovery` PASS at `992/500`, `poly:paper:status` warns if the bot falls back to the old first-page cap, and daily readiness snapshots persist discovery count/history. | Run full tests, build, dashboard browser verification, capacity status, then commit and push. |
| 2026-06-01 14:45 CT | Open-book quality moved into readiness evidence. `readiness:evidence` now distinguishes current-filter paper trades from legacy exceptions: live state shows `14/20` open trades pass today's active paper-learning filters and `6` long-dated exceptions opened before the active TTL/quality window. | Record the snapshot, verify dashboard rendering, full tests/build/capacity, then commit and push. |
| 2026-06-01 14:55 CT | Re-ran the enhanced goal loop and selected the next safe blocker: approved signal quality. Added a read-only evidence surface for approved Polymarket signals so CLI/dashboard review shows source freshness, paper-trade linkage, average/max edge, stale or missing source context, and low-confidence high-edge watches. Live evidence currently shows `9/11` recent approvals with fresh source context, `11/11` linked to paper trades, and `1` low-confidence high-edge watch. | Run full tests, rebuild, record the snapshot, restart PM2, browser-verify `Signal qual`, then commit and push. |
| 2026-06-01 15:05 CT | Live news-sync smoke found the next safe source-quality blocker: Sonar refused live search, RSS fallback worked, but raw fallback quality could admit personal-finance filler and position intersections could alert on weak generic tokens such as `company` and `market`. | Add deterministic RSS trading-relevance filtering, XML entity cleanup, and distinctive-token intersection gating; verify with targeted tests, live sync, full tests/build, capacity, then commit and push. |
| 2026-06-01 15:10 CT | Full-capacity bookkeeping exposed an after-hours benchmark snapshot bug: `trading:benchmark:snapshot` failed when regime-trader closed-market state omitted `positions[].current_price`, even though stored benchmark status remained usable. | Add a tested clean-skip path for missing SPY price so readiness does not treat closed-market source shape as a system blocker. |
| 2026-06-01 15:15 CT | Re-ran the enhanced goal loop against the fresh baseline. Operational systems are green with `0` system blockers, Polymarket scans fresh at `991` markets, `20` open paper positions, `603` signals and `11` approvals in the last 24h, paper equity `$5,002.91`, regime Sharpe `8/60`, and live-money startup blocked only by Boxes 1/2/3/7. The shared Claude/Codex surface still had the older Box 2 `11/50` potential count. | Update shared agent guidance and this checkpoint log, then verify `agent:surface:check`, record readiness evidence, run capacity status, commit, and push. |
| 2026-06-01 15:21 CT | Readiness evidence briefly false-failed equity sync after market close because state-file age exceeded the open-session freshness window. Reused the regime-state classifier so closed-session states count correctly. Verified `readiness:evidence:record` and `capacity:status`: equity sync PASS `2/2 closed_until_next_open`, Polymarket scans fresh at `990` markets, `20` open paper positions, `612` signals and `11` approvals in the last 24h, and system blockers remain `0`. | Commit and push. Remaining live-money blockers are Box 1 operator review, Box 2 settled trade sample, Box 3 60-day Sharpe sample, and Box 7 final written sign-off. |
| 2026-06-01 15:26 CT | Approved-signal quality audit found one recent approval was made with required Polymarket source context stale by one minute because the source freshness ledger was updated by the external refresh command, not by the successful scan tick itself. The scanner now records `polymarket-gamma-scan` and `polymarket-price-history` as fresh before emitting `scan_complete`, so future strategy decisions inherit the same tick's data freshness. Verified focused tests `81/81`, full tests `939/939`, typecheck/build PASS, PM2 restart, live ledger `allRequiredFresh=true` with both required signal sources age `15s`, and `capacity:status` with signal sources PASS. | Commit and push. Keep watching approved signal quality until the two legacy/stale rows age out of the 24h window; do not enable real money while mark-to-market and resolved-trade evidence remain weak. |
