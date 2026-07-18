# 2026-07-18 Repo Review and Fix Plan

Full-repo review (code, runtime, tests, deps) with three independent read-only review
tracks. Baseline: typecheck clean, 1026/1026 tests pass, bot online, halt clear.

## The wedge (why the mission is stuck)

The system is deadlocked on one bug:

1. `fetchMarketBySlug` (src/poly/gamma-client.ts:178-189) queries Gamma
   `/markets?slug=X` WITHOUT `closed=true`. Gamma silently excludes closed markets
   from that query, so the moment a market resolves it returns an empty array.
   The comment at lines 174-177 claiming closed markets are returned is wrong
   (verified against the live API on three resolved markets, 2026-07-18).
2. Therefore `poly_resolutions` has 468 rows and ZERO with closed=1 — ever.
   `fetch-resolutions.ts` records resolved markets as "miss" (last run: 75 slugs,
   ok=19 miss=41+ closed=0) and never updates the frozen cache rows.
3. Therefore PnlTracker can never classify a trade won/lost. Lifetime totals:
   0 won, 0 lost, 172 voided (all `voided_reason='delisted'` — really resolved
   markets that vanished from the plain query), 50 stuck open (12+ past end date,
   up to 11 days beyond grace).
4. Therefore the book is saturated at 50/50 slots: all 9,047 signals in the last
   24h were rejected (`open_position_count 50 >= max 50`), zero approvals, and the
   LLM eval spend continues for signals that cannot be approved.
5. Therefore MISSION Box 2 (50 settled trades) is structurally frozen at 0/50.

Fix is ~6 lines: on empty result, retry once with `&closed=true`; fix the comment.
gamma-client.ts is a Tier-2 surface. Downstream, the OTHER active session's
uncommitted Sprint 30 diff in pnl-tracker.ts (`recoverVoidedFromCache`) sweeps the
172 voided trades once closed=1 rows exist — it should land as-is; it currently
recovers zero because the upstream feed is blind.

Sequencing after deploy: fetch-resolutions backfill run → hourly runOnce resolves
the 50 stuck-open trades → Sprint 30 recovery reclassifies voided ones. That alone
should clear the 50-settled-trade sample several times over. Note: realized P&L may
come out negative (open book unrealized has been -$500..-760); Box 2 needs positive
realized P&L — that is evidence to observe, not engineer.

One market (`strait-of-hormuz...by-july-15`) is genuine upstream UMA lag, not ours.

## Other broken things found

- **news-sync silently dead since 2026-06-28** (19+ days). Cron 3d623e0e reports
  lastStatus=success every 2h but `source_freshness.news-sync` last_success is
  frozen at 2026-06-28. Violates TRUST "no silent failures". Root-cause or disable.
- **Stale marks:** 31/50 open positions have marks >2h old (oldest 282h). Price
  capture covers only 80 of 996 scanned markets. Mostly a casualty of the wedge
  (resolved markets stop trading) — re-verify after the resolution fix, then fix
  what remains.
- **poly-resolution-watch-a7be shows lastStatus=failed** — by design (exits 1 when
  FAIL rows exist). Working, but reads as a broken cron in scheduler status.

## Risk-control defects (from code review; paper-only today but they poison the
calibration data the real-money case will be built on)

- **P0** Stale-orderbook re-validation is a no-op. strategy-engine.ts:375-379
  snapshots bestAsk, then up to 3 LLM calls run before execute() at :440 uses the
  same snapshot. risk-gates.ts:195 and paper-broker.ts:47 compare that snapshot to
  itself → price-drift guard can never fire. Fix: re-fetch book after LLM eval,
  pass fresh bestAsk into gates + broker. (paper-broker/risk-gates deploys = Tier 3.)
- **P1** No fetch timeout anywhere (gamma-client.ts:13, clob-client.ts:21/31).
  One hung socket wedges `scanning`/`running` guards forever — same class as the
  2026-04-20 silent stall. Fix: AbortController + timeout + bounded retry.
- **P1** Depth gate counts all ask levels as fillable at best ask
  (clob-client.ts:15, risk-gates.ts:190-191) and paper fill books 100% at best ask
  (paper-broker.ts:54,61) → systematically inflates paper P&L and calibration.
  Fix: walk the book (VWAP fill) or gate on best-level depth only.
- **P1** Caps/sizing anchored to static POLY_PAPER_CAPITAL, not live equity
  (risk-gates.ts:89,116; strategy-engine.ts:577-580) → over-betting after drawdown.
