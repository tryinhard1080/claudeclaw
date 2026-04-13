# EVOLUTION — The Self-Improving Trading System

> Read after `SOUL.md` / `MISSION.md` / `HEARTBEAT.md`. This is the architecture the bot grows into. Operator partner: **Richard Bates**.

The current bot is competent: it scans, evaluates, gates, executes, and reconciles. It is not yet **self-improving**. This document defines what self-improvement means for us, what tooling makes it possible, and the build sequence to get there.

---

## 0. The Partnership Model (Richard ↔ Bot)

This is a partnership, not a tool. Each partner owns specific decisions:

| Decision | Owner | Why |
|----------|-------|-----|
| Capital allocation, real-money switch, scope expansion | **Richard** | Has skin in the game. Last sane reviewer. |
| Per-trade execution within risk-gate envelope | **Bot** | Faster, never sleeps, no emotion. |
| Strategy parameter tuning (within bounded ranges) | **Bot, Richard reviews weekly** | Bot has the data; Richard has the veto. |
| Strategy *replacement* (new prompt, new model, new approach) | **Joint** | Bot proposes with eval evidence; Richard signs off. |
| Disclosure of bot mistakes, drift, near-misses | **Bot proactively** | Trust requires no surprises. |
| Disclosure of operator changes (capital adds/withdrawals, risk appetite shifts) | **Richard proactively** | Bot can't model what it doesn't know. |

The bot **earns** decision authority by demonstrating reliability. Initially everything except per-trade execution requires Richard's nod. As paper-trade history accumulates, more decisions move to "bot acts, Richard reviews".

---

## 1. Tool Infrastructure (Current → Target)

### Already wired ✓
| Capability | Tool |
|-----------|------|
| LLM evaluation | Anthropic Claude (Opus) via `@anthropic-ai/sdk` |
| Web research (general) | Perplexity MCP (smart_query / ask / deep_research) |
| Domain notebooks | NotebookLM via `nlm` CLI |
| URL extraction | Defuddle, Firecrawl (fallback for JS-rendered) |
| Code review | Codex (`codex-review` skill) |
| Process supervision | pm2 (with auto-restart) |
| Persistence | SQLite (`STORE_DIR/claudeclaw.db`) |
| Telegram interface | grammy |
| Observability (basic) | pino logs, dashboard `:3141` |

### Gaps to close (priority order)
| Gap | What we need | How to fill it |
|-----|--------------|----------------|
| **Calibration measurement** | Brier score, log loss, calibration curves on resolved signals | Build `src/poly/calibration.ts` + `poly_calibration_snapshots` table |
| **Strategy A/B versioning** | Run prompt v3 vs v4 on overlapping market sets, compare outcomes | Add `prompt_version` to `poly_signals`; add `/poly compare-versions` command |
| **Regime tagging** | Annotate signals/markets with macro regime (VIX bucket, election cycle, BTC dominance) | New `regime` table populated by a 15-min cron from public APIs |
| **Real-time market data (equities)** | Beyond regime-trader's feeds — sentiment, news shocks | Add Polygon.io free tier OR Tiingo OR Alpaca's market data (already have keys) |
| **Polymarket on-chain edge** | Whale wallet tracking, order flow analysis | Polymarket subgraph (free) + Dune queries |
| **News alerting** | Resolution-affecting news on open positions | Cron checking newsapi.org or RSS feeds for slugs in open positions |
| **Adversarial review** | Periodic red-team of recent decisions | Spawn `adversarial-review` skill weekly |
| **Backtesting harness** | Replay strategy against historical Polymarket data | Build `scripts/backtest.ts` with offline gamma-history snapshots |
| **Drift alarms** | Notify when calibration / win rate / Sharpe falls outside expected bands | Cron on calibration snapshots → Telegram |

---

## 2. Research Sources (the information edge)

Edge comes from information you have that the market doesn't price in fast enough. These are organized by signal-to-noise ratio (highest first).

