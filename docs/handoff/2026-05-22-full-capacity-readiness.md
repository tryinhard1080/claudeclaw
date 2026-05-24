# 2026-05-22 Full Capacity Readiness

## Verdict

ClaudeClaw is running and healthy for paper trading. It is not ready for real-money mode. The next real capacity gains are evidence quality, stale instruction removal, and Box 2 acceleration decisions, not more features.

## Live Checks

Fresh checks run on 2026-05-22:

- `pm2 list`: `claudeclaw-main` online, restart count `0`; regime-trader PM2 entries stopped while readiness reports market-closed state.
- `pm2 describe claudeclaw-main`: script path `C:\Code\claudeclaw\dist\index.js`, created at `2026-05-11T22:24:02.192Z`, unstable restarts `0`.
- `Invoke-RestMethod http://127.0.0.1:3141/health`: `status=healthy`, `database=ok`, `telegram=connected`, `agent=main`.
- `npm run status`: all systems go; voice STT and TTS intentionally not configured.
- `npm run trading:status`: PASS on PM2, Weather Goat, Polymarket scans, regime Sharpe freshness, and regime instances; WARN on missing Financial Datasets MCP.
- `npm run poly:paper:status`: latest market count `100`, latest captured prices `24`, signals last 24h `1138`, approved last 24h `0`, open paper positions `10`, halt flag `0`.
- `npx tsx scripts/poly-ttl-shadow-report.ts`: 2681 ticks observed, 4.8 percent of candidates pass the [1,30] day TTL band, 95.2 percent filtered above max, mean TTL ratio filtered/pass `8.42x`.
- `npm run typecheck`: pass.

## Live DB Snapshot

Read-only query against `C:\claudeclaw-store\claudeclaw.db`:

- `poly_paper_trades`: `10` open, `22` voided, realized P&L `0`.
- `poly.halt`: `0`.
- Latest scan: status `ok`, market count `100`, duration `111 ms`.
- Latest TTL tick: `12` candidates, `0` TTL pass, `12` filtered above max, band `[1,30]`.
- Latest Sharpe snapshot: both regime instances have `n_days=5`; latest rolling Sharpe is positive, but sample size is too small for the 60-day gate.

## Fixed This Session

- Replaced active `README.md` with a trading-only README.
- Rewrote specialist agent `CLAUDE.md` files so `comms`, `content`, `ops`, `research`, and `_template` no longer advertise personal-assistant work.
- Updated agent YAML examples to trading-only roles and deny personal-assistant connector prefixes by default.
- Added `npm run capacity:status` as the one-command readiness check.
- Added `docs/runbooks/full-capacity.md`.
- Added `docs/research/finceptterminal-fit.md`.

## Remaining Capacity Work

1. Keep gathering TTL shadow evidence through the planned comparison window. Do not flip active TTL filtering without Tier 3 approval.
2. Keep Sharpe snapshots running until the 60-day regime-trader gate has a real sample.
3. Resolve or explicitly defer Financial Datasets MCP visibility. It is a research-context WARN, not an execution blocker.
4. Update `MISSION.md` gate evidence only after a full uninterrupted-run audit, not from PM2 uptime alone.
5. Do not add a third strategy, asset class, or market integration.

## Next Best Command

```powershell
npm run capacity:status
```

