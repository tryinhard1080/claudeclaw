# Sprint 2026-06-01 - Trading behavior unblock

## Verdict

**COMPLEMENT** to Sprint S2 TTL shadow and the 2026-05-22 full trading-bot research. This activates the already-studied TTL direction for paper trading, adds a narrow deterministic contract-quality filter, and widens paper-only slots without changing per-trade dollars, paper capital, halt limits, or live execution.

## Existing-code audit

| Surface | Finding | Change |
|---|---|---|
| `src/poly/market-scanner.ts` | TTL instrumentation was shadow-only; the live candidate list was unchanged. | Keep shadow stats, but let active flags filter the price-capture candidate set. |
| `src/poly/strategy-engine.ts` | Candidate selection filtered volume, min TTR, price band, and topN only. Long-dated and unserious markets could still be evaluated and traded. | Add active TTL and market-quality options to `selectPriceCaptureCandidates`. |
| `src/poly/ttl-filter.ts` | Pure TTL partition already exists and is covered by tests. | Reuse `ttlDays` in the active market-quality helper. |
| `.env` | Default max-open slot cap was 10; all slots were filled, blocking new paper trades. | Set `POLY_MAX_OPEN_POSITIONS=20` locally. Max trade remains $50 and max deployed remains 50% of paper capital. |

## Duplicate / complement / conflict / novel

- **Duplicate:** not a duplicate of S2. S2 collected shadow evidence only.
- **Complement:** directly complements S2 and `2026-05-22-full-trading-bot-research.md`, which recommended market-prior discipline, TTL constraints, and better candidate hygiene.
- **Conflict:** conflicts with the old wait-for-14-days posture, but Richard explicitly approved changing behavior on 2026-06-01 after weeks of non-trading.
- **Novel:** deterministic market-quality exclusion for prophecy/joke-market wording is new and narrowly scoped to the live bad case.

## Research basis

- Page and Clemen find prediction-market calibration worsens farther from expiration, supporting a shorter TTL band for learning.
- Polymarket CLOB docs and recent microstructure work support treating spreads, liquidity, and execution venue details as first-class costs.
- LLM forecaster research supports using models as additive forecasters, not blindly accepting large model-vs-market gaps.

## How this changes our code/strategy

The bot should trade more often on paper because it now has 10 additional slots, but it should trade a cleaner universe: 1 to 30 day markets and no obvious prophecy/joke contracts. This is still not a real-money green light. It is a paper-learning behavior change intended to generate resolved trades and usable calibration data faster.