### Tier 1 — Always-On (auto-ingest into NotebookLM weekly)

**Quant / risk frameworks:**
- AQR Insights (`aqr.com/Insights/Research`) — original quant research, free.
- Hudson + Thames (`hudsonthames.org/blog`) — practitioner-focused ML for finance.
- Quantocracy (`quantocracy.com`) — aggregator of quant blogs.
- arXiv q-fin daily (`arxiv.org/list/q-fin/new`) — academic frontier.
- SSRN Financial Economics Network — peer-reviewed.

**Polymarket-specific:**
- Domer's Substack (`domahhhh.substack.com`) — top-ranked Polymarket trader, public posts.
- Star Spangled Gamblers (`starspangledgamblers.com`) — political prediction-market analysis.
- Polymarket blog + announcements (resolution-rule changes!).
- Polymarket subgraph data (free, on-chain order flow).

**Markets / macro context:**
- Matt Levine, *Money Stuff* (Bloomberg, free email). Daily.
- Marc Rubinstein, *Net Interest* (free Substack). Weekly. Best fintech analysis.
- Morgan Housel, *Collaborative Fund Blog*. Behavioral edge.
- Of Dollars and Data (Nick Maggiulli). Eval discipline.
- Cliff Asness's AQR papers. Foundational.

**Crypto / on-chain (relevant for crypto Polymarket categories):**
- Glassnode Insights (free articles).
- Messari research (free tier).
- Delphi Daily (paid, evaluate after 30 days of paper).

### Tier 2 — Periodic (monthly deep-dive ingestion)

- BIS Working Papers (central bank research).
- IMF Working Papers (macro frameworks).
- NBER Working Papers (academic macro).
- Top hedge fund letters (Howard Marks/Oaktree, Pershing Square, Greenlight).

### Tier 3 — Real-Time (event-triggered)

- Reuters Top News RSS — paste into a `news-watcher` cron.
- Bloomberg Markets RSS (free for headlines).
- X/Twitter lists (curated). High noise; treat as attention signal, not truth.
- For political Polymarket markets: 538 (now Substack), The Hill, Politico Playbook.

### Anti-list (do not consume)

- Reddit r/wallstreetbets, r/algotrading, etc. — high noise, low signal.
- "Trading guru" YouTube. Signal-to-noise ≈ 0.
- Crypto Twitter price calls. Pure noise.

### Ingestion pipeline (to build)

```
RSS / Substack / arXiv → fetch via cron → docling-provenance extract →
NotebookLM upload via nlm CLI → indexed for LLM retrieval at query time
```

Cron cadence: Tier 1 weekly, Tier 2 monthly, Tier 3 every 30 min during market hours.

---

## 3. The Self-Improvement Loop (the architecture)

Self-improvement = systematically detecting where the bot is wrong, persisting that knowledge, and feeding it back into future decisions. Six components, each independent:

### 3.1 Outcome Capture (foundation — partially built)
- Every signal: predicted probability, ask, edge, gate verdicts → `poly_signals` ✓
- Every trade: entry, size, shares → `poly_paper_trades` ✓
- Every resolution: won/lost/voided + realized P&L → `poly_paper_trades` ✓
- **Missing**: prompt version on signals, regime tag at signal time, news context at signal time.

### 3.2 Calibration Tracker (build first)
Periodic job (daily) computes from resolved signals:
- **Brier score** = mean squared error of (predicted prob − outcome). Lower is better.
- **Log loss** = −mean(log p) for resolved YES / −mean(log(1−p)) for resolved NO.
- **Calibration curve** = bucket signals by predicted prob (10% bands), measure actual win rate per bucket. Plot.
- **Reliability per category** (sports, politics, crypto, ...) — strategies often miscalibrated category-by-category.

Snapshot to `poly_calibration_snapshots` (slug, prompt_version, regime, brier, log_loss, n_samples). Telegram alerts when any window's Brier exceeds threshold.

