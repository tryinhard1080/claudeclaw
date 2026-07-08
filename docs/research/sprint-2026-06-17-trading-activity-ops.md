# Sprint 2026-06-17 - Trading activity ops

## Verdict

**COMPLEMENT** to `sprint-2026-06-01-trading-behavior-unblock.md`. The prior sprint raised paper open slots from 10 to 20 and improved Polymarket market hygiene. This sprint keeps real money disabled, keeps max trade size and deployed-cap unchanged, raises the paper slot ceiling only, and improves dashboard visibility into why the traders are or are not taking orders.

## Existing-code audit

| Surface | Finding | Change |
|---|---|---|
| `.env` | Live paper signals are being rejected because `POLY_MAX_OPEN_POSITIONS=20` and the paper book already has 20 open trades. Deployed exposure is still below the 50% paper-capital limit. | Raise the local paper-only slot ceiling to 30. Do not change `POLY_MAX_TRADE_USD`, `POLY_PAPER_CAPITAL`, or `POLY_MAX_DEPLOYED_PCT`. |
| `src/dashboard.ts` | `/api/poly/overview` reports open positions and exposure but not the configured slot/deployed limits. | Return paper limits and remaining slots so the dashboard can show whether the bot is blocked by slots or capital. |
| `src/dashboard-html.ts` | The trading dashboard has equity account, allocation, and orders, but it does not surface Alpaca paper mode, session trade count, last signal age, or last rejection reason. | Add paper/order activity context to the existing dashboard cards. |
| `src/trading/equity-dashboard.ts` | Regime state already contains `mode`, `session_trades`, and recent signal timestamps, but the normalized payload drops those fields. | Include activity fields in the API payload and tests. |

## Duplicate / complement / conflict / novel

- **Duplicate:** not a duplicate of the June 1 unblock. That sprint widened slots to 20 and cleaned the market universe.
- **Complement:** this extends the same paper-only learning path because 20 slots are now fully occupied.
- **Conflict:** no conflict with `TRUST.md`, `MISSION.md`, or the real-money gate because live money remains disabled and no capital/risk-gate source code is bypassed.
- **Novel:** dashboard limit attribution is new: it should answer whether low activity is caused by slots, deployed capital, stale equity state, no broker orders, or regime signal rejection.

## How this changes our code/strategy

The paper Polymarket bot should be able to approve up to 10 more open positions while staying inside the existing per-trade and deployed-cap constraints. The dashboard should make activity blockers visible without reading logs: Polymarket slots/deployed cap, Alpaca paper status, session trades, last signal age, and latest rejection reason.
