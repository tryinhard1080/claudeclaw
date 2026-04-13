# Research: Self-Improvement Loops for AI Agents (2026)

**Researched:** 2026-04-13 | **Operator trigger:** "Andrew Karpathy has some great self-improving guidance, let's research those."

## Executive Summary

As of 2026, five patterns dominate production self-improving AI agents. **Karpathy's Autoresearch** (Mar 2026) is the reference implementation for autonomous loops — it generated 276 experiments and 11% training-efficiency gains in 48 hours with zero human intervention. Anthropic's evaluator-optimizer + evals+benchmarks pattern is the reference for production-grade A/B testing. Our EVOLUTION.md sprint sequence maps well to this literature but is **missing two key ideas**: the mechanical keep-or-discard gate and the tight inner-loop tick.

---

## Core Pattern 1 — Autoresearch's "Keep or Discard" (Karpathy, Mar 2026)

### The loop
1. Agent reads `program.md` (research strategy — the agent's playbook).
2. Agent edits `train.py` (the thing allowed to change).
3. Agent runs a 5-minute experiment.
4. Agent checks: did the objective metric improve? Yes → keep. No → discard and revert.
5. Repeat.

### Why it works
- **The metric is outside the agent's control.** It's deterministic, numerical, and measured, not argued.
- **Fast tick.** 5-minute cycles = 288 iterations/day. Even with 90%+ discard rate, you net ~29 improvements in 48 hours.
- **Discard by default.** Changes don't survive unless they earn survival. No "it's close enough" — the number either improved or it didn't.

### What we already have
- `poly_signals` + `poly_paper_trades` capture outcome data per decision.
- Risk gates are pure functions — tests are the metric.
- `computeCacheKey` version-bumps invalidate stale probability estimates.

### What we're missing
1. **A single dashboarded objective metric for strategy quality** (Brier score is the obvious choice — Sprint 1 builds this).
2. **An auto-compare harness** — "does prompt v4 produce lower Brier than v3 on overlapping markets?" (Sprint 2 plans this).
3. **A faster inner loop than daily snapshots**. Karpathy runs 5-min; we run daily. For experiment velocity, we want a "quick offline backtest" that can compute Brier on a fixed sample in seconds (Sprint 5 plans this).

---

## Core Pattern 2 — Reflection Loops (Reflexion + Multi-Agent Reflexion)

Generate → Critique → Refine, often with two different LLMs (the generator and the critic). Reduces hallucination, catches misreadings. Anthropic calls this the **evaluator-optimizer workflow**.

### How we already do this
- `codex-review` skill runs gpt-5.2-codex as independent reviewer against our commits.
- `adversarial-review` skill (available in superpowers) is the Reflexion pattern for recent decisions.

### What we're missing
- **Reflection on trade signals themselves, not just code.** The `ai-probability` strategy's prompt is single-pass. Adding a critic pass (same or different model) that reads the first estimate + the contrarian section and flags contradictions would catch the "Orbán misread" category before it hits the gate.
- This is cheap to prototype: one extra API call per signal. Worth measuring Brier impact in Sprint 2.

---

## Core Pattern 3 — Outcome-Conditioned Learning (OpenAI Self-Evolving Agents, Meta SWE-RL)

Agents condition future actions on past outcomes. OpenAI's pattern: diagnose failure → synthesize new training signal → retrain. Meta's SWE-RL alternates bug injection with bug solving to bootstrap.

### Applicability to our bot
- **Direct:** Every resolved trade IS labeled data. Paper trades that won/lost give us ground truth for "given these inputs (market, ask, regime), the right probability was X". We can't easily fine-tune Opus, but we CAN:
  - Build a calibration-conditional prompt: prepend high-Brier categories with "caution examples" from recent losses.
  - Use resolved signals as few-shot examples in future prompts (Sprint 2+).

### Risk
- Overfitting to a small sample of resolved trades. Guard: require ≥50 samples per category before using them as conditioning.

---

## Core Pattern 4 — Calibration Tracking (Anthropic evals, OpenAI misalignment monitoring)

Accuracy/drift/latency dashboards are table stakes. Anthropic's Claude skills now ship with built-in evaluation + benchmarking for regression detection. OpenAI monitors internal coding agents for misalignment via systematic logging.

### What Sprint 1 delivers
Brier score, log loss, calibration curve per lookback window. Alert when Brier exceeds threshold. This IS our calibration-tracker layer.

### What to add beyond Sprint 1
- Drift on **latency** (time from `scan_complete` to first `signal_filled`). A slow bot is a bot that's about to crash.
- Drift on **rejection mix** (if gate-2 rejections suddenly spike, something changed in our portfolio).
- Drift on **market-count per scan** (sudden drop = upstream API degrading).

Captured as Sprint 1.5 candidates in EVOLUTION.md tickets.

---

## Core Pattern 5 — Strategy A/B Testing (Anthropic benchmarks, Maxim, Galileo)

Run parallel variants, compare via metrics, adopt winner. Anthropic's built-in A/B for Claude skills (2026) — generator emits N candidates, evaluator picks winner with statistical-significance gating.

### Our EVOLUTION.md Sprint 2
Exactly this pattern: `prompt_version` column on signals → A/B harness → ship new strategy only when Brier improves with significance. Validated by literature.

### Addition worth making
**Multi-armed bandit over strategy versions** once we have 3+ viable versions. Instead of flat A/B, route new signals to strategies proportionally to their recent performance (Thompson sampling). More sample-efficient than pure A/B. Deferred to Sprint 7+ — not needed for first 2 strategy versions.

---

## Core Pattern 6 — Knowledge Distillation from Experience

Less applicable to us (we're not training models, we're using them), but one useful transfer: **compress lessons into the prompt**. Each adversarial-review finding → one-line addition to the system prompt's "watch for" section. This IS a form of distillation: agent's accumulated experience → string that conditions future runs.

---

## How This Changes Our Code/Strategy

1. **Keep EVOLUTION.md sprint order as-is.** Calibration (Sprint 1) → versioning (Sprint 2) → regime (Sprint 3) → ingestion (Sprint 4) → backtest (Sprint 5) → adversarial (Sprint 6). This matches the literature's dependency graph.

2. **Add Sprint 2.5 — Reflection pass on signals.** One extra API call per signal: show the initial estimate + contrarian to a second LLM call (cheaper Sonnet), ask "does this contradict itself?" Measure Brier impact in an A/B against Sprint 2's single-pass. ~1 day of work; high-upside test.

3. **Tighten the inner loop for Sprint 5 (backtesting).** Historical Gamma snapshot + stored poly_signals = offline Brier computation in seconds, not days. This is our Karpathy-style rapid iteration harness. Before this exists, strategy tuning is slow; after, we can run 20+ prompt variants in an afternoon.

4. **Add drift dashboards beyond Brier.** Sprint 1.5 ticket: track scan-latency, rejection mix, market-count drift. Each is a health signal that precedes the kind of silent degradation that would otherwise only surface when the bot loses money.

5. **Build a `docs/learned/` distillation ledger.** Every adversarial-review finding, every calibration surprise, every resolved trade that diverged from the model → one-line entry. Periodically condense the ledger into an update to `SYSTEM_PROMPT` in `ai-probability.ts`. This is how the bot accumulates tacit knowledge over time.

6. **NO multi-armed bandit yet.** Premature. Need ≥3 viable strategy versions first. Parked as Sprint 7+.

---

## Sources

- [Karpathy/autoresearch GitHub](https://github.com/karpathy/autoresearch)
- [Karpathy's Autoresearch: AI That Improves Its Own Training (Analytics Vidhya)](https://www.analyticsvidhya.com/blog/2026/03/nanochat-gpt-2-training/)
- [Andrej Karpathy on Code Agents, AutoResearch and the Self-Improvement Loopy Era (NextBigFuture)](https://www.nextbigfuture.com/2026/03/andrej-karpathy-on-code-agents-autoresearch-and-the-self-improvement-loopy-era-of-ai.html)
- [Autoresearch: Karpathy's Minimal Agent Loop (Kingy AI)](https://kingy.ai/ai/autoresearch-karpathys-minimal-agent-loop-for-autonomous-llm-experimentation/)
- [Karpathy Open-Sources Autoresearch (MarkTechPost)](https://www.marktechpost.com/2026/03/08/andrej-karpathy-open-sources-autoresearch-a-630-line-python-tool-letting-ai-agents-run-autonomous-ml-experiments-on-single-gpus/)
- [Self-Improving AI Agents 2026 Guide (o-mega)](https://o-mega.ai/articles/self-improving-ai-agents-the-2026-guide)
- [Anthropic: Building Effective Agents (evaluator-optimizer pattern)](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Anthropic: Built-in Evaluation and Benchmarking for Claude Agent Skills](https://www.ainews.com/p/anthropic-introduces-built-in-evaluation-and-benchmarking-for-claude-agent-skills-to-improve-enterpr)
- [OpenAI: How We Monitor Internal Coding Agents for Misalignment](https://openai.com/index/how-we-monitor-internal-coding-agents-misalignment/)
- [Reflexion / Multi-Agent Reflexion (arXiv summary)](https://arxiv.org/html/2512.20798v2)
- [Stanford HAI: AI Agents That Self-Reflect Perform Better](https://hai.stanford.edu/news/ai-agents-self-reflect-perform-better-changing-environments)
- [Fortune: Karpathy Loop = Autonomous AI Agents Future](https://fortune.com/2026/03/17/andrej-karpathy-loop-autonomous-ai-agents-future/)
