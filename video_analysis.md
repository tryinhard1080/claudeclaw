This is a comprehensive extraction of visible code, prompts, configurations, and UI elements from the tutorial video on building an automated trading bot with Claude Code.

### 1. System Architecture & High-Level UI
*   **00:34 | UI | High-level System Diagram**
    *   **Brain:** Hidden Markov Models, Classifies market (Crash, Bear, Neutral, Bull, Euphoria).
    *   **Allocation:** Adjust how much of portfolio is invested, Calm markets vs turbulent markets.
    *   **Safety:** Circuit breakers if losses hit certain levels, Work independently of AI model.
    *   **Broker:** Alpaca (Free API), IBKR (Paid high volume).
    *   **Dashboard:** See trades and insights in real time, Understand everything that's happening for adjustments.

### 2. Phase 1: Project Scaffolding
*   **10:18 | Prompt | Phase 1: Project Scaffolding**
    ```text
    Create a Python project called "regime-trader" with the following structure:
    regime-trader/
    ├── config/
    │   ├── settings.yaml      # All configurable parameters
    │   └── credentials.yaml.example
    ├── core/
    │   ├── __init__.py
    │   ├── hmm_engine.py      # HMM regime detection engine
    │   ├── regime_strategies.py # Vol-based allocation strategies
    │   ├── risk_manager.py    # Position sizing, leverage, drawdown limits
    │   └── signal_generator.py # Combines HMM + strategy into signals
    ├── broker/
    │   ├── __init__.py
    │   ├── alpaca_client.py   # Alpaca API wrapper
    │   ├── order_executor.py  # Order placement, modification, cancellation
    │   └── position_tracker.py # Track open positions, P&L
    ├── data/
    │   ├── __init__.py
    │   ├── market_data.py     # Real-time and historical data fetching
    │   └── feature_engineering.py # Technical indicators, feature computation
    ├── monitoring/
    │   ├── __init__.py
    │   ├── logger.py          # Structured logging
    │   ├── dashboard.py       # Terminal-based live dashboard
    │   └── alerts.py          # Email/webhook alerts for critical events
    ├── backtest/
    │   ├── __init__.py
    │   ├── backtester.py      # Walk-forward allocation backtester
    │   ├── performance.py     # Sharpe, drawdown, regime breakdown, benchmarks
    │   └── stress_test.py     # Crash injection, gap simulation
    ├── tests/
    │   ├── test_hmm.py
    │   ├── test_look_ahead.py # Verify no look-ahead bias
    │   ├── test_strategies.py
    │   ├── test_risk.py
    │   └── test_orders.py
    ├── main.py                # Entry point
    ├── requirements.txt
    ├── .env.example
    └── README.md
    ```

*   **12:37 | Terminal | Phase 1 Output**
    *   Claude Code confirms: "The regime-trader project skeleton is complete with 31 files across 8 directories."

### 3. Phase 2: HMM Regime Detection Engine
*   **13:21 | Prompt | Phase 2: HMM Engine & Feature Engineering**
    ```text
    Implement core/hmm_engine.py and data/feature_engineering.py.
    DESIGN PHILOSOPHY: The HMM is a VOLATILITY CLASSIFIER. It detects whether the market is in a calm, moderate, or turbulent volatility environment. It does NOT predict price direction. The strategy layer uses the volatility classification to set portfolio allocation—be fully invested when conditions are calm, reduce when turbulent.

    REQUIREMENTS:
    1. GAUSSIAN HMM WITH AUTOMATIC MODEL SELECTION:
       - Test N_components = [3, 4, 5, 6, 7] during training.
       - For each candidate, train and compute BIC (Bayesian Information Criterion).
       - Select lowest BIC (simplest model that explains the data).
       - Run multiple random initializations per candidate (n_init=10).
       - Log all candidate BIC scores and which was selected.

    After training, sort regimes by mean return (ascending) for LABELING:
    3 regimes: CRASH, NEUTRAL, BULL
    4 regimes: CRASH, BEAR, BULL, EUPHORIA
    5 regimes: CRASH, BEAR, NEUTRAL, BULL, EUPHORIA
    6 regimes: CRASH, STRONG_BEAR, WEAK_BEAR, WEAK_BULL, STRONG_BULL, EUPHORIA
    7 regimes: CRASH, STRONG_BEAR, WEAK_BEAR, NEUTRAL, WEAK_BULL, STRONG_BULL, EUPHORIA
    Layer sorts by VOLATILITY independently. The labels don't drive strategy decisions.

    2. OBSERVABLE FEATURES (Inputs to HMMs):
       Implement in data/feature_engineering.py as pure functions:
       Compute from OHLCV:
       - Returns: log returns over 1, 5, 20 periods.
       - Volatility: realized vol (20-period rolling std), vol ratio (5-period / 20-period).
       - Trend: ADX (14-period), slope of 50-period SMA.
       - Mean reversion: RSI (14-period), distance from 200 SMA as % of price.
       - Momentum: ROC (10 and 20 period).
       - Range: normalized ATR (14-period ATR / close).
       Standardize ALL features with rolling z-scores (252-period lookback).

    3. MODEL TRAINING:
       - hmmlearn.GaussianHMM, covariance_type="full".
       - Minimum 2 years daily data (EOD trading days).
       - Expanding window retraining at configurable intervals.
       - Store model with pickle + metadata (N_regimes, BIC, training_data_labels).

    4. REGIME DETECTION - NO LOOK-AHEAD BIAS:
       *** THIS IS THE MOST IMPORTANT TECHNICAL DETAIL ***
       DO NOT use model.predict(), predict() runs the Viterbi algorithm which processes the ENTIRE sequence and revises past states using future data. This is look-ahead bias that makes backtests unrealistically good.
       INSTEAD IMPLEMENT FORWARD ALGORITHM ONLY (filtered inference):
       def predict_regime(filtered_features, features_up_to_now):
           Compute P(state_t | observations_1:t) using only forward algorithm.
           Uses ONLY past and present data. No future data.
           # Use model's startprob_, transmat_, means_, covars_
           # Implement forward pass manually:
           # 1. alpha_t = (alpha_t-1 * transmat) * emission_prob(obs_t)
           # 2. Normalize alpha_t at each step (work in log space)
           # 3. Cache previous alpha for efficiency in backtest loop
    ```

