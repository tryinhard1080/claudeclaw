# docs/research/ - Index

Per `feedback_research_first.md`: every research file should end with a
"How this changes our code/strategy" section. Keep this index current so agents
can find the newest source of truth without spelunking the whole folder.

## Current Operating References

- [`financial-research-agent-prompts.md`](./financial-research-agent-prompts.md) - Prompt templates for using Financial Datasets MCP as research context, not trading execution.
- [`sprint-weather-shadow.md`](./sprint-weather-shadow.md) - Weather Goat shadow-evaluator research and implementation notes.
- [`atlas-self-improving-trading-agents.md`](./atlas-self-improving-trading-agents.md) - Atlas and self-improving trading-agent comparison; use as blueprint material only.
- [`sprint-27-sonar-refusal-detection.md`](./sprint-27-sonar-refusal-detection.md) - News-sync skip-vs-fail handling for Sonar real-time refusals.
- [`sprint-26-news-sync-via-pwm.md`](./sprint-26-news-sync-via-pwm.md) - Perplexity Web MCP/`pwm` news-sync route.
- [`sprint-24-gamma-pagination.md`](./sprint-24-gamma-pagination.md) - Gamma pagination and active-market coverage hardening.
- [`sprint-23-scheduler-spawn-einval.md`](./sprint-23-scheduler-spawn-einval.md) - Windows/Node 24 scheduler spawn fix.

## Sprint Notes

- [`sprint-9-exposure-aware-sizing.md`](./sprint-9-exposure-aware-sizing.md) - Exposure-aware Kelly sizing.
- [`sprint-9-ceiling-alignment-and-enable.md`](./sprint-9-ceiling-alignment-and-enable.md) - Ceiling alignment and flag-enable follow-up.
- [`sprint-10-outcomeprices-nullish.md`](./sprint-10-outcomeprices-nullish.md) - Gamma `outcomePrices` nullish handling.
- [`sprint-11-digest-expansion.md`](./sprint-11-digest-expansion.md) - Daily digest expansion.
- [`sprint-12-unrealized-pnl.md`](./sprint-12-unrealized-pnl.md) - Unrealized P&L dashboard correction.
- [`sprint-16-poly-halt-command.md`](./sprint-16-poly-halt-command.md) - `/poly halt` and `/poly resume`.
- [`sprint-17-auto-halt-on-drawdown.md`](./sprint-17-auto-halt-on-drawdown.md) - Auto-halt on drawdown transition.
- [`sprint-20-news-injection.md`](./sprint-20-news-injection.md) - News context injection into `ai-probability`.
- [`sprint-21-news-intersection-alert.md`](./sprint-21-news-intersection-alert.md) - News/open-position intersection alerts.
- [`sprint-22-cron-prompt-audit.md`](./sprint-22-cron-prompt-audit.md) - Cron prompt drift audit.
- [`sprint-ambient-flag-gate.md`](./sprint-ambient-flag-gate.md) - Ambient-service gates for memory and voice.
- [`sprint-glm-migration.md`](./sprint-glm-migration.md) - GLM 5.1 strategy-module migration.
- [`sprint-migration-reconciliation.md`](./sprint-migration-reconciliation.md) - Schema audit and migration reconciliation.
- [`sprint-observability-heartbeat.md`](./sprint-observability-heartbeat.md) - Scan cadence and storage watchdog.
- [`sprint-phase-4b-pa-strip.md`](./sprint-phase-4b-pa-strip.md) - Personal-assistant module strip.
- [`sprint-scanner-bloat-fix.md`](./sprint-scanner-bloat-fix.md) - Price-history write reduction and WAL tuning.
- [`sprint-scanner-instrumentation.md`](./sprint-scanner-instrumentation.md) - `POLY_SCAN_DEBUG` trace markers.
- [`sprint-scheduler-exorcism.md`](./sprint-scheduler-exorcism.md) - Route trivial crons off Claude CLI.
- [`sprint-trading-revival.md`](./sprint-trading-revival.md) - `src/trading/` revival.
- [`sprint-zombie-cleanup.md`](./sprint-zombie-cleanup.md) - Orphaned PA table cleanup.
- [`sprints-1-through-8-retro.md`](./sprints-1-through-8-retro.md) - Backfilled retrospective for initial trading sprints.

## Research And Handoffs

- [`self-improvement-loops.md`](./self-improvement-loops.md) - Karpathy Autoresearch, evaluator-optimizer, Reflexion, and strategy implications.
- [`agent-mail-integration.md`](./agent-mail-integration.md) - AgentMail evaluation. Blocker remains destination/operator email.
- [`handoff-regime-trader-hmm-debug.md`](./handoff-regime-trader-hmm-debug.md) - Historical handoff for the separate Regime Trader Python repo.
- [`regime-status-2026-04-15.md`](./regime-status-2026-04-15.md) - Historical regime subsystem status.
- [`resolution-rate-analysis.md`](./resolution-rate-analysis.md) - Resolution cadence and data-availability analysis.

## Data And Templates

- [`feeds.json`](./feeds.json) - Research-ingest feed list.
- [`TEMPLATE-sprint.md`](./TEMPLATE-sprint.md) - Template for future sprint research notes.
