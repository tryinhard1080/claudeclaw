# Sprint 2026-06-01 - Equity dashboard cockpit

## Verdict

**COMPLEMENT** to the existing trading ops dashboard. The current dashboard already proves service health and Polymarket paper state, but it does not show enough broker-level equity detail for an operator to understand what Alpaca is holding, what orders just filled, or how the active regime strategy maps to current allocation.

## Existing-code audit

| Surface | Finding | Change |
|---|---|---|
| `src/dashboard.ts` | Read-only Polymarket and trading-ops endpoints already exist behind the dashboard token. | Add a read-only `/api/equity/overview` endpoint. |
| `src/trading/ops-dashboard.ts` | Health checks read regime-trader state files but summarize only pass/warn/fail. | Keep this focused on health, add a separate equity payload for broker/account detail. |
| `C:\Code\regime-trader\instances\*/data\state.json` | State files contain regime, risk, recent signal, execution flag, and position data. | Use them as the dashboard's local source for active/shadow strategy state. |
| Alpaca REST paper account | Provides account, positions, and recent orders. | Query read-only with cached server-side credentials and return sanitized account/order fields only. |

## Duplicate / complement / conflict / novel

- **Duplicate:** not a duplicate of trading ops; trading ops is health-focused.
- **Complement:** adds operator visibility for the equity strategy and broker truth without changing trading behavior.
- **Conflict:** none. This does not touch risk gates, sizing, capital, or live-money flags.
- **Novel:** introduces a dedicated equity cockpit panel with active instance, allocation drift, current position, recent orders, and risk status.

## How this changes our code/strategy

No strategy or execution behavior changes. The operator can now see whether the SPY regime strategy is active, what target allocation it wants, what Alpaca actually holds, how far the account is from target, and which orders caused the current state.
