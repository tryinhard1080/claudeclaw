# Runbooks

Operational runbooks for ClaudeClaw - each document describes a specific drill, incident response, or recurring procedure.

## Current runbooks

- [`kill-switch-drill.md`](kill-switch-drill.md) - Halt trading and roll back code or data. Maps to MISSION gate box 6. **Discovered 2026-04-21 during drafting**: `EMERGENCY_KILL_PHRASE` is unset in `.env`, so the fastest halt path section 3a is currently inactive. Operator action required before next drill.
- [`full-capacity.md`](full-capacity.md) - One-pass readiness procedure for status, PM2, dashboard health, paper evidence, and residual WARNs.
- [`daily-trading-intelligence.md`](daily-trading-intelligence.md) - Daily source-order and freshness procedure for market data, macro, news, filings, and Polymarket context.
- [`regime-trader-pm2.md`](regime-trader-pm2.md) - Regenerate and verify the durable PM2 manifest for the external Regime Trader paper processes.
- [`market-open-drill.md`](market-open-drill.md) - Monday market-open verification for PM2, state files, Telegram commands, and dashboard health.
- [`polymarket-paper-readiness.md`](polymarket-paper-readiness.md) - Acceptance gate for scanner, paper positions, halt state, and advanced paper toggles.
- [`financial-datasets-mcp.md`](financial-datasets-mcp.md) - OAuth and permitted-use workflow for Financial Datasets MCP research context.
- [`weather-shadow-ops.md`](weather-shadow-ops.md) - Weather Goat shadow evaluation monitoring and promotion gate.
- [`trading-feature-flags.md`](trading-feature-flags.md) - Controlled Polymarket feature-flag profiles and live-capital no-go rule.
- [`trading-drill-log.md`](trading-drill-log.md) - Dated evidence from halt/resume, restore, bloat, and readiness drills.

## How to add a runbook

Each runbook must include:

1. **Trigger** - what condition or schedule initiates the procedure.
2. **Preconditions** - state checks that must pass before starting (process up, backup taken, operator availability, etc.).
3. **Procedure** - ordered steps with the exact commands / SQL queries / pm2 actions.
4. **Verifications** - how to confirm each step succeeded.
5. **Rollback** - how to reverse the procedure if a step fails mid-way.
6. **Outcome signature** - where the operator signs off (usually `MISSION.md` Operator Sign-Off Log).

Name files by what they drill: `<procedure>-drill.md` (rehearsals) or `<incident>-response.md` (live incident playbooks).