### 4. Phase 3: Allocation Strategies
*   **16:34 | Prompt | Phase 3: Volatility-Based Allocation Strategy**
    ```text
    Implement core/regime_strategies.py — the allocation layer that sizes positions based on the HMM's volatility regime detection.

    DESIGN INSIGHT: The HMM excels at detecting VOLATILITY ENVIRONMENTS, not market direction. Stocks trend upward roughly 70% of the time in low-volatility periods. The worst drawdowns happen in high-volatility spaces. So the strategy is simple:
    - Low vol -> be fully invested (calm markets trend up).
    - Mid vol -> stay invested if trend intact, reduce if not.
    - High vol -> reduce but stay partially invested (catch V-shaped rebounds).
    The correct response to high volatility is REDUCING allocation, not reversing direction.

    THREE-STRATEGY CLASSES (based on volatility rank):
    1. LowVolBullStrategy (lowest third of regimes by expected_volatility):
       - Direction: LONG
       - Allocation: 95% of portfolio
       - Leverage: 1.25x (modest leverage in calm conditions)
       - Stop: 50-EMA - 1.0 ATR (wider stop, let trend run)

    2. MidVolCautiousStrategy (middle third by expected_volatility):
       - Direction: LONG (NOT short)
       - Allocation: 60% of portfolio
       - Leverage: 1.0x
       - Stop: 50-EMA - 0.5 ATR (tighter stop, reduce exposure)

    3. HighVolDefensiveStrategy (highest third by expected_volatility):
       - Direction: LONG
       - Allocation: 10% of portfolio
       - Leverage: 1.0x
       - Stop: 50-EMA - 0.3 ATR (order for volatile conditions)
       - Staying 90% invested cash protects the sharp rebounds after sell-offs.
    ```

### 5. Phase 4: Backtesting & Validation
*   **18:39 | Prompt | Phase 4: Walk-Forward Backtesting & Validation**
    ```text
    Implement backtest/backtester.py, backtest/performance.py, and backtest/stress_test.py.
    This is an ALLOCATION-BASED walk-forward backtester. It does NOT track individual trade entries and exits. It sets a target portfolio allocation each bar based on the detected volatility regime and rebalances when the allocation changes meaningfully. This is how real systematic strategies work.

    1. WALK-FORWARD OPTIMIZATION ENGINE (backtester.py):
       Rolling windows:
       - In-Sample (IS): 252 trading days (1 year) for HMM training + model selection.
       - Out-of-Sample (OOS): 126 trading days (6 months) for evaluation.
       - Step size: 126 trading days (6 months).
       For each window:
       a. Train HMM on IS data (BIC model selection).
       b. Compute vol rankings from trained model's regime_infos.
       c. Walk through OOS bar by bar:
          - Compute features using ONLY data up to current bar.
          - Run filtered HMM (forward algorithm only).
          - Get strategy signal: target allocation based on vol rank.
          - If allocation changed >10% from current -> rebalance.
          - Mark-to-market: equity = cash + shares * price.
          - Record a "trade" whenever allocation changes for metrics.

    2. PERFORMANCE METRICS (performance.py):
       Core:
       - Total return (%), CAGR.
       - Sharpe ratio (annualized), Sortino ratio.
       - Calmar ratio (CAGR / max drawdown).
       - Max drawdown: percentage AND duration in trading days.
       - Win rate, avg win/loss, profit factor.
       - Total trades, avg holding period.

    3. STRESS TESTING (stress_test.py):
       Three stress categories:
       a. Crash injection: insert -5% to -15% single-day gaps at 10 random points. Run 100 Monte Carlo simulations. Report mean max loss, worst case, % where circuit breaker fired.
       b. Gap risk: insert overnight gaps of 2-5x ATR at random points. Report expected loss vs actual.