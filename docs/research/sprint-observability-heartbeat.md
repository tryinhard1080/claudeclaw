# Sprint observability-heartbeat — scan cadence + storage watchdog

## 1. Existing-code audit

- `src/trading/alerts.ts::TradingAlertManager` — throttled per-type-per-
  target alerts with 15-min throttle. Pattern reused.
- `src/poly/market-scanner.ts` — emits `scan_complete` event on success
  and `scan_error` on failure. No "scan never completed" signal.
- `src/poly/drift.ts::recordScanRun` — writes per-tick rows to
  `poly_scan_runs`. The only authoritative source of "did a scan happen".
- No existing heartbeat or storage monitor.
- Trading side already pings Telegram on `instance_stale` — good
  precedent.

## 2. Literature / NotebookLM finding

Not applicable. Standard "dead man's switch" pattern: a periodic timer
that alerts when some external-signal timestamp stops advancing.

## 3. Duplicate / complement / conflict verdict

**Complement.** Distinct signal from `scan_error` (which fires only on
exceptions) — this fires on "no scan at all" which includes the 2026-
04-20 silent-hang failure mode.

## 4. Why now

The 2026-04-20 restart went silent for 83 minutes with zero signals to
the operator. The bug was a DB performance issue, but from the operator's
POV the observable symptom was "Telegram quiet for an hour." Three
independent alerts would have fired within 10-15 minutes of the silence:

1. `scan_stale` — no `poly_scan_runs` row with `status='ok'` in 2× the
   scan interval (default 10 min).
2. `wal_size` — WAL > 100 MB indicates checkpointer is falling behind
   even if scans are still writing.
3. `db_size` — DB > 500 MB catches unpruned-data growth trends.

Metric target: MTTD (mean time to detect silent scanner failure) drops
from ≥ 83 min (observed) to ≤ 20 min (heartbeat fires within 1 min of
threshold crossing, throttled to 15-min repeats).

## 5. Out of scope

- Auto-recovery. Heartbeat only alerts; operator decides to restart /
  investigate. Auto-restart carries its own risks.
- Scan-latency alerting. `scan_slow` event is wired in the scanner
  itself (Part B of peaceful-turtle) with a 120s threshold; heartbeat
  doesn't duplicate that.
- Regime-trader state poller monitoring. That subsystem already has
  its own `instance_stale/down` alerts.

## 6. Risk

- False-positive noise: 15-min throttle + 5-min grace at startup
  prevents "post-restart cold start" false alarms. Still possible if
  the operator runs maintenance (e.g. Part A VACUUM) without stopping
  the bot — but Part A stops the bot first.
- Heartbeat is a writer-less reader — cannot itself pin a WAL
  checkpoint, so it's a monitor not a cause of bloat.
- `fs.statSync` in a hot 60s-cadence loop is trivial (one stat() per
  file per minute).

## 7. Verification plan

- Tests: `computeHeartbeatAlerts` pure-fn covered with 7 cases (grace
  period, stale, not-stale, never-scanned, WAL, DB, all-three).
- Live verification: after restart, confirm no alerts during first 5 min
  (grace). Force a stale condition by setting `POLY_ENABLED=false`
  temporarily and waiting 12 min — scan_stale should fire exactly once
  (throttled).
- 30-day window: WAL size stays < 10 MB after Part A rescue + Part B
  fix. If `wal_size` fires during the window, something's regressed.
