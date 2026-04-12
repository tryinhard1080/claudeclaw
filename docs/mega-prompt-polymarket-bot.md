# Mega Prompt: Polymarket Prediction Market Trading Bot

> **Target**: Claude Code (autonomous agent mode) integrated with ClaudeClaw Telegram bot
> **Framework**: Multi-Agent Pipeline with Bull/Bear Debate + Fractional Kelly Sizing
> **Strategy**: Portfolio of strategies (information edge + domain specialization + smart consensus), NOT naive copy trading
> **Status**: Blueprint -- paper trade 200+ trades before any live capital

---

## PROMPT

```
You are building a Polymarket prediction market trading system integrated with ClaudeClaw, an existing Node.js/TypeScript Telegram bot. This is NOT a simple copy trading bot. You are building a multi-strategy, multi-agent system that trades prediction markets using AI-augmented probability estimation, domain specialization, and smart consensus signals.

Before you write a single line of trading logic, internalize this: 84% of Polymarket traders lose money. Only 0.033% capture the majority of profits. The leaderboard is survivorship bias incarnate. If you don't have a quantifiable edge, you ARE the liquidity being extracted.

## ═══════════════════════════════════════════════════
## SECTION 1: CONTEXT & CALIBRATION
## ═══════════════════════════════════════════════════

### 1.1 Market Reality

Hard numbers from verified research (Sergeenkov study, March 2026; TU Berlin 2025):

| Metric | Value |
|--------|-------|
| Traders who lose money | 84.1% |
| Profitable above $1K | 2% of 2.5M traders |
| Profitable above $10K | 0.32% |
| Top profit concentration | 0.033% capture majority |
| Arb window (2024) | 12.3 seconds |
| Arb window (Q1 2026) | 2.7 seconds |
| Bot-captured arb profits | 73% go to sub-100ms bots |

### 1.2 What Separates Winners from Losers

The consistently profitable traders (Domer, Theo, WindWalk3, HyperLiquid0xb) share these traits:

1. **EV discipline** -- They optimize for expected value per trade, not win rate. Domer (#1 all-time, ~$300M volume, $2.5M+ net profit, ex-poker player): "Bet in accordance with your edge. If you don't find an edge, don't bet. If you find what you think is a big edge, bet a lot."

2. **Domain expertise** -- WindWalk3 made $1.1M+ from RFK Jr. predictions alone. HyperLiquid0xb made $1.4M dominating sports markets. They don't bet on everything. They crush narrow verticals where they have information advantages.

3. **Proprietary information** -- Theo ("French Whale") netted ~$50M from the 2024 Trump election by commissioning private "neighbor polls" (asking people how their neighbors would vote, reducing social desirability bias). He identified a massive mispricing and made 450+ distinct bets on one thesis.

4. **Volume + breadth** -- Domer trades 5,000+ markets. Not every trade is a winner, but statistical edge compounds across thousands of trials.

5. **Position sizing discipline** -- Scale bets proportional to perceived edge strength. Never risk more than you can afford to lose on any single market.

### 1.3 Expected Returns (be honest)

| Strategy | Realistic Range | Conditions |
|----------|----------------|------------|
| Structural arbitrage | 1.5-3% per trade | Opportunities shrinking rapidly |
| AI-augmented directional | 20-40% annualized | Favorable conditions, high variance |
| Market making | 1-3% monthly | Requires deep CLOB understanding |
| Naive copy trading | Negative EV | Slippage, delay, survivorship bias |
| Multi-model consensus | Unknown but promising | 37% of AI wallets show positive P&L vs <16% human |

DO NOT promise returns. DO NOT show cherry-picked results. Track everything, report honestly, and let the data speak.

### 1.4 Why Copy Trading Alone Fails

The Bullpen CLI video approach (copy top leaderboard traders at $5/trade) fails for 5 specific reasons:

1. **Price impact** -- The whale buys at $0.40-0.48, pushing price to $0.48-0.50 before copiers enter. In binary markets, 2-3 cents of slippage dramatically reduces EV.
2. **Signal delay** -- Blockchain indexing + API polling + execution latency = always behind.
3. **Front-running** -- MEV bots and faster copiers front-run your copy trades.
4. **Bait signals** -- Whales may intentionally signal one direction, then reverse after copiers pile in.
5. **Context loss** -- You copy the WHAT but not the WHY. Without understanding the thesis, you can't size correctly or know when to exit.

The fix: Don't copy trades. Copy INTELLIGENCE. Use whale activity as one signal among many, filtered through your own probability estimation.


## ═══════════════════════════════════════════════════
## SECTION 2: STRATEGY PORTFOLIO
## ═══════════════════════════════════════════════════

Never rely on a single strategy. Edges decay. Competition intensifies. The sustainable approach is a portfolio of uncorrelated strategies with continuous development of new edges.

### 2.1 PRIMARY: AI-Augmented Information Edge

**What**: Use multi-model LLM ensemble (Claude + Gemini + GPT) to estimate true probabilities better than the market consensus.

**Why this works**: Polymarket prices update in minutes, not milliseconds like equities. News edges persist longer. AI can synthesize more sources faster than any human.

**How**:
1. For each candidate market, build a structured research context:
   - News feeds (RSS + API, site-restricted: bls.gov for macro, sec.gov for corporate, fec.gov for elections)
   - Social sentiment (Reddit r/polymarket, Twitter/X keyword tracking, FinBERT analysis)
   - Historical resolution patterns for similar markets
   - Current orderbook depth and price trajectory
2. Feed identical context to 3 independent LLMs. Each returns:
   - Probability estimate (0.00 to 1.00)
   - Confidence score (low/medium/high)
   - Key reasoning (2-3 sentences)
   - Contrarian evidence found (what argues AGAINST this position)
3. Consensus filter: Only proceed when 2/3 models agree within 5 percentage points
4. Edge calculation: `estimated_probability - market_price = edge`. Minimum edge threshold: 8%
5. If edge exists and passes risk checks, size position via fractional Kelly and execute

**Expected edge**: Multi-model consensus reduces hallucination risk. Site-restricted contrarian searches force disconfirming evidence. The combination is the closest thing to a systematic information advantage.

**When to use**: Any market where news, data, or analysis can inform probability estimation. Best for politics, macro events, crypto governance, tech/AI developments.

**When NOT to use**: Pure randomness markets (coin flips, weather extremes), sports markets where domain experts have decades of data you can't match quickly.

### 2.2 SECONDARY: Domain Specialization

**What**: Pick 2-3 market categories and go deep. Build specialized knowledge, data pipelines, and models for those categories only.

**Why this works**: WindWalk3 made $1.1M from one political niche. HyperLiquid0xb made $1.4M in sports. Specialization beats generalism because:
- Fewer competitors in niche markets
- Deeper context for probability estimation
- Pattern recognition improves with volume
- You can identify mispricings faster than generalists

**Recommended starting categories** (based on market depth + AI suitability):
1. **Crypto/DeFi governance** -- AI can track on-chain proposals, voting patterns, developer activity
2. **US politics/policy** -- Rich data landscape (polling, FEC filings, legislative tracking)
3. **Tech/AI developments** -- Model releases, regulatory actions, company earnings

**How**:
1. Build category-specific data pipelines (RSS feeds, API monitors, social trackers)
2. Maintain a "category model" -- running probability estimates for all active markets in your categories
3. Alert when market price diverges >10% from your model estimate
4. Track resolution accuracy per category to measure and refine your edge

### 2.3 TERTIARY: Smart Consensus Trading (NOT naive copy trading)

**What**: Track 10+ consistently profitable traders. Only enter when 3+ independently agree on direction AND your own probability model confirms.

**Why this is different from naive copy trading**:
- Multi-trader consensus (not single-trader copying)
- Size/liquidity filters (ignore exploratory trades below threshold)
- Price movement filter (skip if entry price moved >3% since signal)
- Independent verification (your model must agree)
- Portfolio-level correlation check (don't stack correlated bets)

**How**:
1. Identify 10-15 traders with: 100+ trade history, consistent profitability over 3+ months, diverse market exposure (not one-hit wonders)
2. Monitor their activity via Bullpen CLI tracker or direct CLOB API
3. When 3+ tracked traders independently enter the same market in the same direction within 24 hours:
   a. Run your own probability estimation (Section 2.1 pipeline)
   b. If your model agrees (edge > 5%), enter position
   c. If your model disagrees, log as "consensus divergence" for later analysis
4. Size at 50% of what your standalone model would suggest (reduced confidence since you're partly following)

**Trader evaluation criteria** (to avoid survivorship bias):
- Minimum 100 trades (statistical significance)
- Win rate across diverse markets (not concentrated in one event)
- Consistency over months (not single-month spikes)
- Profit per market category (confirms genuine edge, not luck)
- Capital risked relative to profit (ROI, not just absolute P&L)

### 2.4 OPPORTUNISTIC: Cross-Platform Arbitrage

**What**: Exploit price disparities between Polymarket, Kalshi, PredictIt, and Robinhood for the same underlying event.

**Reality check**: Arb windows are now 2.7 seconds and 73% of profits go to sub-100ms bots. This is NOT viable as a primary strategy for us. But occasionally large mispricings appear (documented: 7.5% on BTC event mismatch, $40M+ extracted 2024-2025).

**How**: Monitor price feeds across platforms. Alert when YES+NO prices across platforms create >2% risk-free profit after fees/gas. Execute only when the opportunity persists for >30 seconds (filters out speed-game arbs we can't win).

### 2.5 OPPORTUNISTIC: Liquidity Provision / Market Making

**What**: Post resting limit orders on both sides of a market, earn spread plus Polymarket liquidity rewards ($5M+ distributed April 2026).

**Performance**: 78-85% win rate documented, 1-3% monthly, $700-800/day for automated systems.

**Risks**: Inventory risk (getting adversely filled), spread compression traps (manipulators compress spreads then execute against your orders), reward program changes.

**Prerequisites**: Deep understanding of CLOB mechanics, sophisticated quoting logic, real-time risk management. This is NOT beginner-friendly. Implement only after the primary strategies are validated.

### 2.6 OPPORTUNISTIC: High-Probability Bonds

**What**: Buy near-certain outcomes (>95% implied probability) for bond-like yields.

**Example**: Market "Will the sun rise tomorrow?" at YES=$0.97. Buy YES, wait for resolution, collect $0.03 per share (3% yield in hours/days). Annualized: potentially 1800%+ but rarely available.

**Risk**: Black swan events. The one time a "sure thing" fails, you lose the entire position. Use only with strict position limits and only for genuinely near-certain outcomes.


## ═══════════════════════════════════════════════════
## SECTION 3: MULTI-AGENT ARCHITECTURE
## ═══════════════════════════════════════════════════

Inspired by TradingAgents (Tauric Research, arXiv:2412.20138) and the Fully-Autonomous Polymarket Bot (dylanpersonguy). The key innovation: adversarial bull/bear debate forces consideration of disconfirming evidence before any trade passes to execution.

### 3.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA LAYER (always running)                  │
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ News Monitor │ │ Polymarket   │ │ Social       │ │ On-Chain   │ │
│  │ (RSS + APIs) │ │ WebSocket    │ │ Monitor      │ │ Whale      │ │
│  │              │ │ (orderbook,  │ │ (Reddit, X,  │ │ Tracker    │ │
│  │ BLS, SEC,    │ │  prices,     │ │  FinBERT     │ │ (wallet    │ │
│  │ FEC, news    │ │  trades)     │ │  sentiment)  │ │  activity) │ │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └─────┬──────┘ │
│         └────────────────┴────────────────┴───────────────┘         │
│                              │ structured context                   │
├──────────────────────────────┼──────────────────────────────────────┤
│                        SIGNAL LAYER                                 │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │              Multi-Model Ensemble                              │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                       │  │
│  │  │ Claude  │  │ Gemini  │  │  GPT    │  Each returns:        │  │
│  │  │ (prob,  │  │ (prob,  │  │ (prob,  │  - probability        │  │
│  │  │  conf,  │  │  conf,  │  │  conf,  │  - confidence         │  │
│  │  │  reason,│  │  reason,│  │  reason,│  - reasoning          │  │
│  │  │  contra)│  │  contra)│  │  contra)│  - contrarian evidence│  │
│  │  └────┬────┘  └────┬────┘  └────┬────┘                       │  │
│  │       └────────────┼────────────┘                             │  │
│  │                    │ consensus (2/3 agree within 5pp)         │  │
│  └────────────────────┼──────────────────────────────────────────┘  │
│                       │                                             │
│  ┌────────────────────▼──────────────────────────────────────────┐  │
│  │           Contrarian Research Engine                           │  │
│  │  Site-restricted searches for disconfirming evidence          │  │
│  │  "What could make this position WRONG?"                      │  │
│  └────────────────────┬──────────────────────────────────────────┘  │
│                       │                                             │
├───────────────────────┼─────────────────────────────────────────────┤
│                 DECISION LAYER (sequential pipeline)                │
│                       │                                             │
│  ┌────────────────────▼──────────────────────────────────────────┐  │
│  │  4 ANALYST AGENTS (parallel)                                  │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────┐ ┌────────────┐ │  │
│  │  │ Fundamental  │ │ Sentiment   │ │ News    │ │ Technical  │ │  │
│  │  │ (base rates, │ │ (social,    │ │ (RSS,   │ │ (orderbook │ │  │
│  │  │  historical  │ │  FinBERT,   │ │  alerts,│ │  depth,    │ │  │
│  │  │  resolution) │ │  whale      │ │  API    │ │  spread,   │ │  │
│  │  │              │ │  activity)  │ │  feeds) │ │  volume)   │ │  │
│  │  └──────┬───────┘ └──────┬──────┘ └───┬─────┘ └─────┬──────┘ │  │
│  │         └────────────────┴────────────┴──────────────┘        │  │
│  └──────────────────────────┬────────────────────────────────────┘  │
│                             │ analyst reports                       │
│  ┌──────────────────────────▼────────────────────────────────────┐  │
│  │  BULL/BEAR DEBATE (adversarial -- this is the key innovation) │  │
│  │  ┌──────────────────┐     ┌──────────────────┐               │  │
│  │  │ BULL RESEARCHER  │ vs  │ BEAR RESEARCHER  │               │  │
│  │  │ "Why this trade  │     │ "Why this trade  │               │  │
│  │  │  WILL work"      │     │  will FAIL"      │               │  │
│  │  │ - best evidence  │     │ - contrarian data │               │  │
│  │  │ - precedents     │     │ - risk scenarios  │               │  │
│  │  │ - catalysts      │     │ - correlation     │               │  │
│  │  └────────┬─────────┘     └────────┬─────────┘               │  │
│  │           └────────────┬───────────┘                          │  │
│  └────────────────────────┼──────────────────────────────────────┘  │
│                           │ both cases                              │
│  ┌────────────────────────▼──────────────────────────────────────┐  │
│  │  TRADE SYNTHESIZER                                            │  │
│  │  Weighs analyst reports + bull/bear debate                    │  │
│  │  Output: BUY / SELL / HOLD + confidence + rationale           │  │
│  └────────────────────────┬──────────────────────────────────────┘  │
│                           │                                         │
│  ┌────────────────────────▼──────────────────────────────────────┐  │
│  │  RISK MANAGER (3 independent safety gates -- ALL must pass)   │  │
│  │                                                                │  │
│  │  Gate 1: Position limits                                      │  │
│  │    - Max 10% capital per market                               │  │
│  │    - Max 10 concurrent positions                              │  │
│  │    - No correlated positions (same underlying event)          │  │
│  │                                                                │  │
│  │  Gate 2: Portfolio health                                     │  │
│  │    - Total drawdown < 20% (else HALT ALL)                    │  │
│  │    - Daily loss < 5% (else pause new entries)                │  │
│  │    - Sufficient free capital for position size                │  │
│  │                                                                │  │
│  │  Gate 3: Signal quality                                       │  │
│  │    - Edge > 8% (primary) or > 5% (consensus)                │  │
│  │    - Market liquidity sufficient (orderbook depth check)      │  │
│  │    - Time to resolution > 24 hours (avoid last-minute chaos) │  │
│  │    - Price hasn't moved > 5% since signal generation         │  │
│  │                                                                │  │
│  │  ANY gate failure = NO TRADE. Log the rejection with reason. │  │
│  └────────────────────────┬──────────────────────────────────────┘  │
│                           │ approved trade                          │
├───────────────────────────┼─────────────────────────────────────────┤
│                     EXECUTION LAYER                                 │
│                           │                                         │
│  ┌────────────────────────▼──────────────────────────────────────┐  │
│  │  POSITION SIZER (Fractional Kelly)                            │  │
│  │                                                                │  │
│  │  Kelly formula for binary outcomes:                           │  │
│  │    f = (p * b - q) / b                                       │  │
│  │    where p = estimated prob, q = 1-p,                        │  │
│  │          b = (1 - market_price) / market_price               │  │
│  │                                                                │  │
│  │  ALWAYS use 1/4 Kelly (conservative):                        │  │
│  │    position_size = kelly_fraction * 0.25 * available_capital  │  │
│  │                                                                │  │
│  │  Worked example:                                              │  │
│  │    Market: YES at $0.42. You estimate 58% true probability.  │  │
│  │    b = (1 - 0.42) / 0.42 = 1.381                            │  │
│  │    f = (0.58 * 1.381 - 0.42) / 1.381 = 0.276 (27.6%)       │  │
│  │    At 1/4 Kelly: 0.276 * 0.25 = 6.9% of capital             │  │
│  │    With $1000 capital: $69 position                           │  │
│  │                                                                │  │
│  │  HARD CAPS (override Kelly if Kelly says more):              │  │
│  │    - Max $50 per trade during paper trading                  │  │
│  │    - Max 10% capital per trade during live                   │  │
│  │    - Max 50% total capital deployed across all positions     │  │
│  └────────────────────────┬──────────────────────────────────────┘  │
│                           │                                         │
│  ┌────────────────────────▼──────────────────────────────────────┐  │
│  │  EXECUTION STRATEGY SELECTOR                                  │  │
│  │                                                                │  │
│  │  Small orders (<$50): Simple market/limit order               │  │
│  │  Medium orders ($50-500): Limit order at or near best ask    │  │
│  │  Large orders (>$500): TWAP (split across 3-5 intervals)    │  │
│  │                                                                │  │
│  │  Execution via:                                               │  │
│  │  - Phase 0-1: Bullpen CLI (rapid prototyping)                │  │
│  │  - Phase 2+: py-clob-client or TypeScript clob-client        │  │
│  │    (direct CLOB API for lower latency and full control)      │  │
│  └────────────────────────┬──────────────────────────────────────┘  │
│                           │                                         │
├───────────────────────────┼─────────────────────────────────────────┤
│                     MONITORING LAYER                                │
│                           │                                         │
│  ┌────────────────────────▼──────────────────────────────────────┐  │
│  │  Real-time Dashboard (extend ClaudeClaw dashboard at :3141)  │  │
│  │    - Active positions with live P&L                          │  │
│  │    - Signal queue (pending, approved, rejected with reasons) │  │
│  │    - Risk metrics (drawdown, capital utilization, correlation)│  │
│  │    - Trade log (every trade with full context)               │  │
│  │    - Strategy performance breakdown                          │  │
│  │    - Paper vs live mode toggle                               │  │
│  │                                                                │  │
│  │  Telegram Alerts (via ClaudeClaw /poly commands)             │  │
│  │    - New signal fired (market, direction, confidence, edge)  │  │
│  │    - Trade executed (entry price, size, strategy)            │  │
│  │    - Risk breach (which gate, what triggered it)             │  │
│  │    - Daily summary (P&L, win rate, positions, next actions)  │  │
│  │                                                                │  │
│  │  Performance Analytics                                        │  │
│  │    - Sharpe ratio, max drawdown, win rate by category        │  │
│  │    - Edge decay monitoring (is our alpha shrinking?)         │  │
│  │    - Per-strategy attribution (which strategies contribute?) │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Polymarket API Stack

| Layer | URL | Purpose | Auth |
|-------|-----|---------|------|
| Gamma API | gamma-api.polymarket.com | Market discovery, metadata, prices | None |
| CLOB API | clob.polymarket.com | Order placement, orderbook depth | L2 (API key + secret + passphrase) |
| CLOB WebSocket | wss://ws-subscriptions-clob.polymarket.com/ws/ | Real-time orderbook, order status | None |

Rate limit: 60 orders/minute per API key. Hybrid-decentralized: off-chain matching, on-chain settlement on Polygon (chain ID 137).

Auth flow: L1 (EIP-712 wallet signature) to create/derive API keys, then L2 for all trading operations.

### 3.3 Agent Role Specifications

Each agent in the pipeline has a specific role, tools, and output schema:

**Fundamental Analyst Agent**
- Role: Estimate base probability from historical data and domain knowledge
- Tools: PolymarketData API, historical resolution database, category-specific data sources
- Output: { probability: float, confidence: str, reasoning: str, base_rate: float }

**Sentiment Analyst Agent**
- Role: Gauge market sentiment from social media and whale activity
- Tools: Reddit API, Twitter/X search, FinBERT model, Bullpen smart money signals
- Output: { sentiment_score: float, whale_direction: str, social_volume: int, notable_signals: str[] }

**News Analyst Agent**
- Role: Identify breaking news and upcoming catalysts
- Tools: RSS feeds, news APIs, site-restricted web search (BLS, SEC, FEC, etc.)
- Output: { relevant_news: str[], catalyst_timeline: str, impact_assessment: str }

**Technical Analyst Agent**
- Role: Assess orderbook dynamics and price momentum
- Tools: CLOB WebSocket, orderbook depth analysis, volume profile, spread tracker
- Output: { orderbook_imbalance: float, spread_bps: int, volume_trend: str, liquidity_score: float }

**Bull Researcher Agent**
- Role: Make the strongest possible case FOR the trade
- Tools: All analyst reports, web search for supporting evidence
- Output: { thesis: str, evidence: str[], precedents: str[], confidence: float }

**Bear Researcher Agent**
- Role: Make the strongest possible case AGAINST the trade
- Tools: All analyst reports, contrarian web search, risk scenario modeling
- Output: { counter_thesis: str, risks: str[], failure_scenarios: str[], confidence: float }

**Trade Synthesizer Agent**
- Role: Weigh all inputs, produce final trade decision
- Tools: All agent reports, portfolio state, risk parameters
- Output: { action: 'BUY'|'SELL'|'HOLD', market_slug: str, outcome: str, confidence: float, edge_pct: float, rationale: str }

**Risk Manager** (not an LLM agent -- deterministic code)
- Role: Enforce hard rules. No judgment calls. Pure logic.
- Checks: All 3 safety gates (position limits, portfolio health, signal quality)
- Output: { approved: bool, rejections: str[] }


## ═══════════════════════════════════════════════════
## SECTION 4: RISK MANAGEMENT (HARD RULES)
## ═══════════════════════════════════════════════════

These are non-negotiable. They are not guidelines. They are circuit breakers that execute automatically. No override without explicit human approval via Telegram.

### 4.1 Position Sizing

| Rule | Limit | Rationale |
|------|-------|-----------|
| Kelly fraction | 1/4 Kelly (NEVER full, NEVER half) | Full Kelly = theoretically optimal, practically suicidal in binary markets |
| Max per-trade (paper) | $50 | Learning phase -- minimize tuition cost |
| Max per-trade (live) | 10% of capital | Single-trade blowup protection |
| Max total deployed | 50% of capital | Always keep 50% in reserve |
| Min edge threshold (primary) | 8% | Below this, noise dominates signal |
| Min edge threshold (consensus) | 5% | Lower bar because multiple signals confirm |

### 4.2 Portfolio-Level Controls

| Rule | Trigger | Action |
|------|---------|--------|
| Max drawdown | 20% from peak | HALT ALL trading. Manual review required. |
| Daily loss limit | 5% of capital | Pause new entries for 24 hours |
| Max concurrent positions | 10 markets | Queue new signals until position closes |
| Correlation limit | 2 positions max on same underlying theme | Prevent clustered losses |
| Time-to-resolution minimum | 24 hours | Avoid last-minute chaos and manipulation |
| Liquidity minimum | $1000 orderbook depth within 5% of mid | Avoid illiquid traps |

### 4.3 Three Safety Gates (ALL must pass)

```
Signal Generated
    │
    ▼
