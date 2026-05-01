# Research: Atlas + Comparable Self-Improving Trading Agents on GitHub

**Researched:** 2026-04-27 | **Operator trigger:** "Review Atlas self-improving trading agent on GitHub or look for others like it to see if they can help us or be a benefit."

**Cost:** 1 free Sonar query. Pro quota was empty (0/300) at session start, so detailed cross-source verification (star counts, exact licenses, full codebase audit) is deferred until quota refresh or a `gh repo view` pass.

**Existing prior art:** `docs/research/self-improvement-loops.md` (2026-04-13) — full survey of Karpathy Autoresearch, Reflexion, Anthropic evaluator-optimizer, OpenAI outcome-conditioned learning, and calibration tracking. **This note extends that one** rather than restating it.

---

## Executive Summary

**Atlas** (General Intelligence Capital, March 2026) is a Karpathy-style autoresearch loop applied specifically to LLM trading agents. It runs a **population of agent variants in parallel**, scores them on rolling Sharpe-like metrics, kills the worst, and rewrites their prompts. It is the trading-domain instantiation of patterns we already cataloged in `self-improvement-loops.md`. Two angles in Atlas that our existing research note did NOT cover:

1. **Population-based tournament selection** (kill-worst-N, replicate-best, mutate prompts). This is more aggressive than our planned Sprint 2 flat A/B.
2. **Sharpe as the keep/discard metric** vs our planned Brier score. Sharpe captures risk-adjusted return directly; Brier captures probability calibration. They are complementary, not substitutable.

**Verdict: Adopt-Later (Sprint 7+).** Do NOT change current sprint order. Atlas's population-dynamics extension is exactly what `self-improvement-loops.md` parked as "needs ≥3 viable strategy versions first." The prerequisite binding is unchanged.

---

## What Atlas Actually Is

Sourced from the agent-wars writeup (2026-03-13) and a simplenews.ai summary citing 378 trading days of backtest. Direct GitHub repo URL not yet verified — flagged for follow-up.

