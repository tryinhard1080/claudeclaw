# Handoff: 2026-05-24 Goal 9 Readiness

## What changed

The nine requested readiness functions now have repo surfaces:

1. Claude/Codex shared surface:
   - `docs/agent-shared/README.md`
   - mirrored `.claude/skills/claudeclaw-readiness/SKILL.md`
   - mirrored `.agents/skills/claudeclaw-readiness/SKILL.md`
   - `npm run agent:surface:check`
2. Regime-trader weekend readiness:
   - `closed_stale_open_state` classification outside regular session
   - stale open state still fails during regular session
3. Repo hardening status:
   - README and runbooks point at trading-only readiness checks
4. Financial Datasets MCP:
   - shared surface verifies `.mcp.json` and `.codex/config.toml`
   - runbook remains advisory-only
5. Gate and source freshness:
   - `npm run gate:status`
   - `npm run source:freshness:refresh`
   - migrations v1.17.0 applied
6. TTL report:
   - `npm run poly:ttl:report`
   - latest report at `docs/research/sprint-s2-ttl-filter-latest.md`
7. Equity benchmark:
   - `npm run trading:benchmark:snapshot`
   - `npm run trading:benchmark`
   - migrations v1.18.0 and v1.19.0 applied
8. Polymarket US read-only:
   - `src/poly/polymarket-us-client.ts`
   - no order, account, cancel, portfolio, or position methods
9. Adversarial tests:
   - `src/poly/adversarial-data.test.ts`
   - malicious headline, price gap, duplicate position, empty asks, wrong date,
     and missing settlement source fixtures

## Verification

Commands run 2026-05-24:

```powershell
npm run agent:surface:check
npm run source:freshness:refresh
npm run trading:benchmark:snapshot
npm run trading:benchmark
npm run gate:status
npm run poly:ttl:report
npm run capacity:status
npm run typecheck
npm test
```

Results:

- `npm run agent:surface:check`: PASS all checks.
- `npm run trading:benchmark:snapshot`: wrote `spy-buy-hold` snapshot for
  2026-05-22 at SPY reference price 745.81.
- `npm run trading:benchmark`: reports both regime instances versus
  `spy-buy-hold`.
- `npm run gate:status`: reports Box 4 pass, Boxes 1/2/3/5/6/7 warning or
  incomplete.
- `npm run capacity:status`: exit 0.
- `npm run typecheck`: pass.
- `npm test`: 67 files, 857 tests passed.

## Current WARNs

- Financial Datasets MCP still needs Claude Code `/mcp` OAuth.
- News sync source freshness is stale until Perplexity or an equivalent news
  feed is re-authorized.
- Regime Sharpe is stale on Sunday and still only 6/60 days.
- Polymarket Box 2 remains 0/50 settled trades with 10 open and 22 voided.
- Operator final sign-off remains pending. Real money is not enabled.

## Do not do

- Do not enable live flags.
- Do not lift halts.
- Do not change money caps.
- Do not treat Polymarket US read-only support as a live execution path.

