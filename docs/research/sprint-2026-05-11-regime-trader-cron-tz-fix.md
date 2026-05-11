# Sprint — Regime-Trader Cron Timezone Fix (2026-05-11)

> Plan: `C:\Users\Richard\.claude\plans\review-this-code-base-rustling-whistle.md`, Phase 5 Issue C follow-up after drill FAIL.
> External target repo: `C:\Code\regime-trader` (Python).
> Triggering event: 2026-05-11 Monday market-open drill FAIL.

## Verdict

**Two bugs to fix. One is in claudeclaw (pm2 manifest config). One is in regime-trader (HMM live-prediction input).** This note scopes the claudeclaw-side cron-timezone fix; the regime-trader-side HMM size-0 fix is scoped in `docs/research/handoff-regime-trader-hmm-debug.md` (2026-04-16, still valid). Today's drill confirmed both bugs are still present.

## Bug 1 — PM2 cron in local time vs intended ET

### Symptom

`regime-trader-spy-agg` and `regime-trader-spy-cons` failed to start at the design-intended 09:30 ET (08:30 CT) on 2026-05-11. Both remained `status: stopped` at 08:34 CT, 4 minutes past expected fire.

### Root cause

The pm2 cron_restart pattern `30 9 * * 1-5` is interpreted against **system local time**. System TZ is US Central (UTC-5 in CDT). So:

- Intended: 09:30 ET = 14:30 UTC = 09:30 ET cron fire daily at market open.
- Actual: 09:30 CT = 14:30 UTC = 10:30 ET cron fire daily, 1 hour after market open.

The bot misses the first hour of trading every weekday — confirmed by examining historical pm2 logs of `regime-trader-spy-agg` which show first signals at `14:00:01` (which under "logs in local CT" reads as 14:00 CT = 15:00 ET, last hour of trading) AND the empirical fact that today the instances stayed stopped through 09:30 ET.

### Code site

`scripts/regime-trader-pm2-config.ts` — the manifest builder. Generates the pm2 JSON consumed by `npm run trading:pm2:write` and applied to `C:\Users\Richard\.claudeclaw\regime-trader.pm2.json`.

### Fix shape (claudeclaw-side, 30 min)

Change the cron field from `30 9 * * 1-5` to `30 8 * * 1-5` (08:30 CT = 09:30 ET). Re-generate the pm2 JSON, re-apply, save.

Better long-term: set the cron's timezone explicitly. PM2 accepts a `timezone` option in `cron_restart` config since pm2 v5+ (verify version). If supported, use:

```json
{
  "cron_restart": "30 9 * * 1-5",
  "time": true,
  "env": { "TZ": "America/New_York" }
}
```

Or convert the local time field to `30 8 * * 1-5` and document the conversion in the runbook so future operators in different TZs don't get bitten.

### TDD shape

Test in `scripts/regime-trader-pm2-config.test.ts`:

```ts
it('cron_restart fires at 09:30 ET (08:30 CT, 14:30 UTC) on weekdays', () => {
  const cfg = buildRegimeTraderPm2Config();
  // Either: assert cron_restart === '30 8 * * 1-5' (local CT)
  // Or: assert cron_restart === '30 9 * * 1-5' AND env.TZ === 'America/New_York'
  expect(cfg.apps[0].cron_restart).toMatch(/30 [89] \* \* 1-5/);
  // Add: assert the next cron fire timestamp from a cron-parser is within 1 hour
  // of NYSE 09:30 ET on the next weekday.
});
```

### Deploy

After fix lands:

```powershell
npm run trading:pm2:write
pm2 stop regime-trader-spy-agg regime-trader-spy-cons
pm2 delete regime-trader-spy-agg regime-trader-spy-cons
pm2 start C:\Users\Richard\.claudeclaw\regime-trader.pm2.json
pm2 save
pm2 describe regime-trader-spy-agg | grep "cron"
```

Confirm `cron restart` line shows the new value.

### Acceptance gate

Next Monday morning's market-open: at 08:30 CT (09:30 ET), both instances should transition `stopped` → `online` automatically (within 30 sec). No manual `pm2 start` should be needed.

## Bug 2 — HMM live-prediction size-0 on fresh startup (regime-trader-side)

### Symptom (same as 2026-04-16)

```
08:40:00 [WARNING] __main__: HMM prediction failed: index 0 is out of bounds
for axis 0 with size 0. Holding current regime.
```

First 5-min bar after market open fails. Bot stays in "holding current regime" state for the rest of the session. State files never write a fresh snapshot.

### Already scoped

