# Codex Review Findings

Tracker for Codex code-review findings across every shipped sprint. This artifact backs **MISSION.md gate box 5** ("Zero P0/P1 codex-review findings outstanding"). Gate 5 cannot be signed unless this file lists every P0/P1 finding as resolved.

## Severity scale

| Level | Meaning | Response |
|---|---|---|
| **P0** | Correctness / safety / data-loss bug. Production is wrong or unsafe. | Halt further deploy; fix before next sprint starts. Blocks real-money gate. |
| **P1** | Clear bug with real-money implications (sizing, risk-gate, accounting). | Fix within one sprint. Blocks real-money gate until resolved. |
| **P2** | Correctness bug with limited blast radius, or notable code-quality issue. | Fix in a future sprint; note in research note of that sprint. |
| **P3** | Style, micro-optimization, or subjective preference. | Optional fix; may be declined with justification. |

## Findings log

| Date | Sprint | Severity | Finding | Status | Commit |
|---|---|---|---|---|---|
| 2026-04-22 | 12-19 | P1 | `telegram-commands.ts` `/poly` handler missing auth guard — any Telegram user with bot username could call `/poly halt`, `/poly resume`, read internal state | FIXED | `d186090` |
| 2026-04-22 | 12-19 | P1 | `telegram-commands.ts:291` `renderPnl` unrealized SUM joins all `poly_positions` rows; stale rows from crashed resolutions would inflate the total | FIXED | `d186090` |
| 2026-05-11 | 20-27 + readiness | P1 | `strategy-engine.ts:532` `buildPortfolioSnapshot` realized-P&L sum missing `'exited'` — drawdown understated, `maybeAutoHaltOnDrawdown` could fail to fire after Sprint-8 stop-loss exits. Latent (POLY_EXIT_ENABLED=false) but blocks Phase 7 flag-flip. | FIXED | `fb48f5c` |
| 2026-05-11 | 27 (implementation) | — | Codex CLI aborted (skill-loader stalls on malformed `~/.agents/skills/*/SKILL.md` files; `codex-review.js` wrapper has `--full-auto` flag-ordering bug). Self-review on `e40955c` flagged no P0 / P1. Two P3 perf/style notes recorded but not actioned. | CLOSED 2026-05-12 — self-review verdict: zero P0/P1, ship as-is. Formal codex pass pending tooling repair (see re-run trigger below). | `e40955c` |

See per-sprint review notes:

- `sprints-12-19-2026-04-22.md` — first review pass.
- `2026-05-11-sprints-20-27-plus-readiness.md` — second pass covering 30 commits since `d186090`.
- `sprint-27-2026-05-11.md` — self-review on `e40955c`, codex re-run pending tooling fix.

_(Last codex pass: 2026-05-11 sprints 20-27 + readiness. Re-run triggers: any Phase 7 flag-flip; any subsequent edit to a TRUST Tier-3 surface — `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, `strategy-engine.ts`; OR resolution of the codex-CLI tooling defects so `e40955c` can be reviewed properly.)_
