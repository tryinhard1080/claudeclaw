# Shared Agent Surface

This file is the common operating brief for Claude Code and Codex in ClaudeClaw.
It does not override `TRUST.md`, `SOUL.md`, `MISSION.md`, or `HEARTBEAT.md`.
It points both agents at the same source of truth.

## Required Read Order

1. `TRUST.md`
2. `SOUL.md`
3. `MISSION.md`
4. `HEARTBEAT.md`
5. `CLAUDE.md` for Claude Code, `AGENTS.md` for Codex
6. This file

If a model sees old personal-assistant language in a script, template, memory,
or archived prompt, the files above win. ClaudeClaw is a trading agent only.

## Shared Skills

Project skills are mirrored so Claude Code and Codex get the same workflow hints:

- `.claude/skills/add-migration/SKILL.md`
- `.agents/skills/add-migration/SKILL.md`
- `.claude/skills/claudeclaw-readiness/SKILL.md`
- `.agents/skills/claudeclaw-readiness/SKILL.md`

The mirrored pairs should stay byte-identical. Run:

```bash
npm run agent:surface:check
```

## Shared MCP

Financial Datasets MCP is advisory only. It may inform research notes, operator
briefs, and source context, but it must not trigger trades, size positions, or
override deterministic gates.

Claude Code reads `.mcp.json`.
Codex reads `.codex/config.toml`.

Both must point to:

```text
https://mcp.financialdatasets.ai/api
```

Authentication still happens inside Claude Code with `/mcp`. Do not put a
Financial Datasets key in `.env` for this workflow.

## Full-Capacity Surface

The nine requested functions now have repo surfaces. Treat this as the shared
Claude/Codex inventory, not as a blank work queue:

1. Claude/Codex instruction, skill, and MCP alignment:
   `npm run agent:surface:check`, this file, mirrored readiness skills, and
   `.mcp.json` / `.codex/config.toml`.
2. Weekend-aware regime-trader readiness:
   `closed_stale_open_state` prevents weekend false negatives while stale
   regular-session state still fails.
3. Repo hardening and commit-ready posture:
   readiness runbooks, handoffs, and review ledgers point at trading-only gates.
4. Financial Datasets MCP guidance:
   advisory-only shared MCP rules, with no trade trigger or sizing authority.
5. Live gate-progress and source-freshness tracking:
   `npm run gate:status`, `npm run gate:audit`, and
   `npm run source:freshness:refresh`.
6. TTL shadow report path:
   `npm run poly:ttl:report` and
   `docs/research/sprint-s2-ttl-filter-latest.md`.
7. Equity benchmark surface:
   `npm run trading:benchmark:snapshot`, `npm run trading:benchmark`, and
   readiness evidence `equity_benchmark_edge`.
8. Polymarket US read-only market-data path:
   `src/poly/polymarket-us-client.ts`, with no order, account, cancel,
   portfolio, or position methods.
9. Adversarial data tests:
   `src/poly/adversarial-data.test.ts` covers malicious headlines, price gaps,
   duplicate positions, empty asks, wrong dates, and missing settlement sources.

No item above enables real money. Real money still requires every `MISSION.md`
gate checkbox plus Richard's written operator sign-off.

## Current Live-Money Blockers

As of the latest readiness baseline on 2026-06-01, system blockers are zero.
The remaining blockers are evidence/operator gates:

- Box 1: elapsed paper-clock evidence is ready, but the `MISSION.md` checkbox
  still needs operator review.
- Box 2: Polymarket paper trades are `0/50` settled, with `11/50` potential
  after the current open book and `39` additional resolved trades still needed.
- Box 3: regime-trader Sharpe evidence is `8/60` sample days.
- Box 7: Richard's final written live-money sign-off is still pending.

## Required Checks

Use these checks before calling the system ready:

```bash
npm run agent:surface:check
npm run capacity:status
npm run typecheck
npm test
```

If a check fails, report the exact failing line and fix the root cause. Do not
silence a trading alarm just to get a green screen.
