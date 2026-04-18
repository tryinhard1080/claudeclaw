# BACKLOG — Parked Ideas

Richard's side-requests land here; bot prioritizes them against the EVOLUTION.md roadmap. Each item: **pitch** (why it matters), **effort**, **blocker** (if any), **verdict** (Accepted / Deferred / Declined / Researched).

## Active

### AgentMail email integration
- **Category:** Infrastructure (communication channel)
- **Trigger:** Richard 2026-04-13.
- **Pitch:** Rich HTML reports, brokerage-confirmation parsing, newsletter ingestion, fallback alert channel.
- **Effort:** Sprint Email-A (~3 hrs outbound) + Sprint Email-B (~4 hrs inbound).
- **Blocker status (2026-04-13):** `AGENTMAIL_API_KEY` received and loaded to `.env`. **Still blocked on `OPERATOR_EMAIL`** — Richard needs to specify the destination address where daily/weekly reports should go. Ask before Sprint Email-A starts.
- **Research:** Done — see `docs/research/agent-mail-integration.md`.
- **Verdict:** Accepted. Build after EVOLUTION.md Sprints 2-3 (versioning + regime). Reason: versioning unlocks A/B testing the email-vs-Telegram reporting efficacy; regime tagging enriches what goes in the reports. Email before either would ship partial signal.

### Pre-market daily briefing (`/poly briefing` + cron) — **SHIPPED via Sprint 11 (2026-04-16)**
- **Category:** Reporting / operator surface
- **Trigger:** Richard 2026-04-15 (YouTube reference: trader daily-rundown workflow).
- **Pitch:** Unified pre-open scan that fuses existing subsystems into one markdown + HTML: current macro regime (Sprint 3), top-N signals by edge with band-filter status (5.5), open positions with exit proximity (Sprint 8), fresh `research_items` since last run (Sprint 4), calibration + drift flags (1 / 1.5), week-ahead adversarial review digest (Sprint 6). No Gmail ingestion — stays inside trading scope per TRUST.md.
- **Effort:** ~1 sprint. One composer module pulling from existing tables + CLI command + weekday cron ~8:00 ET + Telegram `[SEND_FILE:...]` delivery. Optional HTML append-mode dashboard second pass.
- **Blocker:** None. All upstream data already in SQLite.
- **Verdict:** ~~Accepted. Queue after Sprint 8 validates.~~ **Superseded by Sprint 11 digest expansion** — `composeDigest` in `src/poly/digest.ts` now renders regime snapshot, calibration tail, and per-position detail sections in the daily Telegram digest. Per `docs/research/sprint-11-digest-expansion.md` §5, a standalone `/poly briefing` command would duplicate. Closed 2026-04-18.

### Task-master tooling evaluation
- **Category:** Workflow (plan management)
- **Trigger:** Richard 2026-04-13.
- **Pitch:** Alternative to current writing-plans + executing-plans superpowers skills; potentially better task decomposition + dependency tracking.
- **Effort:** ~30 min research + 1 hr POC if worth adopting.
- **Blocker:** None.
- **Research:** Not yet started.
- **Verdict:** Deferred to post-Sprint-2. Rationale: current superpowers workflow is working — 1 sprint shipped, 1 mid-flight, zero rework. Don't replace a functioning tool until there's friction. Will revisit after Sprint 4 if I feel plan-tracking friction.

## Deferred Pending Data

### Sprint 2.5 — Reflection pass on signals
- Literature-backed (Reflexion / Anthropic evaluator-optimizer) second-LLM critic. Directly addresses Orbán-type misreads.
- Depends on Sprint 2 versioning infrastructure to measure impact via A/B.
- Build after Sprint 2 ships.

### Sprint 1.5 — Drift dashboards beyond Brier
- Scan latency, rejection mix drift, market-count drift. Early-warning signals.
- Small ticket. Build when calibration is producing its first data (needs resolved trades first).

### `docs/learned/` distillation ledger
- One-line entry per lesson; periodically condense into SYSTEM_PROMPT updates.
- Starts accumulating the first time a resolved trade diverges from the model. Not yet.

### Kronos foundation model for K-line forecasting
- **Category:** Equity-side model candidate (Phase C+ augmentation to regime-trader).
- **Source:** `github.com/shiyu-coder/Kronos` (MIT, AAAI 2026). First open-source foundation model purpose-built for financial candlestick data. Pre-trained on 12B K-lines from 45 global exchanges. Family: mini 4.1M / small 24.7M / base 102.3M (open); large 500M (closed). Weights on Hugging Face (NeoQuasar org).
- **Architecture:** Hierarchical VQ tokenizer on OHLCV → decoder-only autoregressive Transformer. Zero-shot next-token prediction over candle tokens.
- **Fit for ClaudeClaw:**
  - **Equity side (regime-trader):** Directly applicable. Paper claims +93% RankIC vs Chronos on price forecasting. Could augment or replace HMM regime detection in a Phase C experiment.
  - **Polymarket side:** Not natively. Outputs price paths, not event probabilities. Would need post-processing (multi-sample paths → empirical distribution → P(threshold)) or a classification head on frozen embeddings.
- **Blocker (hard):** MISSION.md anti-goal — no new strategy until existing two have a 30-day paper track record. Cannot adopt now.
- **Research note:** None yet; all summary context pulled in session 2026-04-18 via Perplexity + GitHub README.
- **Verdict:** **Deferred Pending Data.** Re-evaluate at Phase E gate check (earliest 2026-06-15) as a candidate regime-detection augmentation for the equity side. If real-money gate goes green and regime-trader has a 30-day track record by then, consider a small sprint to shadow-log Kronos-base predictions alongside HMM on the same bars and compare accuracy.

## Declined / Out of Scope

*(Nothing yet — when I decline something, the rationale goes here so Richard sees the decision.)*