### 3.3 Strategy Versioning (build second)
- Add `prompt_version` and `model` columns to `poly_signals`.
- A/B harness: `scripts/poly-strategy-compare.ts` runs old + new strategy on overlapping markets.
- Decision rule: new strategy ships only if it improves Brier by >X% with statistical significance.
- Eval cache already version-tagged via `PROMPT_TEMPLATE_HASH`. ✓ Builds on existing.

### 3.4 Regime Detection (build third)
Maintain a `regime_snapshots` table updated every 15 min:
- VIX level (free from CBOE)
- BTC dominance (CoinGecko free)
- US 10y yield (FRED free)
- Days-to-next-major-event (US election, Fed meeting, NBA finals, ...) for category-relevant markets.

Annotate each signal at creation with the current regime. Calibration tracker can then show "Brier by regime" — exposes whether the strategy works in calm markets but breaks in volatile ones.

### 3.5 Adversarial Review (build fourth)
Weekly cron spawns the `adversarial-review` skill on the last 7 days of decisions:
- "Find the worst trade. Explain why."
- "Find a rejection that should have been an approval. Why did the gate over-fire?"
- "Find a category where we're systematically biased. What's the correction?"
Output → Telegram + appended to `docs/research/weekly-adversarial-<date>.md`.

### 3.6 Knowledge Persistence (build continuously)
Every adversarial finding, every calibration insight, every "we learned X" gets a one-line entry in `docs/learned/INDEX.md` linking to a short markdown rationale. Six months from now this is a queryable history of every lesson the bot has internalized.

---

## 4. Build Sequence (concrete next 6 sprints)

Each sprint = self-contained, shippable, tested.

| # | Deliverable | Estimated effort | Unlocks |
|---|------------|------------------|---------|
| 1 | **Calibration tracker** — new module + `/poly calibration` cmd + Brier/LogLoss/curve | 4-6 hrs | Quantitative measure of strategy quality |
| 2 | **Strategy versioning** — schema add + version tag on signals + A/B compare script | 3-4 hrs | Safe iteration on prompt v3 → v4 |
| 3 | **Regime tagger** — `regime_snapshots` cron + signal annotation + per-regime stats | 4-6 hrs | Conditional strategy intelligence |
| 4 | **Research ingestion pipeline** — NotebookLM auto-feed from Tier-1 sources | 3-5 hrs | Information edge compounds weekly |
| 5 | **Backtesting harness** — replay strategy against historical Gamma snapshots | 6-8 hrs | Test changes without risking capital |
| 6 | **Adversarial review cron** — weekly red-team report into Telegram + docs | 2-3 hrs | Drift catching, learning institutionalization |

Each sprint's output flows into the next. By Sprint 6 we have a **measurable, versioned, regime-aware, backtested, adversarially-reviewed strategy** — that's the working definition of "world class" for an automated trading agent.

---

## 5. Anti-Patterns to Refuse

- **"Let's add 3 strategies in parallel"** — dilutes attention, makes nothing measurable. One at a time.
- **"This LLM is hot, switch to it"** — model swaps without an A/B test are gambling. Run the comparison first.
- **"Crank up the leverage / size now that we're paper-profitable"** — survivorship bias. Real-money gate exists for this reason.
- **"Add Twitter sentiment because trader X said it works for them"** — n=1 anecdotes are noise. Show the data or skip.
- **"Build a fancy dashboard"** — Telegram + SQLite queries are sufficient. Building UI is yak-shaving.
- **"Hot-patch in production"** — every change goes through the QA smoke script + codex review.

---

## 6. Done State (what "world class" looks like)

When all of this is real:
- Bot ingests 50-100 research items per week, queryable on demand.
- Every signal carries: prompt version, model, regime tags, news context.
- Calibration measured daily; alarms fire on drift.
- Strategies are versioned, A/B tested, backtested before deployment.
- Adversarial reviews surface drift before P&L surfaces it.
- 30+ day track record on paper across multiple regimes, with operator sign-off in `MISSION.md`.

That bot earns the right to trade real capital.
