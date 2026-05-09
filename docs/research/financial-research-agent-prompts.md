# Financial Research Agent Prompts

These prompts use the Financial Datasets MCP as an advisory research source. They are not trade instructions. Save material findings into a dated research note when they influence an operator decision.

## Equity Fundamentals Snapshot

```text
Use Financial Datasets MCP to research TICKER as of today.

Return a concise operator note with:
- Company facts: sector, industry, exchange, market cap if available.
- Latest financial metrics snapshot: valuation, profitability, leverage, dividend yield if available.
- Last 4 quarters of revenue, net income, operating cash flow, and free cash flow if available.
- Most recent earnings filing date and source type.
- One paragraph on what changed recently.
- Key caveats, missing fields, and source timestamps.

This is advisory context only. Do not recommend a trade.
```

## Crypto Context Snapshot

```text
Use Financial Datasets MCP and any already-approved market data tools to research SYMBOL or crypto market context as of today.

Return:
- Current broad market context.
- Recent price trend over 7d, 30d, and 1y if available.
- Relevant macro rates context if available.
- Recent company or market news that could affect the asset or related equities.
- What this does and does not imply for a Polymarket question.

This is not an execution signal.
```

## Company Event Research

```text
Use Financial Datasets MCP to research EVENT for TICKER.

Focus on:
- Latest SEC filings and filing items relevant to EVENT.
- Recent company news.
- Management guidance, KPIs, or non-GAAP measures if available.
- Prior comparable events or disclosures in the last 4 quarters.
- A timestamped summary of facts versus uncertainty.

End with "Decision use" that states whether this is background context, a contradiction check, or a reason to pause evaluation.
Do not issue a trade recommendation.
```

## Polymarket Claim Cross-Check

```text
Before evaluating this Polymarket market, use Financial Datasets MCP for a source-backed claim check.

Market:
QUESTION_OR_SLUG

Return:
- The exact market claim in plain English.
- Which Financial Datasets tools were used.
- Facts found, with dates.
- Facts not found or outside MCP coverage.
- Whether the claim is directly answerable, partially supported, contradicted, or outside scope.
- A short advisory note the strategy evaluator may consider.

Do not compute a final probability and do not approve a paper or live trade.
```
