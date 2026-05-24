# Full Trading Bot Research Pass

Date: 2026-05-22
Purpose: identify current external data, strategy, regulatory, and architecture inputs that move ClaudeClaw toward real-money readiness without bypassing `MISSION.md`.

## Verdict

ClaudeClaw should not pivot away from its current two-system design. It should harden the design into:

1. A stock trader that keeps the existing regime-trader bridge, but benchmarks it against a simple volatility-targeted momentum baseline before live money.
2. A Polymarket trader that treats market prices as the prior, not the enemy, and only trades calibrated, source-backed deviations.
3. A data plane that tracks source freshness, market data quality, news/macro/filing availability, and gate progress every day.

Real-money enablement remains blocked until the `MISSION.md` gate closes and Richard signs the operator log.

## Key Current Facts From Web Search

### Polymarket real-money path for a US operator is now separate

Polymarket International docs still list the United States as blocked for order placement and instruct builders to check the geoblock endpoint before trading. The same docs say Gamma and Data APIs are public, CLOB read endpoints are public, and CLOB trading endpoints require authentication.

Polymarket US is a separate CFTC-regulated Designated Contract Market. Its docs show:

- Public market data through `https://gateway.polymarket.us`.
- Authenticated trading through `https://api.polymarket.us`.
- Market and private WebSockets through `wss://api.polymarket.us/v1/ws/markets` and `/v1/ws/private`.
- API key setup after identity verification.
- USD-denominated order examples through the `polymarket-us` SDK.

Implication: the current international Gamma/CLOB scanner can remain valid for research and paper simulations, but any US real-money adapter must be a separate Polymarket US venue, not a live switch on the existing international CLOB path.

Sources:

- Polymarket International API overview: https://docs.polymarket.com/api-reference/introduction
- Polymarket International geoblock docs: https://docs.polymarket.com/api-reference/geoblock
- Polymarket US overview: https://www.polymarketexchange.com/
- Polymarket US quickstart: https://docs.polymarket.us/getting-started/quickstart
- Polymarket US API introduction: https://docs.polymarket.us/api-reference/introduction
- Polymarket US WebSocket overview: https://docs.polymarket.us/api-reference/websocket/overview

### Polymarket strategy should be market-price-first

Prediction market literature supports using binary market prices as probability estimates, with bias caveats. Wolfers and Zitzewitz find prices usually close to mean beliefs. The Economic Journal paper on calibration finds time to expiration can affect forecasting accuracy and push favorite/longshot bias. That supports ClaudeClaw's current direction: measure Brier score, constrain time-to-resolution, and avoid treating large model-vs-market gaps as automatically exploitable.

Implication: keep `ai-probability` as an estimator, but calibrate it against market price and resolved outcomes. The live strategy should be "market prior plus small, source-backed, calibrated adjustment", not "LLM says 72 percent and market says 55 percent, buy".

Sources:

- NBER, "Interpreting Prediction Market Prices as Probabilities": https://www.nber.org/papers/w12200
- Economic Journal, "Do Prediction Markets Produce Well-Calibrated Probability Forecasts?": https://academic.oup.com/ej/article-pdf/123/568/491/26445200/ej0491.pdf

### Stock strategy should be benchmarked against simple trend and volatility controls

The strongest broadly replicated systematic equity-adjacent evidence remains trend/momentum plus volatility scaling and risk control. Moskowitz, Ooi, and Pedersen document time-series momentum across asset classes. Follow-up work warns that some performance is driven by volatility scaling, which is itself useful for risk control. That argues for a boring benchmark inside ClaudeClaw:

- SPY or ETF-only trend filter.
- Volatility-targeted sizing.
- Cash or reduced exposure in adverse regimes.
- Daily, not hyperactive intraday, decision cadence unless live evidence proves otherwise.

Implication: do not replace regime-trader today. Add a shadow benchmark so we can tell whether the HMM/regime logic beats a simple baseline after transaction costs, slippage, and drawdown.

Sources:

- Moskowitz, Ooi, Pedersen, "Time Series Momentum": https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2089463
- ScienceDirect, "Time series momentum and volatility scaling": https://www.sciencedirect.com/science/article/pii/S1386418116301379
- AQR trend following research: https://www.aqr.com/insights/trend-following

### LLM trading agents need audit and perturbation tests

TradingAgents shows value in specialist roles: fundamental analyst, sentiment analyst, technical analyst, bull/bear researchers, risk manager, and trader. TradeTrap warns that LLM trading agents can be pushed into concentration, runaway exposure, and drawdown by perturbations in market intelligence, strategy formulation, ledger, or execution components. A 2026 evidence-map paper frames LLM trading agents as audit-oriented decision pipelines.

Implication: ClaudeClaw should use LLMs as analysts and challenger agents. Execution must stay deterministic. Before real money, add adversarial perturbation tests around source freshness, market price spikes, stale order books, duplicate positions, and bad headlines.

Sources:

- TradingAgents arXiv: https://arxiv.org/abs/2412.20138
- TradeTrap arXiv: https://arxiv.org/abs/2512.02261
- Agentic Trading evidence map: https://arxiv.org/abs/2605.19337

