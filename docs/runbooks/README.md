# Runbooks

Operational runbooks for ClaudeClaw — each document describes a specific drill, incident response, or recurring procedure.

## Current runbooks

_(None yet — first runbook will be `kill-switch-drill.md` scheduled for Fri 2026-04-24 per MISSION.md gate box 6.)_

## How to add a runbook

Each runbook must include:

1. **Trigger** — what condition or schedule initiates the procedure.
2. **Preconditions** — state checks that must pass before starting (process up, backup taken, operator availability, etc.).
3. **Procedure** — ordered steps with the exact commands / SQL queries / pm2 actions.
4. **Verifications** — how to confirm each step succeeded.
5. **Rollback** — how to reverse the procedure if a step fails mid-way.
6. **Outcome signature** — where the operator signs off (usually `MISSION.md` Operator Sign-Off Log).

Name files by what they drill: `<procedure>-drill.md` (rehearsals) or `<incident>-response.md` (live incident playbooks).
