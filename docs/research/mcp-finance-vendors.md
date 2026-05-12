# MCP Finance Vendor Evaluation

Date: 2026-05-12.
Trigger: scout of `anthropics/financial-services` (Apache-2.0 reference repo).
Verdict on repo as a whole: PASS on adoption (analyst-workflow tooling, human-sign-off model, not a trading bot). Cherry-pick value is the vendor catalog and the wiring pattern, both captured below.

Status of each vendor: ADOPT (worth turning on now), WATCH (turn on if Greystar Anthropic Enterprise tier covers access, otherwise defer), or PASS (out of scope for claudeclaw).

## Background

`anthropics/financial-services` centralizes 11 finance-data MCP connectors in `plugins/vertical-plugins/financial-analysis/.mcp.json`. claudeclaw currently has one MCP at root: `financial-datasets` (https://mcp.financialdatasets.ai/), used per `financial-research-agent-prompts.md` as advisory research, not execution. This doc extends that pattern from one vendor to a vetted catalog of eleven.

Same operating rule applies: every vendor here is advisory context for human-reviewed analyst-style notes. No vendor in this list is wired to `risk-gates.ts` or `paper-broker.ts`. None drives order sizing without an explicit operator-approved Sprint that says so.

## Vendor Matrix

| Vendor | URL | Best for | Equity bridge | Polymarket | Verdict |
|---|---|---|---|---|---|
| Aiera | `https://mcp-pub.aiera.com` | Earnings call transcripts, real-time event audio summaries | High - event-driven entries | Medium - earnings-tied markets | **ADOPT (public endpoint, no auth gate visible)** |
| MT Newswires | `https://vast-mcp.blueskyapi.com/mtnewswires` | Real-time financial news wire | Medium - macro context | High - news drives Polymarket pricing; complements `pwm` Sonar route | **ADOPT-pending** (check whether endpoint requires key) |
| S&P Global Kensho (Kfinance) | `https://kfinance.kensho.com/integrations/mcp` | Equity fundamentals, capital structure, ownership | High | Low | **WATCH** (Enterprise-tier check) |
| Morningstar | `https://mcp.morningstar.com/mcp` | Factor data, fund flows, equity research | High - factor data feeds regime classifier (see `trading-research-2025-2026.md` Multi-Factor Rotation) | Low | **WATCH** (Enterprise-tier check) |
| FactSet | `https://mcp.factset.com/mcp` | Pro buy/sell-side data terminal | High - if access exists | Low | **WATCH** (paid; only if Greystar covers) |
| LSEG (Refinitiv) | `https://api.analytics.lseg.com/lfa/mcp` | Equity analytics, FTSE/Russell factor data | Medium - duplicates Morningstar coverage somewhat | Low | **WATCH** (paid; pick one of LSEG or Morningstar, not both) |
| Daloopa | `https://mcp.daloopa.com/server/mcp` | Fundamental extraction from filings (KPIs, segment data) | Low - regime-trader is technical/regime, not fundamental | Low | **PASS** (revisit only if a fundamental subsystem is added; anti-goal until existing two have 30d track record) |
| Moody's | `https://api.moodys.com/genai-ready-data/m1/mcp` | Credit ratings, default data, macro risk | Medium - credit-cycle macro signal | Low | **PASS** for now (regime-trader does not consume credit-cycle data; reopen if added) |
| PitchBook | `https://premium.mcp.pitchbook.com/mcp` | Private market data | None | None | **PASS** (out of scope; anti-goal) |
| Chronograph | `https://ai.chronograph.pe/mcp` | PE portfolio monitoring | None | None | **PASS** (out of scope) |
| Egnyte | `https://mcp-server.egnyte.com/mcp` | Secure file collaboration | None | None | **PASS** (not a data source) |

## Operator Action Items

Two ADOPT vendors and four WATCH vendors are worth a 15-minute access check. Order them by expected lift:

1. **MT Newswires** - real-time wire complements current `pwm` Sonar news-sync (Sprint 26). If accessible, news latency for both Polymarket and equity entries drops materially. Test: try the endpoint cold, see if it asks for a key.
2. **Aiera** - earnings event windows are highest-edge events for equities; transcript summaries land before sell-side notes. Test: same as above.
3. **Kensho Kfinance** - most likely covered by Greystar Anthropic Enterprise tier (S&P is a common enterprise partner). Test: try once with no auth, then via Anthropic-managed credentials.
4. **Morningstar** - factor data would directly feed the Multi-Factor Rotation regime documented in `trading-research-2025-2026.md` as Tier-1 strategy. Worth the access check even if it ends in PASS.
5. **FactSet / LSEG** - low priority; only if Greystar already pays for one. Pick the one with overlap to current Greystar entitlements rather than adopting both.

Decline path is symmetric: any vendor that requires a personal paid subscription gets a PASS until claudeclaw's two existing strategies have a 30-day track record (per CLAUDE.md anti-goal).

## Wiring Pattern

The anthropics repo wires each vendor as a plain HTTP MCP entry in `.mcp.json`, mirroring the current `financial-datasets` block. A staged-on example lives at `.mcp.json.example` at repo root - copy individual blocks into `.mcp.json` once access is verified, never the whole file at once. Auth typically arrives via environment variables or vendor-managed OAuth at the URL endpoint; nothing here puts credentials in the file itself.

The example file is staged-off intentionally. Adding an MCP server expands the available tool surface for any session, and a poorly-scoped finance MCP is a real prompt-injection vector (sees a "system_message" field in a returned news headline, treats it as instruction). Per `TRUST.md` prompt-injection defense, any new MCP server gets one paper-mode session of probing before going into the live `.mcp.json`.

## What This Does Not Include

- **The `agent.yaml` Managed Agent cookbook pattern** from `managed-agent-cookbooks/`. Worth studying if claudeclaw ever splits across surfaces (Telegram + headless scheduled jobs), but `dist/schedule-cli.js` already handles the scheduled-jobs surface, so this is premature. Defer.
- **The analyst skills** (DCF, LBO, IC memo, comps). These produce analyst work product staged for human sign-off; not signals.
- **Microsoft 365 add-in install tooling**. Not your stack.
- **Partner-built plugins** (LSEG, S&P Global). Adopt the underlying MCP endpoint above; do not install partner plugins (extra surface area for no marginal benefit).

## How This Changes Our Code/Strategy

No code changes today. This doc is a vendor map plus an `.mcp.json.example` reference. The next concrete steps are operator-side access checks (above), then per-vendor probing sprints:

- A "Sprint NN - aiera-event-window" or "Sprint NN - mt-newswires-augment" would each touch news ingestion paths under `src/poly/news-sync*` and trigger the pre-commit research-check, so they get their own sprint notes when proposed.
- Adoption never goes straight to live without one paper-mode session per the wiring-pattern caveat above.

Until those sprints land, the only operational change is: when researching trades, prefer the wider catalog over Sonar-only context if any of the WATCH vendors come back accessible. The `financial-research-agent-prompts.md` templates stay valid; swap the source line from "Financial Datasets MCP" to the appropriate provider per task.
