# Sprint 2026-06-01 — Operational green hotfix

**Touches:** `src/trading/ops-status.ts`, `src/trading/ops-dashboard.ts`, `scripts/trading-readiness.ts`, `src/poly/news-sync.ts`, `scripts/regime-trader-pm2-config.ts`, `docs/runbooks/regime-trader-pm2.md`

## Existing-Code Audit

| Surface | Verdict | Notes |
|---|---|---|
| `summarizeSharpeFreshness` in `src/trading/ops-status.ts` | **Complement** | Already centralizes regime-Sharpe readiness, but used wall-clock age only. That turns a Friday 17:00 CT snapshot into a Monday-morning warning even though the next scheduled snapshot is not due until Monday 17:00 CT. |
| `summarizeFinancialDatasetsMcp` in `src/trading/ops-status.ts` | **Complement** | Already parses `claude mcp list` lines. It did not parse targeted `claude mcp get financial-datasets` output where status appears on a following line. |
| Dashboard MCP health in `src/trading/ops-dashboard.ts` | **Complement** | Already caches MCP status, but shells out to the slow global `claude mcp list`. Targeting the named MCP is faster and less exposed to unrelated MCP output. |
| CLI readiness MCP health in `scripts/trading-readiness.ts` | **Duplicate risk avoided** | Reuses the shared MCP parser rather than adding a second interpretation of Financial Datasets health. |
| News refusal detection in `src/poly/news-sync.ts` | **Complement** | Sprint 27 already blocks Sonar refusal text before DB insert. Live rerun showed a new refusal phrasing using "live trading-news access", so this hotfix expands the same detector rather than adding a new validation path. |
| RSS fallback in `src/poly/news-sync.ts` | **Novel but bounded** | Existing news sync had one live-search producer. When Perplexity/pwm quick refuses, the scheduler either writes garbage or leaves source freshness stale. A deterministic RSS fallback from finance feeds is a bounded source-quality improvement, not a new trading strategy. |
| Regime Trader PM2 manifest in `scripts/regime-trader-pm2-config.ts` | **Complement** | PM2 already recorded `windowsHide: true`, but the venv `python.exe` launcher still spawned a console-backed base Python process. The existing manifest is the right control point; switching the interpreter to the venv `pythonw.exe` keeps the same script, args, and venv while removing the visible Windows Terminal host. |

## Decision

Fix the operational health surface without changing trading behavior:

- Treat regime-Sharpe freshness as schedule-aware for the weekday 17:00 CT snapshot cadence.
- Parse targeted Claude MCP `get` output.
- Prefer `claude mcp get financial-datasets`, with fallback to `claude mcp list`.
- Prefer the npm-installed Claude CLI when present because PM2's `PATH` can resolve an older `C:\Users\Richard\bin\claude.cmd` that does not see the local MCP entry.
- Extend news refusal detection for "live trading-news access" wording so source freshness does not get a false heartbeat from non-news.
- On Sonar refusal, write a clearly labeled RSS fallback summary from CNBC, MarketWatch, and Yahoo Finance SPY feeds instead of claiming a model-driven last-2-hours search.
- Use the Regime Trader venv `pythonw.exe` interpreter in PM2 so both paper equity workers run headlessly on Windows.

## How this changes our code/strategy

This does not change strategy, risk gates, paper broker behavior, position sizing, or real-money readiness. It makes readiness reporting match the actual operating schedule, reduces dashboard MCP false warnings, keeps refusal text out of the news source used by trading context, and stops the equity PM2 workers from opening visible Windows Terminal windows.
