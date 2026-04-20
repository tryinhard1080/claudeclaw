# MISSION — Current Quarter

## North Star

Build a trading system that **earns its right to trade real money** by demonstrating profitability and reliability on paper across multiple market regimes.

## Q2 2026 Objectives

1. **Polymarket Phase C runs unattended for 30 consecutive days** with zero unplanned restarts.
2. **Statistically meaningful sample of resolved trades** (target: ≥50 settled positions) so we can compute real win rate, average edge captured, and Sharpe.
3. **One refined strategy per market** — Polymarket has the AI-probability strategy; equities flow through regime-trader. Don't add a third until both have a track record.
4. **Research foundation built** — codified knowledge base on quant techniques, Polymarket microstructure, prompt strategies for prediction markets, and risk frameworks. Stored as durable docs we can revisit.

## Out of Scope (declined work)

- Personal assistant features (gmail, calendar, todos, profile management, generic chat).
- New asset classes (crypto spot/perps, options, futures) until equities + Polymarket are stable.
- Web UI / standalone dashboard beyond the existing `:3141` health endpoint.
- Multi-tenant or multi-user features. One operator, one bot.
- Auto-scaling capital from realized P&L. Human approves capital changes.

## Real-Money Gate

Before any real-money trading is enabled on either system, ALL of these must be true:

- [ ] 30+ consecutive days of paper trading without manual intervention.
- [ ] ≥50 resolved Polymarket trades with positive realized P&L.
- [ ] Equity strategies (regime-trader) have positive paper Sharpe over ≥60 days.
- [ ] Drawdown never exceeded `POLY_HALT_DD_PCT` during paper period.
- [ ] No P0/P1 codex-review findings outstanding.
- [ ] Documented kill-switch and roll-back procedure tested.
- [ ] Operator (Richard) has explicitly signed off in writing in this file.

Don't lobby for any of these to be waived. They exist to prevent ruin.

## Definition of Done (per change)

A change is "done" when:
1. Code merged to main with descriptive commit message.
2. Tests cover the new behavior + a regression test for the bug being fixed.
3. Codex review has been run and findings triaged.
4. `dist/` rebuilt and `pm2 restart claudeclaw` applied.
5. Memory + relevant docs updated.

Anything less is a draft.

## Operator Sign-Off Log

(Date — Decision — Reason)

- _2026-04-13_ — Pivot to trading-only identity (this MISSION + SOUL + HEARTBEAT) — "make this a first class trading bot, single focus".
- _2026-04-20_ — Authorized restart on GLM 5.1 subscription after $150 Anthropic API spend incident. Keys retained (private repo, acceptable). Stage 3 eval showed GLM more calibrated than pre-halt Claude (which was hallucinating 2025 data). 30-day gate-box-1 clock starts now. — "A" (restart now option selected in Phase 0.5 Stage 4 decision).
