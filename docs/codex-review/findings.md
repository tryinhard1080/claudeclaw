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
| 2026-05-12 | full-project review | P1 | `src/trading/telegram-commands.ts:73` `/trade` command handler missing `ALLOWED_CHAT_ID` auth guard. Mirror of the 2026-04-22 `d186090` poly fix. Any Telegram user could invoke `/trade halt`, `/trade start <instance> live` (Tier-3 real-money attempt), `/trade stop`, `/trade backtest`. | FIXED | `dc8f926` |
| 2026-05-12 | full-project review | P2 | `src/poly/telegram-commands.ts:287` `renderPnl` SQL omitted `'exited'` status. Display-layer mirror of `fb48f5c`. Latent (POLY_EXIT_ENABLED=false) but would mislead operator once exits start firing. | FIXED | `dc8f926` |
| 2026-05-12 | full-project review | P3 | Two style/architecture notes filed: `strategy-engine.ts:539` `freeCapital` naming (paper-mode correct, reconsider for real-money); `market-scanner.ts` topN-before-TTL ordering note for Sprint S2 implementation. | FILED (no action) | _self-review only_ |
| 2026-05-12 | S2 (TTL shadow) | P2 | `src/poly/ttl-filter.ts:136` `recordTtlShadowTick` stored `Date.now()` (ms) as `created_at` instead of unix seconds. No reader queries the column today; zero functional impact in shadow mode. Existing rows: none (fix landed before first scanner-block activation post-restart). | FIXED same-session | `<S2 hotfix>` |
| 2026-05-12 | S2 (TTL shadow) | P3 | `src/poly/ttl-filter.ts:119` `ensureTable` called per-tick. Consistent with `news-intersection.ts` pattern; SQLite `IF NOT EXISTS` is a fast catalog lookup. | NOTE (no action) | — |
| 2026-06-01 | operational goal gate evidence | N/A | Gate evidence review for Box 5 and Box 6 machine-readable status. No `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, monetary cap, halt, or live-money flag changes. | CLOSED 2026-06-01 - zero P0/P1 | `pending` |
| 2026-06-01 | real-money gate audit | N/A | Added read-only gate-audit classifier and CLI. No `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, monetary cap, halt, or live-money flag changes. | CLOSED 2026-06-01 - zero P0/P1 | `pending` |
| 2026-06-01 | dashboard gate audit | N/A | Added read-only dashboard rendering for the gate-audit payload. No `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, monetary cap, halt, or live-money flag changes. | CLOSED 2026-06-01 - zero P0/P1 | `pending` |
| 2026-06-01 | dashboard trading quick actions | N/A | Replaced non-trading dashboard chat quick actions with Polymarket and equity status commands. No `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, monetary cap, halt, or live-money flag changes. | CLOSED 2026-06-01 - zero P0/P1 | `pending` |
| 2026-06-01 | equity live-sync evidence | N/A | Added read-only equity state freshness evidence to CLI/dashboard readiness so live regime-trader sync is separated from daily Sharpe sampling. No `risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, monetary cap, halt, or live-money flag changes. | CLOSED 2026-06-01 - zero P0/P1 | `pending` |

See per-sprint review notes:

- `sprints-12-19-2026-04-22.md` — first review pass.
- `2026-05-11-sprints-20-27-plus-readiness.md` — second pass covering 30 commits since `d186090`.
- `sprint-27-2026-05-11.md` — self-review on `e40955c`, codex re-run pending tooling fix.
- `2026-05-12-full-project-review.md` — third pass; full-project review via `feature-dev:code-reviewer` agent because codex CLI 0.130.0 has a stdin-`-` regression. 1 P1 + 1 P2 found, both FIXED same day in `dc8f926`.
- `2026-05-12-sprint-s2-review.md` — fourth pass (Sprint S2 ship trigger). Same agent path. 0 P0 / 0 P1 / 1 P2 (FIXED same-session) / 1 P3 (no action).
- `2026-06-01-operational-goal-gate-review.md` - operational goal gate evidence review. 0 P0 / 0 P1.
- `2026-06-01-gate-audit-review.md` - real-money gate audit review. 0 P0 / 0 P1.
- `2026-06-01-dashboard-gate-audit-review.md` - dashboard gate audit review. 0 P0 / 0 P1.
- `2026-06-01-dashboard-quick-actions-review.md` - dashboard trading quick actions review. 0 P0 / 0 P1.
- `2026-06-01-equity-live-sync-review.md` - equity live-sync evidence review. 0 P0 / 0 P1.

_(Last codex pass: 2026-06-01 operational goal gate evidence review. Re-run triggers: any subsequent edit to a TRUST Tier-3 surface (`risk-gates.ts`, `paper-broker.ts`, `pnl-tracker.ts`, `strategy-engine.ts`); any live-money flag change; any monetary cap change; OR codex CLI stdin repair that allows a formal full-project codex run.)_
