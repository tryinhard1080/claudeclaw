# Financial Datasets MCP

## Trigger

Use this runbook when ClaudeClaw needs market or company research context from the Financial Datasets MCP server.

This connector is advisory only. It can inform research notes, comparison work, and operator-visible context. It must not trigger trades, size trades, bypass risk gates, or act as a runtime price feed until a separate signed-off integration plan exists.

## Current State

As of 2026-06-01, the shared Claude/Codex endpoint is:

```text
https://mcp.financialdatasets.ai/api
```

The working private Claude Code entry is local-scoped and should report connected.

## Install

Official MCP docs: <https://docs.financialdatasets.ai/mcp-server>

Install the remote MCP server:

```powershell
claude mcp add --transport http financial-datasets https://mcp.financialdatasets.ai/api
```

## Authenticate

Inside Claude Code, run:

```text
/mcp
```

Select `financial-datasets` and complete the browser OAuth flow with the Financial Datasets account.

Do not put API keys in `.env` for ClaudeClaw for this workflow. The intended Claude Code path is OAuth, not a runtime secret inside this repo.

## Verify

Run:

```powershell
claude mcp list
claude mcp get financial-datasets
```

Expected connected state:

```text
financial-datasets:
  Status: ✓ Connected
  URL: https://mcp.financialdatasets.ai/api
```

Then run the operational status check:

```powershell
npm run trading:status
```

Expected after OAuth: Financial Datasets MCP should move from `WARN needs_auth` to `PASS connected`.

## Allowed Influence

Allowed:

- Research notes under `docs/research/`.
- Operator briefings and context summaries.
- Cross-checks before asking the primary Polymarket evaluator to reason about a market.
- Company fundamentals, SEC filing, market news, rates, or price-context snapshots used as advisory inputs.

Not allowed yet:

- Direct trade triggers.
- Runtime strategy-engine data feed.
- Position sizing.
- Risk-gate overrides.
- Live-capital enablement.
- Any use that depends on an MCP result without logging the source and timestamp in a research note or operator-facing output.

## Operator Checklist

1. Run `/mcp` inside Claude Code.
2. Authenticate `financial-datasets`.
3. Run `claude mcp list`.
4. Confirm the Financial Datasets line is connected.
5. Run `npm run trading:status`.
6. Record the date and result in the active drill log if this is part of an operational readiness check.
