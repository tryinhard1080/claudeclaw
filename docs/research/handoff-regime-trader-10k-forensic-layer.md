# Handoff: regime-trader 10-K forensic risk layer

**Status:** scope draft (claudeclaw-side handoff)
**Target repo:** `C:\Projects\regime-trader` (Python)
**Authoring agent:** claudeclaw `main`
**Source of idea:** TradingAgents YouTube walkthrough (2026-05-10), Layer 3 — see prior chat. Steal the LLM-over-10-K pattern as a *veto filter*, not a primary signal.

This is a scope spec for a regime-trader sprint. claudeclaw does not own the code; this doc exists so the regime-trader maintainer can pick it up cold.

---

## 1. Goal

Add an LLM pass over the most recent 10-K of each held (or candidate) position that extracts structured red-flag risk items, and surface those red flags to regime-trader's risk gates as a *veto filter* before sizing or entry.

Not a primary alpha signal. Not a stock-picker. A defense-only layer that catches the kind of footnote-level risk numerical factor models systematically miss (going-concern language, accounting-policy changes, segment deterioration, undisclosed contingent liabilities, auditor changes mid-cycle).

## 2. Why

regime-trader sizes and enters based on regime-state + technicals. It has no view on company-specific fundamental degradation. Two failure modes this layer is meant to prevent:

- **Idiosyncratic blowup inside an otherwise-healthy regime.** Regime says risk-on, technicals say buy, but the company restated earnings 6 months ago and is on going-concern watch. Numerical pipelines miss this because the signal lives in the 10-K's MD&A and footnotes.
- **Forensic deterioration before price.** Goodwill impairments, segment writedowns, auditor changes, and revenue-recognition policy shifts often telegraph price moves by weeks. Cheap to read, hard to factor-encode.

## 3. Scope

**In:**
- 10-K (annual) filings for US-listed equities held or under consideration.
- LLM extraction → structured JSON of red flags with severity.
- Persistent cache (one extraction per filing, keyed by accession number).
- Veto integration: any position with a `severity >= high` red flag from its most recent 10-K is blocked from new entries; existing positions get flagged for review (operator decides).

**Out:**
- 10-Q quarterly filings (cadence too high, signal-to-noise too low for v1).
- 8-K event filings (separate sprint if useful — different prompt shape).
- Foreign filings (20-F, 6-K).
- Proxy statements (DEF 14A), S-1s.
- Multi-document synthesis across years (just-most-recent for v1).
- Anything that *picks* stocks. This is veto-only.

## 4. Architecture

```
┌─────────────────────┐
│ Position candidate  │  ← regime-trader's existing pipeline
│ (ticker, size, side)│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ 10-K forensic gate                  │
│ ┌─────────────────────────────────┐ │
│ │ 1. Resolve most-recent 10-K     │ │  EDGAR full-text-search API
│ │    accession # for ticker       │ │  (free, no auth)
│ ├─────────────────────────────────┤ │
│ │ 2. Cache lookup                 │ │  SQLite or Parquet,
│ │    (accession # → red flags)    │ │  keyed by accession #
│ ├─────────────────────────────────┤ │
│ │ 3. On miss: fetch + extract     │ │  EDGAR HTML → text → LLM
│ │    (Claude Haiku or GLM-4.6)    │ │
│ ├─────────────────────────────────┤ │
│ │ 4. Apply veto rule              │ │  severity >= high → block
│ └─────────────────────────────────┘ │
└──────────┬──────────────────────────┘
           │
           ▼
   pass / veto / review
```

Cache TTL: forever per accession #. New 10-K filing = new accession # = new extraction. Old extractions never re-run.

## 5. Prompt design

System prompt (sketch — refine in TDD):

```
You are a forensic financial analyst reading a 10-K. Extract red flags.

Definitions:
- critical: company is at risk of failure within 12 months. Going-concern
  language, debt covenants breached, auditor resignation, material
  weakness in ICFR, or restated financials within last 24 months.
- high: meaningful deterioration vs prior year. Goodwill impairment >5%
  of equity, segment writedowns, accounting-policy changes that smooth
  earnings, large undisclosed contingent liabilities, customer
  concentration >25%, auditor change without explanation.
- medium: notable but not deal-breaking. Litigation reserves rising,
  receivables growing faster than revenue, capex deferral, stock-based
  comp >15% of revenue.
- low: housekeeping or minor language shifts.

Output strict JSON, schema below. No prose, no markdown. Empty array
if nothing to flag. Do not invent. If a section is ambiguous, omit.
```

JSON schema:

```json
{
  "ticker": "AAPL",
  "accession_number": "0000320193-25-000123",
  "fiscal_year_end": "2025-09-28",
  "extracted_at": "2026-05-10T15:00:00Z",
  "red_flags": [
    {
      "severity": "critical|high|medium|low",
      "category": "going_concern|impairment|accounting_change|litigation|customer_concentration|auditor|restatement|debt|ICFR|segment|other",
      "summary": "One sentence, plain language.",
      "evidence_section": "Item 7 MD&A | Item 8 Financial Statements | Item 9A Controls | ...",
      "evidence_quote": "Up to 200 chars of literal quote from the filing."
    }
  ]
}
```

Evidence quote is mandatory. No quote = the LLM is hallucinating. Reject any output where `evidence_quote` doesn't substring-match the source filing.

## 6. Cost model

10-K full text is ~50–200k tokens. Send only Items 1A (Risk Factors), 7 (MD&A), 8 (Financial Statements), 9A (Controls) — usually 30–80k tokens combined.

| Model        | Cost per 10-K (input) | Notes                                                  |
|--------------|-----------------------|--------------------------------------------------------|
| Claude Haiku | $0.04–0.10            | Probably good enough; benchmark on 5 known-bad filings |
| Claude Sonnet| $0.30–0.80            | Reserve for re-runs on `high`-severity hits            |
| GLM-4.6      | flat sub              | Free under existing Z.ai sub; try first                |

**Recommendation:** GLM-4.6 first (already paid for). If output quality fails the test set, escalate to Haiku.

Cadence: one extraction per ticker per year (when new 10-K drops). For a 50-name universe, ~50 extractions/year. Trivial cost.

## 7. Test plan

Build a golden set of 10 filings before writing the extractor:

- **3 known-bad** (severity should hit critical or high):
  - Wirecard 2018 10-K (auditor red flags, fraud markers)
  - Theranos / equivalent (restatements, going concern) — pick a public-company analog
  - Lehman Brothers 2007 10-K (Repo 105, leverage)
- **3 known-marginal** (medium):
  - Pick recent retail or media name with known goodwill writedowns
- **4 known-clean** (low or empty):
  - AAPL, MSFT, JNJ, WMT recent 10-Ks

Acceptance:
- Extractor flags critical/high on all 3 known-bad.
- Extractor returns empty or low on all 4 known-clean.
- All `evidence_quote` values substring-match the filing (validator).
- p95 extraction latency < 30s.

If the extractor fails any known-bad case, prompt iteration before merge. Don't ship a forensic gate that misses Wirecard.

## 8. Integration points (regime-trader side)

Two hook points:

1. **Pre-entry gate.** Before regime-trader sizes a new position, call `forensic_gate(ticker)`. Return `pass | veto | review`. `veto` blocks. `review` passes but logs a flag for the operator.
2. **Held-position monitor.** Daily cron walks all open positions. Any position whose most-recent 10-K wasn't yet evaluated, evaluate now. Any `critical` severity discovered → emit alert to operator (Telegram via claudeclaw bridge, or whatever regime-trader uses).

Do NOT auto-exit on a discovered red flag for an existing position. Operator decides. The system flags; the human decides the exit.

## 9. Open questions for regime-trader maintainer

1. Is regime-trader's universe stable enough that 10-K cache hits dominate? (If churn is high, costs scale linearly with universe size.)
2. Does regime-trader have a Telegram or Slack alert channel, or should `critical`-severity hits route through claudeclaw's Telegram bridge?
3. Where does the cache live — regime-trader's own SQLite, or a shared store?
4. Is there an existing EDGAR client in the codebase, or should this sprint include `sec-edgar-api` as a new dep?

## 10. Out of scope but adjacent (for later sprints)

- 8-K event filings — different prompt, different cadence, real-time-ish.
- Adversarial cross-check: run the 10-K through a *bull* extractor too ("what's the strongest case this filing is fine?") and compare. Same adversarial pattern we discussed for Polymarket resolution criteria.
- Multi-year diff: extract red flags from the last 3 years of 10-Ks and surface *new* flags this year vs prior. Catches deterioration trajectory.
- Earnings-call transcripts. Layer on top of 10-K analysis with the same extraction skeleton.

---

## How this changes our code/strategy

claudeclaw side: zero code change. This sprint lives in regime-trader. Claudeclaw's only optional involvement is the Telegram alert relay if regime-trader doesn't have its own.

If the layer ships and proves out, the same extraction skeleton (prompt + schema + evidence-quote validation) is reusable for the Polymarket adversarial resolution-criteria pass we noted last week. The pattern generalizes: structured-JSON-with-mandatory-evidence-quote. Build once, reuse twice.