### Equity market data quality matters before live money

Alpaca paper trading is available and its trading API supports live brokerage accounts. Alpaca Market Data Basic is free, but for equities it is limited to IEX real-time coverage and delayed historical data; all-US-stock-exchange coverage requires the paid Algo Trader Plus tier in the docs. Alpaca also provides historical news from Benzinga and real-time news over WebSockets.

Implication: for real-money equity trading, decide explicitly whether IEX-only data is acceptable. For a production live stock trader, the safer answer is to either use all-exchange SIP-quality data through Alpaca's paid tier or a separate market data provider, then record that choice in `MISSION.md`.

Sources:

- Alpaca Trading API: https://docs.alpaca.markets/us/docs/trading-api
- Alpaca Market Data API: https://docs.alpaca.markets/us/docs/about-market-data-api
- Alpaca News API docs: https://docs.alpaca.markets/us/docs/historical-news-data

### Official macro and filings feeds are enough for first-stage daily context

For daily context, use official low-cost sources first:

- FRED for macro series, release dates, updates, and vintage dates.
- SEC EDGAR APIs and RSS feeds for submissions and XBRL facts, with fair-access limits.
- BLS API for CPI, employment, wages, productivity, and release schedules.
- Alpaca/Benzinga news for ticker-tagged headlines.
- Perplexity/Sonar or other web search only to summarize and discover, not as a canonical data store.

Sources:

- FRED API docs: https://fred.stlouisfed.org/docs/api/fred/fred/
- SEC developer resources: https://www.sec.gov/about/developer-resources
- BLS Public Data API: https://www.bls.gov/bls/api_features.htm

## Strategy Recommendation

### Polymarket

Keep the current `ai-probability` approach, but narrow its job:

1. Market price is the prior.
2. LLM model is a structured analyst that may propose an adjustment.
3. Adjustment is capped unless it is backed by source freshness and historical calibration.
4. Trade only when:
   - spread and liquidity pass;
   - TTL is inside the proven band;
   - source freshness passes;
   - model confidence is not low;
   - Brier/calibration for the relevant bucket is acceptable.

Near-term research-backed refinements:

- Make the TTL shadow report the Box 2 decision driver.
- Add favorite/longshot bias tracking by price bucket.
- Add source-freshness features to each signal: macro last seen, news last seen, market data last seen, order book last seen.
- Add a "market prior delta cap" so a single LLM estimate cannot create an oversized edge without historical support.

### Equities

Keep regime-trader as the active paper system, but add a shadow benchmark:

1. Baseline: SPY trend/momentum plus volatility target and cash risk-off.
2. Compare daily against regime-trader:
   - cumulative return;
   - daily return;
   - rolling Sharpe;
   - max drawdown;
   - turnover;
   - rejected signals.
3. Require regime-trader to beat the baseline after costs before live money.

This does not add a third live strategy. It adds a measuring stick.

## Data Plane Needed For A Full-Fledged Bot

| Source | Use | Cadence | Auth | Direct signal? |
|---|---|---:|---|---|
| Polymarket US public API | US market discovery, books, BBO | 1 to 5 min plus WebSocket | no for public | no |
| Polymarket US authenticated API | eventual live orders, balances, positions | live only after gate | yes, after KYC | yes, after sign-off |
| Polymarket International public APIs | research and current paper scanner compatibility | 5 min plus WebSocket later | no for public | paper only |
| Alpaca Trading API | equity paper/live order path | market hours | yes | yes, after sign-off |
| Alpaca Market Data | bars, quotes, news | live plus daily | yes | context and execution pricing |
| FRED | macro regime context | daily, event releases | API key | context |
| BLS | CPI/jobs/wage data | release days | no basic, key for higher limits | context |
| SEC EDGAR | filings and company events | 5 to 15 min for watched tickers | no, user-agent required | context |
| Perplexity/Sonar | broad web search and synthesis | scheduled plus ad hoc | yes if using paid path | context |
| AQR/arXiv/RSS feeds | research backlog | daily or weekly | no | no |

## Real-Money Readiness Additions

Before live money, build these in order:

1. Gate dashboard: one view for Box 1 through Box 7, paper P&L, Sharpe days, Polymarket resolved count, drawdown, and operator sign-off status.
2. Source freshness ledger: each signal records which data sources were fresh enough and which were stale.
3. Polymarket US adapter research sprint: separate from international CLOB, no order placement at first.
4. Equity data-quality decision: IEX-only free data versus paid all-exchange data.
5. Shadow equity baseline: volatility-targeted momentum benchmark.
6. Adversarial trading-agent tests: stale data, bad headline, duplicate order, crossed book, wide spread, sudden gap.
7. Live tiny-capital rollout plan: dry-run live adapter, one-share or one-contract max, hard daily loss kill, manual sign-off line.

## How this changes our code/strategy

Do not replace the current strategy today. The next code should improve measurement and data readiness: source freshness per signal, gate progress dashboard, Polymarket US paper/public adapter research, and an equity baseline benchmark. The current Polymarket strategy becomes market-prior-first and calibration-governed; the current equity strategy must prove it beats a simple volatility-targeted trend benchmark before real money.

