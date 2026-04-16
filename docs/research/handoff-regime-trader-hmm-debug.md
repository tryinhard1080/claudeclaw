# Handoff — regime-trader HMM prediction size-0 bug

> This is a handoff for a **separate Claude Code session** opened in `C:/Projects/regime-trader/`. Do not work on this from ClaudeClaw — per `CLAUDE.md`, equity logic lives only in the regime-trader repo. Copy-paste the "Starter prompt" section into that session.

## Status snapshot (2026-04-16)

- `ecosystem.regime-trader.config.cjs` `cron_restart: '30 9 * * 1-5'` fires correctly from the ClaudeClaw repo — pm2 side verified.
- Both paper instances (`spy-aggressive`, `spy-conservative`) came online at exactly 09:30 ET on 2026-04-16.
- Alpaca handshake succeeds: `Account connected: equity=$100000.00 cash=$100000.00 status=ACTIVE`.
- HMM training completes: selected 7-state model (`BIC=-233802.31`, `log_lik=118336.52`) from 504 days / 69 samples / 12 features.
- HMM live prediction then fails on every 5-minute bar from 09:35 onward with:

```
[WARNING] __main__: HMM prediction failed: index 0 is out of bounds for axis 0 with size 0. Holding current regime.
```

- Fail-closed behavior works: no trades fired while prediction is broken. But also zero trades.

## Suspected root cause (speculative — verify before fixing)

Training summary says `Training HMM on 69 samples with 12 features` from `504 days of history`. That 7× reduction suggests the feature-engineering pipeline drops rows — likely rolling/diff operations that leave leading NaNs.

Live prediction is called every 5-minute bar. If the prediction path applies the same transforms to a short warm-up window, the resulting dataframe is probably zero rows after NaN drop → `.iloc[0]` or equivalent index access throws `IndexError: index 0 is out of bounds for axis 0 with size 0`.

Hypothesis to verify: the prediction input is being built from bars-since-market-open rather than from a long-enough history window including overnight.

## Starter prompt

```
Context: I'm debugging regime-trader's live HMM prediction. Bot is running under pm2
(cron_restart at 09:30 ET weekdays, script main.py). Alpaca connects fine. HMM
training on startup succeeds. Live prediction then fails every 5-minute bar with:

    HMM prediction failed: index 0 is out of bounds for axis 0 with size 0.
    Holding current regime.

Training output: 7-state model, BIC=-233802.31, 69 samples × 12 features from
504 days of history. Samples/days ratio suggests feature engineering drops rows.

Tasks in order:
1. Find the prediction call path from main.py → core/hmm_engine.py. Identify where
   the 5-minute-bar input to HMM.predict() is constructed.
2. Identify where the IndexError is thrown. Likely an .iloc[0], .values[0], or array
   index access on a dataframe/array that has 0 rows after feature engineering.
3. Confirm the hypothesis: live prediction is called on too few historical bars,
   feature engineering drops all rows.
4. Decide: (a) pad the live input with recent historical bars so post-transform
   rows > 0, or (b) use the last-bar output of the training window as the prediction
   input. Prefer whichever matches regime-trader's existing patterns.
5. Write a unit test that reproduces the size-0 failure, then fix, then verify test
   passes.
6. Deploy by restarting pm2 (regime-trader-spy-agg + regime-trader-spy-cons). Watch
   next 5-minute bar — expect either a successful prediction log or a different
   error (which is progress).

Secondary concern (track, don't fix in the same sprint): HMM training spews ~20
non-convergence warnings across n_components=3-7. BIC selection still picks 7.
Model quality is worth a separate review sprint but is not causing today's
failure.

Tools: Python, pytest, pm2. Stop service before editing, restart after. Use TDD.
Target: one regime-trader-scoped sprint. No ClaudeClaw-side changes.
```

## What to report back to the ClaudeClaw session when done

- Did the hypothesis hold (size-0 after feature engineering)?
- Which file+line was the actual throw?
- Fix shape in one sentence.
- Did the next-bar live prediction succeed after deploy?

Post that summary as a ClaudeClaw memory (`project_regime_trader_hmm_fixed.md`) so the next ClaudeClaw session doesn't re-investigate.
