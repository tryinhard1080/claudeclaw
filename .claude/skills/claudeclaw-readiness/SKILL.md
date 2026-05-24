---
name: claudeclaw-readiness
description: Use when asked to assess, harden, or move ClaudeClaw toward full trading capacity, real-money readiness, agent consistency, gate progress, source freshness, or Claude/Codex shared setup.
---

# ClaudeClaw Readiness

Use this skill for full-capacity, real-money readiness, gate progress, source
freshness, Claude/Codex consistency, or operational hardening work in ClaudeClaw.

## Steps

1. Read `TRUST.md`, `SOUL.md`, `MISSION.md`, and `HEARTBEAT.md` before any
   substantive work.
2. Run `git status --short --branch` and preserve existing user work.
3. If touching `src/poly/` or `src/trading/`, first do an existing-code audit
   and add a sprint note under `docs/research/` with duplicate, complement,
   conflict, and novel verdicts.
4. Run `npm run agent:surface:check` when the work affects Claude/Codex setup,
   skills, MCP, shared docs, or onboarding.
5. Run `npm run capacity:status` for operational readiness. Treat WARN rows as
   operator-visible debt and FAIL rows as blockers unless the code explicitly
   classifies the state as safe.
6. Do not change money caps, lift halts, touch `src/poly/risk-gates.ts`,
   `src/poly/paper-broker.ts`, or `src/poly/pnl-tracker.ts`, or enable live
   trading without Tier 3 written approval.
7. Report exact commands and results. Separate what is green, what is warning,
   and what still needs operator action.

## Shared Surface

Read `docs/agent-shared/README.md` for mirrored Claude/Codex skills and MCP
expectations. The `.claude/skills/` and `.agents/skills/` copies of this skill
must stay byte-identical.

