# Sprint 2026-06-16 - readiness warning hygiene

## 1. Existing-code audit

- `src/trading/ops-status.ts` owns `summarizeFinancialDatasetsMcp()`, which parses
  both `claude mcp get financial-datasets` and `claude mcp list` output into
  trading ops checks.
- `scripts/trading-readiness.ts` and `src/trading/ops-dashboard.ts` reuse that
  shared classifier for CLI and dashboard status.
- `docs/agent-shared/README.md` and `docs/runbooks/financial-datasets-mcp.md`
  already define Financial Datasets MCP as advisory-only research context, not
  runtime trading data or gate authority.
- `src/trading/ops-status.test.ts` covers connected and needs-auth MCP parser
  output. It did not cover missing advisory MCP output.

## 2. Literature / NotebookLM finding

No external literature is needed. This is repo-local status semantics: an
advisory research connector should stay visible, but should not count as a
trading readiness warning when paper execution and deterministic gates do not
depend on it.

## 3. Duplicate / complement / conflict verdict

**Complement.** The existing classifier is the right shared surface. The change
keeps the same parser and states while downgrading `missing` and `needs_auth`
to advisory PASS states so `capacity:status` does not imply a trading blocker.

## 4. Why now

Richard asked to update the readiness action list. The current
`npm run trading:status` output reports Financial Datasets MCP as WARN even
though the repo documents it as advisory-only. The metric is fewer false
operator-visible trading WARN rows while retaining the MCP state in CLI and
dashboard output.

## 5. Out of scope

- No Financial Datasets OAuth or account setup.
- No runtime strategy-engine integration.
- No source used for trade triggers, sizing, risk gates, or live-capital
  enablement.

## 6. Risk

Low. The blast radius is status wording only. It does not touch risk gates,
broker code, position sizing, scanner behavior, or trade execution.

## 7. Verification plan

- Unit-test MCP parser behavior for missing, needs-auth, and connected states.
- Run `npm run trading:status` and confirm Financial Datasets is visible but no
  longer a trading WARN when unavailable.
- Run `npm run capacity:status` and confirm remaining live-money blockers are
  evidence/sign-off gates, not advisory MCP visibility.
