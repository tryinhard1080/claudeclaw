# Full Capacity Runbook

## Trigger

Run this when Richard asks whether ClaudeClaw is fully baked, at full capacity, ready for a trading day, or ready to move a gate box.

## Preconditions

- You have read `TRUST.md`, `SOUL.md`, `MISSION.md`, and `HEARTBEAT.md`.
- You are in the repo root: `C:\Code\claudeclaw`.
- You will not touch Tier 3 surfaces without explicit operator approval.
- You will not treat real-money enablement as available until every `MISSION.md` checkbox is closed and signed.

## Procedure

1. Check git state.

   ```powershell
   git status --short --branch
   ```

2. Check the combined agent status.

   ```powershell
   npm run agent:surface:check
   npm run source:freshness:refresh
   npm run trading:benchmark:snapshot
   npm run readiness:evidence
   npm run readiness:evidence:record
   npm run readiness:evidence:cron
   npm run capacity:status
   ```

3. Check PM2 details.

   ```powershell
   pm2 list
   pm2 describe claudeclaw-main
   ```

4. Check dashboard health.

   ```powershell
   Invoke-RestMethod -Uri http://127.0.0.1:3141/health
   ```

5. Run the code gates if files changed.

   ```powershell
   npm run typecheck
   npm test
   ```

6. Query live paper evidence read-only when gate state matters.

   ```powershell
   @'
   const Database = require('better-sqlite3');
   const db = new Database('C:/claudeclaw-store/claudeclaw.db', { readonly: true, fileMustExist: true });
   console.log(db.prepare("SELECT status, COUNT(*) AS count, ROUND(COALESCE(SUM(realized_pnl),0), 4) AS realized_pnl FROM poly_paper_trades GROUP BY status ORDER BY status").all());
   console.log(db.prepare("SELECT COUNT(*) AS open_positions, ROUND(COALESCE(SUM(unrealized_pnl),0), 4) AS unrealized_pnl FROM poly_positions").get());
   console.log(db.prepare("SELECT value FROM poly_kv WHERE key='poly.halt'").get());
   console.log(db.prepare("SELECT instance, snapshot_date, rolling_sharpe_60d, n_days FROM regime_sharpe_snapshots ORDER BY created_at DESC LIMIT 4").all());
   '@ | node -
   ```

## PASS Criteria

- `claudeclaw-main` is online in PM2 with unstable restarts at `0`.
- Dashboard `/health` returns `status=healthy`, `database=ok`, and `telegram=connected`.
- Dashboard readiness cards must not show `All gate boxes pass` when
  `/api/readiness/live` is unavailable, malformed, or rate-limited; the correct
  failure state is red unavailable text.
- `npm run trading:status` has no FAIL rows. A stopped regime-trader instance is acceptable only when the script reports `closed_until_next_open`, `opening_grace`, or `closed_stale_open_state` outside regular session.
- `npm run trading:benchmark` reports a benchmark row for each regime-trader instance.
- `npm run gate:status` reports real-money gate progress and source freshness rows.
  Box 1 should show either `clock_running`, `elapsed_review_ready`, or
  `mission_checked`; `elapsed_review_ready` is evidence for review, not live
  authorization.
- `npm run readiness:evidence` reports Polymarket settlement progress, mark-to-market paper P&L, near-term resolution pipeline, TTL filter evidence, and regime Sharpe sample depth.
- `npm run readiness:evidence:record` writes or refreshes one daily row in `readiness_evidence_snapshots`; the dashboard Evidence Path card should show snapshot history after the first row exists.
- `npm run readiness:evidence:cron` reports `already registered` or creates one active daily shell task for `scripts/readiness-evidence.ts --record --history 14`.
- `npm run poly:paper:status` reports fresh scans, halt flag `0`, and no unsafe feature flags enabled.
- `npm run typecheck` passes after edits.
- `npm test` passes after code or config changes that can affect behavior.
- Any WARN row has a named owner, next action, and gate impact.

## Capacity Definition

Full capacity does not mean real money. It means:

- The paper trader is running unattended inside existing risk gates.
- The equity bridge is scheduled and ready for market-open cycles.
- Gate evidence is current enough for a human to trust the next decision.
- Future agents see only trading-aligned instructions.
- External architecture ideas are documented as blueprints, not imported as uncontrolled dependencies.

## Current Known WARNs

- Financial Datasets MCP may be missing from the active tool list. This blocks some research context, not trading execution.
- News sync source freshness may be stale until the Perplexity or equivalent news feed is re-authorized.
- Box 1 can be `elapsed_review_ready` after the 30-day paper clock target. It
  still stays a live-money blocker until the `MISSION.md` checkbox is closed.
- Polymarket Box 2 remains structurally constrained until resolved trade count improves. Use `npm run readiness:evidence` and the dashboard Evidence Path card to track due open positions and signal flow.
- Active Polymarket TTL filtering is enabled locally after Richard's 2026-06-01 approval. Keep the TTL shadow report running as the comparison and rollback evidence path.
- Regime-trader Sharpe has only a small sample until the 60-day clock completes.

## Rollback

This runbook is read-only except for docs or instruction-surface fixes. If a check fails:

1. Do not change risk parameters.
2. Do not lift halt switches.
3. Capture the exact failing command and output.
4. Fix root cause in the smallest relevant surface.
5. Re-run this runbook from the top.

## Outcome Signature

Summarize the result in `docs/handoff/YYYY-MM-DD-full-capacity-readiness.md` when the run changes gate evidence or operator next actions.
