# Sprints 1–8 Retrospective (backfilled 2026-04-15)

> This is NOT a research note. It's a retrospective stub so the audit catalog has an entry for every shipped sprint. Future sprints use `docs/research/TEMPLATE-sprint.md` *before* code.

Each shipped without a pre-code research note. Evidence in memory files under `~/.claude/projects/.../memory/project_sprint*_shipped.md`. No re-audit performed here — the audit cost isn't worth it for sprints that have already run and are producing telemetry. If any becomes suspect, trigger a dedicated re-audit.

| Sprint | Ship | Gist | Memory file | Retro flag |
|---|---|---|---|---|
| 1 | 2026-04-13 | Calibration tracker (Brier/log-loss/curve, `/poly calibration`) | `project_sprint1_calibration_shipped.md` | Foundation; ok to retro |
| 1.5 | 2026-04-13 | Drift dashboards (p50/p95/p99 scan latency, market count) | `project_sprint1_5_drift_shipped.md` | Observability-only; retro ok |
| 2 | 2026-04-13 | `prompt_version` + `model` on signals + A/B compare | `project_sprint2_versioning_shipped.md` | Metadata-only; retro ok |
| 2.5 | 2026-04-15 | Reflection pass (second-LLM critic, shadow-logged) | `project_sprint2_5_reflection_shipped.md` | Flag-gated off, shadow only; low risk |
| 3 | 2026-04-13 | Macro regime tagging (VIX/BTC dom/10y) | `project_sprint3_regime_shipped.md` | **Has known issues — see `regime-status-2026-04-15.md`** |
| 4 | 2026-04-13 | Weekly RSS/Atom research ingest | `project_sprint4_research_shipped.md` | Data-ingestion; retro ok |
| 5 | 2026-04-13 | Backtesting harness + min-edge sweep | `project_sprint5_backtest_shipped.md` | Tooling-only; retro ok |
| 5.5 | 2026-04-13 | Band filter (exclude YES <0.15 or >0.85) | `project_sprint5_5_band_filter_shipped.md` | Followed from Sprint 5 findings; retro ok |
| 6 | 2026-04-13 | Weekly adversarial-review cron | `project_sprint6_adversarial_shipped.md` | Meta-layer; retro ok |
| 7 | 2026-04-15 | Confidence-weighted Kelly + resolution-fetch cron | `project_sprint7_shipped.md` | Sizing-layer change; look closely if Sprint 9 audit reveals a sizing bug |
| 8 | 2026-04-15 | Price-based position exits (take-profit/stop-loss) | `project_sprint8_shipped.md` | Flag-gated off; retro ok |
| 9 | 2026-04-15 | Exposure-aware Kelly sizing | `project_sprint9_shipped.md` | **Audited** — see `sprint-9-exposure-aware-sizing.md` |

## Rule going forward

Pre-commit hook (`scripts/pre-commit-research-check.sh`) blocks future `src/poly` and `src/trading` commits without a sprint research note. This stub satisfies the historical gap; it does not satisfy future requirements.

[retro]
