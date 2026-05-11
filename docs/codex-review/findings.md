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
| 2026-05-11 | 20-27 + readiness | P1 | `strategy-engine.ts:532` `buildPortfolioSnapshot` realized-P&L sum missing `'exited'` — drawdown understated, `maybeAutoHaltOnDrawdown` could fail to fire after Sprint-8 stop-loss exits. Latent (POLY_EXIT_ENABLED=false) but blocks Phase 7 flag-flip. | FIXED | _this session_ |

See per-sprint review notes:

- `sprints-12-19-2026-04-22.md` — first review pass.
- `2026-05-11-sprints-20-27-plus-readiness.md` — second pass covering 30 commits since `d186090`.

_(Last codex pass: 2026-05-11. Re-run trigger: any Phase 7 flag-flip OR any subsequent edit to a TRUST Tier-3 surface — `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, `strategy-engine.ts`.)_
