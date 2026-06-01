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

- Equities: Alpaca paper account and regime-trader instances are online and
  visible in the dashboard.
- Polymarket: paper scanner is online. `POLY_TTL_FILTER_ENABLED=true` and
  `POLY_MARKET_QUALITY_FILTER_ENABLED=true` are active in PM2 logs.
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
