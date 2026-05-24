# ClaudeClaw

Richard's trading-only agent for Polymarket paper trading and regime-trader equity operations.

ClaudeClaw is no longer a general Claude Code assistant wrapper. The active mission is narrow: profitable, safe, reliable trading on the existing two systems, with paper evidence before any real-money switch.

## Start Here

Read these first, in order:

1. [`TRUST.md`](./TRUST.md) - partnership contract and absolute bright lines.
2. [`SOUL.md`](./SOUL.md) - trading-agent identity and refusals.
3. [`MISSION.md`](./MISSION.md) - current gate state and real-money requirements.
4. [`HEARTBEAT.md`](./HEARTBEAT.md) - cadence, halt switches, alarms, review rhythm.
5. [`CLAUDE.md`](./CLAUDE.md) and [`AGENTS.md`](./AGENTS.md) - repo-local agent instructions.
6. [`docs/agent-shared/README.md`](./docs/agent-shared/README.md) - shared Claude/Codex skills and MCP surface.

If any old script, template, or archived note conflicts with those files, the files above win.

## Scope

ClaudeClaw does:

- Polymarket paper trading in [`src/poly/`](./src/poly/).
- Equity trading bridge operations in [`src/trading/`](./src/trading/).
- Telegram `/poly` and `/trade` commands.
- SQLite persistence under `STORE_DIR/claudeclaw.db`.
- Health checks, readiness scripts, trading runbooks, and trading research.

ClaudeClaw declines:

- Email, calendar, todos, document drafting, profile management, and generic chat.
- Generic web research unrelated to trading.
- New asset classes, new strategies, or new market integrations before the existing two systems have a track record.
- Real-money trading until every `MISSION.md` real-money gate box is closed and Richard signs the operator log.

## Current Systems

| Subsystem | Code | Runtime purpose |
|-----------|------|-----------------|
| Polymarket paper trader | [`src/poly/`](./src/poly/) | Scanner, strategy engine, risk gates, paper broker, P&L, calibration, TTL shadow data |
| Equity bridge | [`src/trading/`](./src/trading/) | File-IPC bridge to regime-trader Python instances |
| Telegram bot | [`src/bot.ts`](./src/bot.ts) | Operator commands and alert delivery |
| Dashboard health endpoint | [`src/dashboard.ts`](./src/dashboard.ts) | Local `127.0.0.1:3141/health` status |
| Runtime DB | `STORE_DIR/claudeclaw.db` | Trades, signals, scan runs, memories, schedules, Sharpe snapshots |

## Capacity Check

Use the combined readiness check:

```bash
npm run capacity:status
```

That runs:

```bash
npm run status
npm run trading:status
npm run trading:benchmark:snapshot
npm run trading:benchmark
npm run poly:paper:status
npm run gate:status
tsx scripts/poly-ttl-shadow-report.ts
```

Individual checks:

```bash
npm run agent:surface:check
npm run status
npm run trading:status
npm run poly:paper:status
npm run source:freshness:refresh
npm run gate:status
npm run typecheck
npm test
```

Dashboard smoke:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3141/health
```

PM2:

```powershell
pm2 list
pm2 describe claudeclaw-main
pm2 logs claudeclaw-main --lines 100
```

## Build And Run

Install dependencies:

```bash
npm install
```

Apply migrations:

```bash
npm run migrate
```

Build:

```bash
npm run build
```

Start from compiled output:

```bash
npm start
```

PM2 service commands:

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
```

Do not restart PM2 casually during a gate-clock period. Planned deploy restarts are operator-directed work; failure-driven restarts are real evidence and must be logged.

## Trading Gates

The real-money gate in [`MISSION.md`](./MISSION.md) is sacred. The high-level blockers are:

- 30+ consecutive paper-trading days without unplanned intervention.
- At least 50 resolved Polymarket trades with positive realized P&L.
- Regime-trader paper Sharpe positive over at least 60 days.
- Drawdown stayed inside `POLY_HALT_DD_PCT`.
- No P0/P1 review findings outstanding.
- Kill-switch and rollback procedures tested.
- Richard signs the operator log in writing.

Do not lobby to waive these.

## Research Discipline

Trading research belongs in [`docs/research/`](./docs/research/). Every research note should end with:

```text
## How this changes our code/strategy
```

Research budget is for trade quality, risk control, and reliability. External repos can be used as blueprint material, but code import requires license review and a clear gate-box reason.

## Specialist Agents

The templates under [`agents/`](./agents/) are trading-only. They are not personal-assistant workers:

- `comms` is risk-alert wording and operator handoffs.
- `content` is market briefs and trading digests.
- `ops` is runtime reliability and drills.
- `research` is trading research.

Each specialist must read the binding docs before doing substantive work.

## Safety Lines

- Never bypass `src/poly/risk-gates.ts`.
- Never fuse strategy judgment with deterministic risk gates.
- Never skip the paper broker to trade real money.
- Never change monetary risk parameters without Tier 3 approval.
- Never lift a fired halt switch without Richard's explicit written approval.
- Never add unrelated assistant features back into the bot.
- Keep `EQUITY_LIVE_EXECUTION_ENABLED=false` and `POLYMARKET_US_LIVE_EXECUTION_ENABLED=false` until `MISSION.md` has Richard's final written sign-off.
