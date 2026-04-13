# HEARTBEAT — Operational Rhythm

The bot's pulse. If any of these stop, something is wrong.

## Tick Cadence

| Tick | Default | Source | What happens |
|------|---------|--------|--------------|
| Polymarket scan | 5 min | `POLY_SCAN_INTERVAL_MIN` | fetchActiveMarkets → upsert → emit `scan_complete` |
| Strategy engine | per scan | `scan_complete` listener | top-N by volume → LLM eval → Kelly size → 3 risk gates → execute |
| P&L tracker | 60 min | hardcoded in `PnlTracker.start` | reconcile open positions: mark-to-midpoint or resolve won/lost/voided |
| Daily digest | once/day | `POLY_DIGEST_HOUR` in `POLY_TIMEZONE` | summarize state → Telegram |
| Trading state poll | 5 sec | `src/trading/state-poller.ts` | read `instances/*/data/state.json` from regime-trader |

## Halt Switches (in escalation order)

1. **Per-strategy halt** — `UPDATE poly_kv SET value='1' WHERE key='poly.halt'` → Polymarket strategy stops opening new signals; existing positions still reconcile.
2. **Process restart** — `pm2 restart claudeclaw` → applies new dist code; clean state on next scan.
3. **Full stop** — `pm2 stop claudeclaw` → bot offline, no scans, no trades, no Telegram.
4. **Equity trading halt** — managed by regime-trader's own kill switch in its instance dir.

## Health Signals (alarms)

| Signal | Means | Action |
|--------|-------|--------|
| No `poly scan complete` log in 15 min | Scanner dead or stuck | Check `pm2 logs claudeclaw`. Restart if hung. |
| Restart count climbing in `pm2 list` | Bot is crash-looping | Stop pm2, read `pm2 logs --err`, fix root cause before resuming. |
| `position_resolved` events stop firing while open trades exist | PnlTracker hung | Restart. Check `fetchMarketBySlug` reachability. |
| Telegram alerts stop while signals fire | Sender broken | Check bot token, network, `bot.api.sendMessage` errors in log. |
| Daily realized P&L hits `-POLY_DAILY_LOSS_PCT × capital` | Gate 2 will reject all new signals today | Expected behavior. Do not override. Review tomorrow. |
| Drawdown ≥ `POLY_HALT_DD_PCT` | Gate 2 halts new signals globally | Stop. Audit. Don't lift halt without reading why. |

## Daily Review (every morning)

1. Read the digest in Telegram.
2. `/poly pnl` — equity, drawdown, today vs lifetime.
3. `/poly positions` — what's open, what's drifting against you.
4. `/poly signals` — last 10 evaluations, were rejections sane?
5. If pm2 restart count grew overnight, investigate before market open.

## Weekly Review (every Sunday)

1. Aggregate week's signals: approval rate, average edge, win rate on resolved.
2. Compare today's prompt version output to last week — drift?
3. Review codex-review on any code changes shipped that week.
4. If 14 days have passed since last full QA smoke run, re-run `npx tsx scripts/poly-qa-smoke.ts`.

## Sacred Rules

- Never silence an alarm without understanding why it fired.
- Never ship code on a Friday afternoon unless rolling back a regression.
- Never edit `risk-gates.ts` without a regression test that proves the gate still rejects what it should.
- Never raise `POLY_MAX_TRADE_USD` without a written hypothesis and a 30-day track record at the current cap.