┌─────────────────────────────────┐
│ GATE 1: Position Limits         │──FAIL──▶ LOG + REJECT
│  - Per-trade size within limits │
│  - < 10 concurrent positions    │
│  - No correlated positions      │
│  - Sufficient free capital      │
└──────────────┬──────────────────┘
               │ PASS
               ▼
┌─────────────────────────────────┐
│ GATE 2: Portfolio Health        │──FAIL──▶ LOG + REJECT
│  - Drawdown < 20%              │
│  - Daily loss < 5%             │
│  - Total deployed < 50%        │
└──────────────┬──────────────────┘
               │ PASS
               ▼
┌─────────────────────────────────┐
│ GATE 3: Signal Quality          │──FAIL──▶ LOG + REJECT
│  - Edge > threshold             │
│  - Orderbook depth sufficient   │
│  - Time to resolution > 24h    │
│  - Price hasn't moved > 5%     │
│    since signal generation      │
│  - Multi-model consensus (2/3) │
└──────────────┬──────────────────┘
               │ ALL PASS
               ▼
         EXECUTE TRADE
```

### 4.4 Emergency Controls

- `/poly halt` -- Immediately pause all trading. Bot stays running but executes no new trades.
- `/poly resume` -- Resume trading after manual review.
- `/poly liquidate` -- Close all open positions at market price (use with extreme caution).
- Auto-halt triggers: 20% drawdown, API errors > 3 consecutive, unexpected market behavior.

### 4.5 Security Rules

- **Dedicated wallet** with limited funds. NEVER use your main crypto wallet.
- **API keys** stored in .env, never committed to git.
- **Audit all third-party code** before running. Malicious Polymarket bots have been found stealing private keys (Dec 2025, Jan 2026 "ClawdBot" typo-squat).
- **Rate limit all API calls** to avoid bans and unexpected costs.
- **No --dangerously-skip-permissions** with real money at stake. Human-in-the-loop for trade execution until system is thoroughly validated.


## ═══════════════════════════════════════════════════
## SECTION 5: CLAUDECLAW INTEGRATION
## ═══════════════════════════════════════════════════

ClaudeClaw already has a complete trading integration for regime-trader (equities). The Polymarket integration follows the same architectural patterns.

### 5.1 Existing Patterns to Reuse

| Pattern | Source File | Reuse For |
|---------|-------------|-----------|
| StatePoller (EventEmitter + polling) | src/trading/state-poller.ts | Poll Polymarket positions, signal queue state |
| TradingAlertManager (rate-limited alerts) | src/trading/alerts.ts | Signal fires, trade executions, risk breaches |
| InstanceController (subprocess mgmt) | src/trading/instance-control.ts | Managing Python trading processes (if using py-clob-client) |
| registerTradingCommands | src/trading/telegram-commands.ts | /poly command registration pattern |
| Scheduler precision timer | src/scheduler.ts | Market monitoring cron jobs, signal polling loops |
| Dashboard API routes | src/dashboard.ts | Polymarket dashboard tab endpoints |
| Orchestrator agent delegation | src/orchestrator.ts | Analyst/researcher/executor agent pipeline |
| Message queue (per-chat FIFO) | src/message-queue.ts | Prevent race conditions on concurrent signals |

### 5.2 New Telegram Commands

Register under `/poly` namespace (parallel to existing `/trade` for regime-trader):

```
/poly status          -- Portfolio overview: balance, positions, P&L, deployed capital %
/poly signals         -- Active signals queue: pending, approved, rejected (with reasons)
/poly execute <id>    -- Manually approve a pending signal (human-in-the-loop mode)
/poly reject <id>     -- Manually reject a pending signal
/poly halt            -- Emergency halt all Polymarket trading
/poly resume          -- Resume after halt
/poly paper on|off    -- Toggle paper trading mode
/poly performance     -- Strategy performance breakdown (P&L by strategy, category, time)
/poly alerts on|off   -- Toggle Telegram notifications
/poly config          -- Show current risk parameters
/poly traders         -- Show tracked traders and their recent performance
```

### 5.3 Dashboard Extension

Add a "Polymarket" tab to the existing ClaudeClaw dashboard (port 3141):

- **Positions view**: Active positions with live P&L, entry price, current price, time to resolution
- **Signal queue**: Pending signals with full context (analyst reports, bull/bear debate summaries)
- **Risk panel**: Current drawdown, capital utilization, correlation map
- **Trade log**: Every trade (paper + live) with full audit trail
- **Strategy performance**: Charts showing P&L by strategy, win rate by category, edge trend over time
- **Controls**: Start/stop trading, paper/live toggle, risk parameter adjustment

### 5.4 Scheduler Integration

Use ClaudeClaw's precision timer scheduler for:

| Cron | Task |
|------|------|
| */30 * * * * | Poll tracked traders for new activity |
| */5 * * * * | Update positions and P&L from Polymarket API |
| 0 * * * * | Run signal pipeline for monitored markets (hourly scan) |
| 0 9 * * * | Morning briefing: overnight market moves, new opportunities, daily risk reset |
| 0 21 * * * | Evening summary: day's trades, P&L, positions, next day's catalysts |
| 0 0 * * 0 | Weekly report: strategy performance, edge analysis, trader rankings update |

### 5.5 Alert System

Extends TradingAlertManager pattern with Polymarket-specific alert types:

| Alert Type | Trigger | Throttle |
|------------|---------|----------|
| signal_fired | New trade signal generated by pipeline | None (always send) |
| trade_executed | Trade successfully placed | None |
| trade_failed | Trade execution error | 5 min per market |
| risk_breach | Any safety gate triggered | 15 min per type |
| drawdown_warning | Drawdown > 10% (warning before 20% halt) | 1 hour |
| position_resolved | Market resolved, position closed | None |
| daily_summary | End of day performance | Once daily |
| edge_decay | Strategy's measured edge dropping below threshold | Once weekly |

### 5.6 Data Flow

```
Polymarket APIs + News + Social
        │
        ▼
  Signal Pipeline (Python or TS)
        │
        ├──▶ signals.json (pending signals with full context)
        ├──▶ trades.json (executed trades with audit trail)
        ├──▶ positions.json (current positions with live P&L)
        └──▶ performance.json (strategy metrics)
        │
        ▼
  ClaudeClaw StatePoller
        │
        ├──▶ Dashboard (real-time via SSE)
        ├──▶ Telegram alerts (rate-limited)
        └──▶ /poly commands (on-demand)
