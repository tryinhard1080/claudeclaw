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
https://mcp.financialdatasets.ai/
```

Authentication still happens inside Claude Code with `/mcp`. Do not put a
Financial Datasets key in `.env` for this workflow.

## Full-Capacity Work Queue

The current full-capacity objective is nine concrete functions:

1. Keep Claude and Codex instruction, skill, and MCP surfaces aligned.
2. Fix readiness false negatives from stale weekend regime-trader state.
3. Keep the current repo hardening work commit-ready.
4. Keep Financial Datasets MCP guidance explicit and advisory-only.
5. Add live gate-progress and source-freshness tracking.
6. Keep the TTL shadow report path operational.
7. Add an equity benchmark surface for regime-trader.
8. Add a Polymarket US read-only market-data path, with no order methods.
9. Add adversarial data tests that prove bad data is rejected or treated as data.

No item above enables real money. Real money still requires every `MISSION.md`
gate checkbox plus Richard's written operator sign-off.

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

