# Sprint 11 — Daily digest expansion

## 1. Existing-code audit

Prior art (discovered before writing any new code — this is the value of the gate):

- `src/poly/digest.ts:13` — `shouldRunDigest({ hour, timezone, now, lastRunYmd })`. Timezone-aware daily gate with last-run persistence.
- `src/poly/digest.ts:19` — `composeDigest(db)` → `{ text, ymd }`. Currently emits four sections:
  1. Top 5 markets by 24h volume
  2. High-edge signals pending review (last 24h, approved, edge ≥ `POLY_MIN_EDGE_PCT`)
  3. Open paper positions **count only** (not per-position detail)
  4. Realized P&L today
- `src/poly/index.ts:147-167` — wired into the 5-min tick via `digestInFlight` guard and `polyKvGet/Set` last-run-ymd persistence. Config: `POLY_DIGEST_HOUR` + `POLY_TIMEZONE`.
- `src/poly/digest.test.ts` — covers `shouldRunDigest` (happy path + midnight rollover).

Related primitives that already exist and should be reused, NOT reinvented:

- `src/poly/regime.ts` — `latestRegimeSnapshot(db)` returns `{ vix_bucket, btc_dom_bucket, yield_bucket, composed_tag, created_at }`.
- `src/poly/calibration.ts` — `latestSnapshot(db)` returns `{ brier_score, log_loss, n_samples, by_regime_json, created_at }`.
- `src/poly/pnl-tracker.ts` — `getDailyRealizedPnl` already used by telegram-commands.ts.
- `src/poly/format.ts` — `fmtUsd`, `fmtPrice`, `truncateQuestion`.
- `src/poly/telegram-commands.ts` — existing renderers (`renderPositions`, `renderRegime`, `renderCalibration`) are reference templates for the new digest sections' formatting style.

## 2. Literature / NotebookLM finding

No literature needed. Straightforward extension of an existing daily-summary cron pattern.

## 3. Duplicate / complement / conflict verdict

**Complement.** The existing digest covers opportunity surface (top volume + high-edge signals). It does NOT cover the **operator monitoring surface** needed for Phase B validation (Sun 04-19 resolution-fetch first fire, subsequent calibration data arrival).

Gap → add three sections to `composeDigest`:

- **Regime snapshot**: VIX bucket / BTC-dom bucket / 10y-yield bucket + composed tag, with staleness age. Pulled from `latestRegimeSnapshot`.
- **Calibration tail**: most recent Brier + log-loss + n_samples. Pulled from `latestSnapshot`. Shows `(no resolutions yet)` until Sun 04-19+.
- **Open positions detail**: per-position line (slug + outcome + entry price + current price if available + unrealized P&L), not just the count. Pulled from `poly_paper_trades` + most recent `poly_price_history` rows. Cap at 10 for Telegram length.

Not duplicate (digest already exists but these sections don't). Not novel (each sub-piece has a rendering precedent in `telegram-commands.ts`). Not conflict (purely additive text at the bottom of the message, no behavior change to trades or gates).

## 4. Why now

- **Monitoring metric**: Phase B (2026-04-19 → 04-26) depends on operator noticing the first resolution cycle. Current digest won't change perceptibly when resolutions start arriving — only the opportunity sections (markets + edge signals) update. Without calibration tail in the digest, the operator has to remember to run `/poly calibration` manually. That's the gap the expansion closes.
- **Latency metric**: zero new queries beyond the three `latest*` primitives; each is a single-row SELECT indexed on `created_at`. Digest compose time stays < 50ms (current average).
- **Timeline**: one sprint turn. Ship before 2026-04-20 07:00 ET so Monday's first-after-resolution digest already shows calibration state (even if still empty).

## 5. Out of scope

- NOT changing `shouldRunDigest` logic or cron timing.
- NOT adding new DB queries beyond the three `latest*` primitives already exported.
- NOT rewriting `composeDigest` signature; keep `(db: Database.Database) → { text, ymd }`.
- NOT adding emoji or fancy formatting beyond what `telegram-commands.ts` already uses.
- NOT wiring a new standalone `/poly briefing` command — the existing daily cron already delivers this; a command would duplicate.

## 6. Risk

Zero blast radius. Pure additive text in a Telegram message. Failure modes: (a) new section query errors, mitigated by `try/catch` around each new block returning an empty-section placeholder; (b) message length exceeds Telegram limit, mitigated by the existing `truncateForTelegram` helper if digest starts using it.

## 7. Verification plan

- **Unit:** `composeDigest` output text contains substrings `Regime:`, `Calibration:`, `Open positions:` (with detail lines) when data is present.
- **Unit:** When no regime snapshot exists, digest emits `Regime: (no data)` cleanly — no throw.
- **Unit:** When no calibration snapshot exists, digest emits `Calibration: (no resolutions yet)`.
- **Unit:** Position detail lines cap at 10 even when 20+ positions exist.
- **Integration:** next daily digest fire in pm2 logs shows all three new sections populated or their empty placeholders.
- **30-day:** operator can answer "what's the current regime?" and "what's our Brier?" from the digest alone, no manual `/poly regime` or `/poly calibration` calls required.