```

This mirrors the regime-trader pattern: the trading system writes state to JSON files, ClaudeClaw polls and displays. Clean separation of concerns.


## ═══════════════════════════════════════════════════
## SECTION 6: IMPLEMENTATION PHASES
## ═══════════════════════════════════════════════════

### Phase 0: Study & Setup (1-2 days)

**Goal**: Understand the ecosystem before building anything.

Tasks:
1. Clone and study key repos:
   - `Polymarket/agents` (official AI agent framework)
   - `Polymarket/py-clob-client` (official Python SDK)
   - `dylanpersonguy/Fully-Autonomous-Polymarket-AI-Trading-Bot` (most complete OSS bot)
   - `TauricResearch/TradingAgents` (multi-agent framework for bull/bear debate pattern)
2. Install Bullpen CLI for rapid prototyping: `brew install BullpenFi/tap/bullpen`
3. Set up Polymarket account + dedicated wallet with small funds ($100-200 for testing)
4. Run `bullpen polymarket approve` and `bullpen polymarket preflight`
5. Manually explore: discover markets, check orderbooks, place a few test trades
6. Read Polymarket CLOB documentation: https://docs.polymarket.com
7. Set up API keys (L1 wallet sig -> L2 API key derivation)

**Exit criteria**: Can manually discover markets, read orderbooks, and place trades via CLI.

### Phase 1: Data Pipeline (3-5 days)

**Goal**: Build the data layer that feeds the signal pipeline.

Tasks:
1. Market discovery: Automated pipeline to find active markets, categorize them, track resolution timelines
2. Price feeds: WebSocket connection for real-time orderbook data
3. News aggregation: RSS feeds + API monitors for relevant news sources
4. Social monitoring: Reddit r/polymarket + Twitter/X keyword tracking
5. Whale tracking: Monitor tracked traders' activity (Bullpen CLI tracker initially)
6. Historical data: Download and index historical market data from PolymarketData.co for backtesting
7. Data storage: SQLite tables for markets, prices, signals, trades, positions, performance

**Exit criteria**: Data pipeline running, populating market data, news, and social signals into local database.

### Phase 2: Signal Engine (5-7 days)

**Goal**: Build the multi-agent signal generation pipeline.

Tasks:
1. Multi-model ensemble: Implement Claude + Gemini + GPT probability estimation with structured prompts
2. Consensus filter: Require 2/3 model agreement within 5 percentage points
3. Contrarian research engine: Site-restricted searches for disconfirming evidence
4. Bull/bear debate: Implement adversarial researcher pattern
5. Risk manager: Implement all 3 safety gates as deterministic code (NOT LLM-based)
6. Position sizer: Fractional Kelly calculator with hard caps
7. Backtest the signal engine against historical data (PolyBackTest or local backtester)
8. Measure: edge distribution, win rate, false positive rate across categories

**Exit criteria**: Signal engine generating probability estimates with measured accuracy against historical data. Documented edge > 5% on at least 2 categories.

### Phase 3: Paper Trading (2-4 weeks)

**Goal**: Validate the system with real market conditions but no real money.

Tasks:
1. Connect signal engine to paper trading execution (simulate trades against live prices)
2. Run for minimum 200+ trades across multiple categories
3. Track all metrics: win rate, P&L, drawdown, Sharpe ratio, per-strategy attribution
4. Integrate with ClaudeClaw: /poly commands, dashboard tab, Telegram alerts
5. Iterate on signal quality based on results
6. Statistical validation: 95% confidence interval on measured edge via bootstrapping

**Exit criteria**: 200+ paper trades completed. Measured positive edge with statistical significance. All ClaudeClaw integrations working. Risk controls validated.

### Phase 4: Live Trading -- Small Capital (ongoing)

**Goal**: Go live with minimal capital and full risk controls.

Tasks:
1. Fund dedicated wallet with $200-500 (money you're willing to lose entirely)
2. Start with primary strategy only (AI-augmented information edge)
3. Human-in-the-loop for first 50 live trades (/poly execute to approve each signal)
4. After 50 successful live trades: enable autonomous execution for signals above high-confidence threshold
5. Gradually add secondary strategies as primary is validated
6. Monitor edge decay weekly -- if measured edge drops below 3%, pause and investigate

**Exit criteria**: Positive live P&L after 100+ trades. Risk controls never breached. System running autonomously with Telegram oversight.

### Phase 5: Optimization (ongoing)

**Goal**: Continuous improvement and edge maintenance.

Tasks:
1. Performance attribution: Which strategies contribute most? Which categories? Which time periods?
2. Edge monitoring: Is our alpha shrinking? Are competitors catching up?
3. New strategy development: Research and backtest new approaches
4. Model updates: Retrain/tune probability estimation as market conditions evolve
5. Infrastructure improvements: Migrate from Bullpen CLI to direct CLOB API if latency matters
6. Consider market making / liquidity provision if directional strategies are validated

**Exit criteria**: None -- this is ongoing. The market evolves, so must we.


## ═══════════════════════════════════════════════════
## SECTION 7: REFERENCE LIBRARY
## ═══════════════════════════════════════════════════

### 7.1 Key Repositories

| Repo | Purpose | Priority |
|------|---------|----------|
| Polymarket/agents | Official AI agent framework -- safest starting point | P0 |
| Polymarket/py-clob-client | Official Python SDK for CLOB API | P0 |
| Polymarket/clob-client | Official TypeScript SDK for CLOB API | P0 |
| dylanpersonguy/Fully-Autonomous-Polymarket-AI-Trading-Bot | Most complete OSS bot (multi-model, 15+ risk checks, dashboard) | P1 |
| TauricResearch/TradingAgents | Academic multi-agent framework (bull/bear debate pattern) | P1 |
| HKUDS/AI-Trader | 13k stars, collective intelligence, Polymarket paper trading | P1 |
| evan-kolberg/prediction-market-backtesting | NautilusTrader fork with Polymarket adapter | P1 |
| warproxxx/poly-maker | Market making bot reference | P2 |
| ent0n29/polybot | Java microservices architecture reference | P2 |
| Naeaerc20/Polymarket-Multi-Strategy-Bot | Multi-strategy reference (DCA + arb) | P2 |
| aarora4/Awesome-Prediction-Market-Tools | Curated ecosystem list | P2 |
| ahollic/polymarket-architecture | CLOB/CTF architecture documentation | P2 |

### 7.2 API Documentation

| Resource | URL | Purpose |
|----------|-----|---------|
| Polymarket CLOB Docs | docs.polymarket.com | Order placement, authentication, rate limits |
| Gamma API | gamma-api.polymarket.com | Market discovery, metadata, prices |
| CLOB WebSocket | wss://ws-subscriptions-clob.polymarket.com/ws/ | Real-time data |
| Bullpen CLI Docs | cli.bullpen.fi | CLI reference for rapid prototyping |
| Polymarket Help Center | help.polymarket.com | Liquidity rewards, platform rules |

### 7.3 Data & Backtesting

| Resource | URL | Data Type |
|----------|-----|-----------|
| PolyBackTest | polybacktest.com | Historical orderbook at 1-min resolution, strategy backtesting |
| PolymarketData.co | polymarketdata.co | Prices, orderbooks, metrics, resolution outcomes (Parquet/CSV/JSON) |
| PolySimulator | polysimulator.com/backtesting | Multi-category backtesting |
| Telonex | telonex.io | Tick-level trades, orderbooks, on-chain fills |
| Kaggle (ismetsemedov) | kaggle.com/datasets/ismetsemedov/polymarket-prediction-markets | Full market data CSV |
| NautilusTrader Polymarket | nautilustrader.io/docs/latest/integrations/polymarket/ | Institutional-grade backtesting |

### 7.4 Academic Papers

| Paper | ID | Key Contribution |
|-------|----|-----------------|
| TradingAgents: Multi-Agents LLM Trading | arXiv:2412.20138 | Bull/bear debate architecture, 7-agent pipeline |
| Semantic Trading in Prediction Markets | arXiv:2512.02436 | Correlated market clustering |
| Prediction Arena: AI Benchmarking | arXiv:2604.07355 | LLM performance evaluation on real markets |

### 7.5 Trader Intelligence

| Trader | Profile | Known Strategy |
|--------|---------|---------------|
| Domer (JustWakingUp) | #1 all-time, ~$300M volume, $2.5M+ profit | Wide coverage + liquidity provision + EV discipline. Ex-poker. |
| Theo (Theo4/Fredi9999) | ~$50M election profit | Proprietary polling, high-conviction directional, 450+ bets on one thesis |
| WindWalk3 | $1.1M+ profits | Domain specialist (politics, RFK Jr.) |
| HyperLiquid0xb | $1.4M+ profits | Sports market dominator |
| swisstony | $4.96M via massive volume | High-volume, broad coverage |

### 7.6 Known Threats & Exploits

| Threat | Description | Mitigation |
|--------|-------------|------------|
| Malicious OSS bots | Private key theft in Dec 2025 bot, Jan 2026 "ClawdBot" typo-squat | Audit ALL code before running. Dedicated wallet. |
| Spread compression traps | Tiny sell orders compress bid-ask, trigger reward bots, then execute against them | Don't blindly chase reward eligibility |
| Weekend liquidity manipulation | Thin weekend liquidity exploited by manipulators ($233K documented) | Reduce position sizes on weekends |
| Order cancellation attacks | Exploit time gap between off-chain matching and on-chain settlement | Monitor fill rates, flag unusual patterns |
| Front-running by faster bots | MEV and speed bots front-run copy trades | Don't compete on speed. Win on information. |
| Reward program changes | Polymarket can change liquidity reward rules overnight | Don't depend on rewards as primary income |

### 7.7 Tools & Infrastructure

| Tool | Purpose |
|------|---------|
| Bullpen CLI | Rapid prototyping, whale tracking, AI skills integration |
| py-clob-client | Production Python trading (direct CLOB API) |
| clob-client (TS) | Production TypeScript trading (direct CLOB API) |
| FinBERT | Financial sentiment analysis model |
| PolyBackTest | Strategy backtesting with historical orderbook |
| NautilusTrader | Institutional-grade backtesting framework |
| Hono (ClaudeClaw) | Dashboard web server (already running on port 3141) |
| SQLite (ClaudeClaw) | Data storage (already in use) |
| Pino (ClaudeClaw) | Logging (already configured) |
| pm2 | Process supervision (already configured via ecosystem.config.cjs) |

```