`docs/research/handoff-regime-trader-hmm-debug.md` from 2026-04-16 contains the diagnostic narrative and starter prompt. That doc remains valid. Today's drill confirms the bug is still present in regime-trader HEAD `2f5627f`.

### Action

Open a regime-trader-scoped Claude Code session in `C:\Code\regime-trader` and paste the starter prompt from `handoff-regime-trader-hmm-debug.md`. Update one line of that prompt: the head reference. New text:

```
Context: I'm debugging regime-trader's live HMM prediction. Bot runs under pm2
(cron_restart at 09:30 ET weekdays — after the claudeclaw-side cron-tz fix
lands; today still firing at 10:30 ET). Alpaca connects fine. HMM training on
startup succeeds. Live prediction then fails on the FIRST 5-min bar after
"=== Paper trading started ===" with:

    HMM prediction failed: index 0 is out of bounds for axis 0 with size 0.
    Holding current regime.

Training output (2026-05-11 fresh fit): 7-state model, BIC=-222526.19, fitted
on ~12 features from ~10y daily history. Live prediction is then called on
5-min bar input which has insufficient post-feature-engineering rows.

Most recent confirmed reproduction: 2026-05-11 08:40 CT (drill log entry in
the claudeclaw repo, docs/runbooks/trading-drill-log.md).

Tasks in order:
  1. Find the prediction call path from main.py:392 → core/hmm_engine.py:265
     predict_regime(features). Identify how `features` is constructed.
  2. Verify the hypothesis that feature engineering drops rows on a short
     live-input window. Look for rolling/diff/lag operations in
     data/feature_engineering.py that leave leading NaNs.
  3. Decide fix shape:
     (a) Pad live input with overnight history so post-FE rows > 0.
     (b) Use last-bar snapshot from the training window as the prediction
         input.
     (c) Restructure feature engineering to retain last row even when other
         rows drop.
     Prefer (a) — it changes the least and matches the existing 300-bar
     pre-guard in main.py:381.
  4. Write a pytest in tests/test_hmm.py that reproduces size-0 by feeding
     a too-short feature buffer to predict_regime. Verify RED before fix.
  5. Fix. Verify GREEN.
  6. Restart pm2 instances and observe the next 5-min bar. Expect successful
     prediction log or a different error.

Reference: docs/research/handoff-regime-trader-hmm-debug.md in
C:\Code\claudeclaw — that's the original 2026-04-16 scoping doc.

Tools: Python, pytest, pm2. TDD. Stop service before editing, restart after.
Target: one regime-trader-scoped commit. No claudeclaw-side changes.

When done, post a single ClaudeClaw memory line summarizing fix shape + the
file:line of the actual throw so the next session doesn't re-investigate.
```

### Acceptance gate

After the regime-trader fix lands, a fresh restart should produce:

```
[INFO] core.hmm_engine: Selected 7-state model (BIC=...)
[INFO] __main__: === Paper trading started for SPY (5-min bars) ===
HH:MM:00 [INFO] core.regime_strategies: vol_rank=X.XX conf=X.XX -> regime alloc=X.XX
HH:MM:00 [INFO] core.signal_generator: Signal: SPY <SIDE> ...
```

Zero `HMM prediction failed: ... size 0` lines after `Paper trading started`. State files refresh within one 5-min bar period with `market_open: true` and populated `regime` / `risk` / `positions` / `recent_signals` keys.

### Box 3 unblock condition

Both Bug 1 (claudeclaw cron fix) AND Bug 2 (regime-trader HMM fix) must land before the 60-day paper Sharpe clock starts. The first day of clean operation (cron fires at 09:30 ET, HMM produces real predictions across the full session) is day 1.

## What this Sprint does NOT touch

- `src/poly/risk-gates.ts` / `paper-broker.ts` / `pnl-tracker.ts` — TRUST.md Tier 3, no change.
- Polymarket-side code — Bug 1 only touches the regime-trader pm2 manifest; Bug 2 only touches the regime-trader Python repo.
- Real-money flags — Tier 3, no change.

## Sequencing

1. **First (today or tomorrow):** ship Bug 1 (claudeclaw cron-tz fix). Small surface, low risk. Lets the operator confirm the cron-fire path works tomorrow morning even before the HMM fix lands.
2. **Second (within the week):** open a regime-trader-scoped session and ship Bug 2 (HMM size-0 fix) following the starter prompt.
3. **Third (after both ship):** monitor one full week of market opens. Start the Box 3 60-day clock on the first clean day. Earliest gate eligibility shifts from ~2026-07-10 (pre-drill estimate) to ~7 weeks from whenever the second fix lands.
