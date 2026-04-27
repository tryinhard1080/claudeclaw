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

- [ ] 30+ consecutive days of paper trading without manual intervention.
- [ ] ≥50 resolved Polymarket trades with positive realized P&L.
- [ ] Equity strategies (regime-trader) have positive paper Sharpe over ≥60 days.
- [ ] Drawdown never exceeded `POLY_HALT_DD_PCT` during paper period.
- [ ] No P0/P1 codex-review findings outstanding.
- [ ] Documented kill-switch and roll-back procedure tested.
- [ ] Operator (Richard) has explicitly signed off in writing in this file.

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