---

## APPENDIX A: Decision Tree for Strategy Selection

```
New market opportunity detected
    │
    ├─ Is it in our specialized categories?
    │   ├─ YES → Run full signal pipeline (Section 2.1 + 2.2)
    │   └─ NO → Is there multi-trader consensus (3+ traders)?
    │       ├─ YES → Run consensus pipeline (Section 2.3)
    │       └─ NO → Is there a cross-platform price discrepancy?
    │           ├─ YES (>2% after fees) → Consider arb (Section 2.4)
    │           └─ NO → Is it >95% implied probability?
    │               ├─ YES → Consider bond play (Section 2.6)
    │               └─ NO → SKIP. No edge identified.
```

## APPENDIX B: Daily Operating Checklist

```
Morning (9 AM):
  [ ] Check overnight position changes
  [ ] Review resolved markets and auto-redeemed profits
  [ ] Scan for new high-edge opportunities in specialized categories
  [ ] Check tracked traders' overnight activity
  [ ] Review risk metrics (drawdown, capital utilization)

Continuous:
  [ ] Signal pipeline running (hourly market scans)
  [ ] Trader activity polling (every 30 seconds)
  [ ] Position P&L updates (every 5 minutes)
  [ ] Alert monitoring via Telegram

Evening (9 PM):
  [ ] Daily P&L summary
  [ ] Review today's signals (approved, rejected, why)
  [ ] Check for tomorrow's catalysts (events, data releases)
  [ ] Verify all positions have resolution dates tracked

Weekly (Sunday):
  [ ] Strategy performance review
  [ ] Edge decay analysis
  [ ] Trader ranking update (remove underperformers, add new candidates)
  [ ] Backtest refinements
  [ ] Update this document with lessons learned
```

## APPENDIX C: Glossary

| Term | Definition |
|------|-----------|
| CLOB | Central Limit Order Book -- Polymarket's off-chain order matching system |
| CTF | Conditional Token Framework -- ERC-1155 tokens representing market outcomes |
| GTC | Good Till Cancelled -- order stays until filled or cancelled |
| GTD | Good Till Date -- order expires at specified time |
| FOK | Fill or Kill -- entire order fills immediately or cancels |
| FAK | Fill and Kill -- fills what it can immediately, cancels the rest |
| Kelly criterion | Optimal bet sizing formula based on estimated edge |
| Fractional Kelly | Conservative version (1/4 to 1/6 of Kelly) to account for estimation error |
| Gamma API | Polymarket's market metadata and discovery API |
| UMA Oracle | Polymarket's dispute resolution system for market outcomes |
| EV | Expected Value -- probability-weighted average outcome |
| Edge | Your estimated probability minus market implied probability |
| Spread | Difference between best bid and best ask |
| Slippage | Price movement between signal and execution |
| TWAP | Time-Weighted Average Price -- split large orders across time intervals |
