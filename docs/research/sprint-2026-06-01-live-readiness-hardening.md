# Sprint 2026-06-01 Live Readiness Hardening

## Scope

Harden the paper-to-live readiness surface without enabling real-money trading,
changing risk caps, or bypassing the MISSION sign-off gate.

## Existing-Code Audit

- `src/config.ts` exports advanced Polymarket flags, but the `.env` allowlist
  omitted several of them. That made readiness commands report defaults instead
  of the local file value.
- `src/readiness/source-freshness.ts` already tracks source age and whether a
  source is used by signals. Signals did not persist the source freshness
  context that existed when the decision was made.
- `src/readiness/gate-progress.ts` already models the seven real-money gate
  boxes. It did not expose a separate live-startup interlock summary.
- `src/dashboard.ts` and `src/dashboard-html.ts` already expose trading and
  Polymarket paper panels. They lacked a compact live-readiness panel tying
  gate progress, source freshness, and live execution flags together.

## Verdict

- Duplicate: no duplicate readiness system found.
- Complement: add source provenance and live-startup checks on top of existing
  source freshness and gate progress.
- Conflict: do not enable live execution or advanced paper sizing while
  MISSION.md still requires paper evidence and written sign-off.
- Novel: persist per-signal source context so later trade review can answer
  whether the signal was made with fresh required inputs.

## How This Changes Our Code/Strategy

The bot remains paper-only until the documented real-money gates are satisfied.
The code should make hidden configuration drift visible, attach source freshness
to new signals, and show live-readiness blockers in both CLI and dashboard
surfaces so the operator can see exactly what remains before any live-money
start.