- **P2** Halt flag checked per tick, not per candidate (strategy-engine.ts:324).
- **P2** initPoly() result dropped in index.ts:214 → stop() never wired to shutdown.
- **P2** Market-upsert SQL triplicated in market-scanner.ts (205-212, 283-289…).
- Also: when slots are full, skip LLM evaluation entirely (9k wasted evals/day).

Clean bill: gate ordering (no path to execute() without gates.passed), Kelly NaN
guards, 0-1 vs percent conventions, sec-vs-ms conventions, calibration.ts.

## Security / dependencies

`npm audit`: 3 critical, 7 high, 10 moderate.

| Fix action | Clears |
|---|---|
| `npm audit fix` (non-major) | **protobufjs CRITICAL** (via @google/genai), hono + @hono/node-server highs, ws high (dual-sourced via @google/genai AND whatsapp-web.js) |
| Remove `@slack/web-api` (UNUSED, zero imports) | axios SSRF high, form-data high |
| Remove `@anthropic-ai/sdk` (UNUSED, zero imports) | dep-surface only |
| Remove `whatsapp-web.js` + `qrcode-terminal` + orphan `scripts/wa-daemon.ts` (not wired to any npm script) | basic-ftp high + one ws path |
| `vitest@4` + `@vitest/coverage-v8@4` major upgrade | 2 dev-only criticals + vite high (defer; test-tooling only) |

Also outdated: @anthropic-ai/claude-agent-sdk 0.2.50 vs 0.3.210 (major drift on the
core agent runtime), better-sqlite3 11→12, pino 9→10. Upgrade deliberately, later.

## Hygiene

- PA-era modules (voice, obsidian, media, profile, learning, gemini, orchestrator,
  memory-*, notifications…) are DORMANT BUT WIRED into bot.ts/index.ts/dashboard.ts
  — not safe deletes; stripping them is an import-cutting refactor (separate sprint,
  operator decision on which surfaces to actually kill).
- Provably dead now: `src/battle-test.ts` (94 lines).
- DB 272MB and regrowing (poly_eval_cache 115k, poly_signals 105k rows). Another
  active session has untracked `scripts/_prune.ts` targeting exactly this —
  coordinate, don't duplicate.
- dashboard-html.ts is 3,519 lines but LIVE; split only if touched.

## Prioritized plan

**Sprint R1 — Resolution repair (P0, unblocks everything)**
1. TDD gamma-client closed=true fallback (+ verify closed=true returns empty for
   still-open markets so ordering preserves behavior). Fix false comment.
2. Coordinate with the session that owns the uncommitted Sprint 30 pnl-tracker diff;
   land theirs as-is (Tier-3 deploy approval needed).
3. Deploy, run fetch-resolutions backfill, watch hourly runOnce settle the book.
4. Verify: `npm run capacity:status` — settled-calibration leaves
   waiting_for_settlements; resolution watch FAILs drain; slots free up.

**Sprint R2 — Reliability + honest alarms (P1)**
5. Fetch timeouts/AbortController in gamma-client + clob-client (+ scanner guard
   release on error paths).
6. news-sync: root-cause silent failure or disable the cron with an honest alert.
7. Skip LLM eval when 0 slots free.

**Sprint R3 — Risk-gate integrity (P1, Tier-3 deploys)**
8. Real pre-fill re-validation (fresh book fetch before gates/execute).
9. Depth-aware fill or best-level depth gate.
10. Equity-anchored caps/sizing.
(One approval bundle for Richard; regression tests per HEARTBEAT sacred rule.)

**Sprint R4 — Security + cleanup (P2)**
11. Remove @slack/web-api, @anthropic-ai/sdk, whatsapp-web.js, qrcode-terminal,
    wa-daemon.ts, battle-test.ts; run `npm audit fix`; verify tests + boot.
12. Halt-per-candidate, wire stop() into shutdown, dedupe upsert SQL.
13. DB prune (coordinate with other session's _prune.ts).

**Deferred / operator-decision**
- vitest 4 major, agent-sdk upgrade, PA-module strip refactor, dashboard split.

## Needed from Richard before implementing

1. **Tier-3 approval bundle:** Sprint 30 pnl-tracker deploy (other session's diff),
   plus R3 items touching risk-gates.ts/paper-broker.ts. R1's gamma-client change
   is Tier-2 but feeds realized P&L — recommend explicit nod anyway.
2. **Session coordination:** 2 other Claude/Codex sessions active in this checkout;
   one owns the pnl-tracker diff and the _prune scripts. Decide who lands what, or
   give this session the green light to proceed around their files.
3. **WhatsApp surface:** confirm wa-daemon.ts / whatsapp-web.js can be retired.
4. **news-sync:** fix or kill? (It has produced nothing for 19 days.)