| Attribute | Value | Confidence |
|-----------|-------|------------|
| Builder | General Intelligence Capital | High (multiple sources) |
| Released | March 2026 | High |
| Domain | LLM-driven trading (asset class not fully clear from sources — equities and/or crypto) | Medium |
| Core loop | Multi-agent population → trade window → rank by rolling Sharpe → kill worst → mutate prompts of survivors → repeat | High |
| Inspiration | Explicitly cites Karpathy's autoresearch (Mar 2026) | High |
| License | "Open source" claimed but exact license unverified | Low |
| Backtest scale | 378 trading days mentioned in coverage | Medium |
| Live PnL | Not disclosed in initial release notes | High (i.e., we know it's not disclosed) |
| Probable arxiv backing | 2510.15949v1 — needs read | Medium |

### The loop in their own framing (paraphrased)

```
for each evaluation_window:
    spawn N agent variants (each with a prompt)
    each variant trades the window in paper mode
    score each on rolling Sharpe (or similar risk-adjusted return)
    kill the worst-K
    for each survivor:
        ask LLM: "rewrite this prompt to address the failures it had this window"
        commit the rewrite as a new variant
```

This is **genetic-algorithm-meets-Reflexion**. The "fitness function" is market-determined (Sharpe), not LLM-judged. That's the same property that makes Karpathy's autoresearch work — **the metric is outside the agent's control**.

---

## Comparable Open-Source Trading Agents (2025–2026)

Sonar surfaced these. Star counts and license details NOT yet verified — flagged with `[unverified]`.

| Project | Repo | Angle | Relevance to ClaudeClaw |
|---------|------|-------|------------------------|
| **Atlas** (GIC) | `[unverified — search GIC org]` | Karpathy-style autoresearch + population dynamics on LLM trading agents | High — direct architectural match for our Sprint 7+ |
| **TradeMaster** (NTU + HKUST) | `github.com/TradeMaster-NTU/TradeMaster` | RL-based full QT pipeline (design → eval → deploy) | Low — RL-only, no LLM strategy layer; we run an LLM-driven strategy |
| **ai-trading-agents** (vinaynkashyap) | `github.com/vinaynkashyap/ai-trading-agents` | Python autonomous AI agents for general trading tasks | Low — generic decision-logic scaffold, not a self-improvement loop |
| **arxiv 2510.15949** | preprint | Likely the academic backing for Atlas-style autoresearch trading | High if it's a clean methodology paper — read once Pro quota returns |

**Note on phantom URLs in Sonar response:** Sonar suggested `github.com/anthropic/llm-trading-agent` and `github.com/rl-trading/auto-trade` as illustrative examples. Both look hallucinated — Anthropic does not publish a trading agent repo. **Do not cite these.** Verified sources only.

---

## How This Maps to Our Existing Plan

`docs/research/self-improvement-loops.md` defined six patterns and a sprint sequence. Mapping Atlas onto that:

| Pattern from `self-improvement-loops.md` | What Atlas does | Our current sprint |
|------------------------------------------|-----------------|-------------------|
| Pattern 1 — Keep-or-discard with mechanical metric | Kill-worst-K based on Sharpe | Sprint 1 (Brier) builds the metric infra; Sprint 2 (A/B) is the simplest keep/discard. Atlas is the population-flavored extension. |
| Pattern 2 — Reflection loops | LLM rewrites a losing variant's prompt | We already have `codex-review` + `adversarial-review`; Sprint 2.5 adds reflection on signals themselves. |
| Pattern 3 — Outcome-conditioned learning | Survivors get conditioned on what just worked in the window | Maps to Sprint 2+ "use resolved signals as few-shot examples" idea. |
| Pattern 5 — A/B testing | Tournament selection IS aggressive A/B | Sprint 2 builds flat A/B; Atlas-style tournament is Sprint 7+ when we have ≥3 viable versions. |

**Net new from Atlas (not in `self-improvement-loops.md`):**

1. **Sharpe-as-fitness (vs Brier-as-fitness).** Brier measures probability calibration; Sharpe measures risk-adjusted return. For a betting market like Polymarket, Brier on resolved markets is the cleaner signal — calibration directly translates to edge. Sharpe is noisier for our use case (binary outcomes, lumpy windows). **Stay on Brier as primary metric.** Track Sharpe as secondary once we have 90+ days of paper trades.

2. **Population dynamics (genetic mutation of prompts).** This is novel relative to our note. But it requires ≥3 viable prompt variants and a backtest harness fast enough to run them all per evaluation window — neither exists yet. Sprint 5 (offline backtest infrastructure) is the prerequisite. **Park as Sprint 7+ candidate.**

---

## What I'd Want to Verify Before Adopting Anything

1. **Read arxiv 2510.15949** — confirm methodology is sound, not a marketing paper. Free fetch once we have time.
2. **Locate the actual Atlas repo** — `gh search repos "General Intelligence Capital atlas"` to find canonical URL, license, star count, last commit, issue activity.
3. **Audit Atlas code for risk-gate equivalent** — does Atlas have anything like our `risk-gates.ts`? If not, their "kill the worst" can wipe an account before the metric stabilizes. Our Tier-3 real-money gate would refuse to deploy a system without that.
4. **Check Atlas's evaluation window length.** Karpathy uses 5 minutes. Atlas's window is "trading day"-scale per the simplenews citation. If their window is hours-to-days, the iteration count is much lower than autoresearch's 288/day, which changes the cost-benefit calculus.

---

## How This Changes Our Code/Strategy

**No change to active sprint order.** `self-improvement-loops.md`'s sprint sequence stands.

**Three small additions to backlog:**

1. **Sprint 7+ ticket: "Tournament selection over prompt variants."** Cite Atlas. Prerequisites: Sprint 2 (prompt_version column) + Sprint 5 (offline backtest harness) + ≥3 viable prompt variants surviving Sprint 2 A/B. Until those land, this ticket is dormant.

2. **Sprint 1 secondary metric ticket: "Track rolling Sharpe alongside Brier."** Cheap addition. Sharpe is industry-standard for trading systems; having both lets us compare across the literature. No code-path impact.

3. **Reading-list ticket: "Read arxiv 2510.15949 + locate canonical Atlas repo."** Half a day of research once Pro quota returns. Output: 2-paragraph addendum to this note with verified facts.

**Anti-action:** Do NOT pivot the current strategy work to clone Atlas. We are pre-Sprint-2; we don't even have prompt versioning yet. Skipping ahead to population-based selection would violate the speed-tripwire rule in `CLAUDE.md` ("a sprint that takes less than 30 minutes is a signal you skipped steps") and the "no third strategy until existing two have a 30-day track record" anti-goal.

---

## Sources

- Sonar query 2026-04-27 (free tier — single call)
- [agent-wars.com: Atlas Self-Improving AI Trading Agents Using Karpathy-Style Autoresearch (2026-03-13)](https://agent-wars.com/news/2026-03-13-atlas-self-improving-ai-trading-agents-using-karpathy-style-autoresearch)
- [simplenews.ai: Atlas Trading Agents Self-Improve Using Autoresearch Across 378 Trading Days](https://www.simplenews.ai/news/atlas-trading-agents-self-improve-using-autoresearch-across-378-trading-days-sxym)
- [arxiv 2510.15949v1](https://www.arxiv.org/pdf/2510.15949.pdf) — read pending
- [TradeMaster (NTU + HKUST)](https://github.com/TradeMaster-NTU/TradeMaster)
- [vinaynkashyap/ai-trading-agents](https://github.com/vinaynkashyap/ai-trading-agents)
- [sourcepulse.org/projects/26110811](https://www.sourcepulse.org/projects/26110811) — context only
- Internal: `docs/research/self-improvement-loops.md` (2026-04-13)
