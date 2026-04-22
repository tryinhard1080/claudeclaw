# Kill-Switch & Rollback Drill

Authoritative procedure for halting ClaudeClaw trading and rolling back code or data. Maps to MISSION.md gate box 6: "Documented kill-switch and roll-back procedure tested."

**Status as of 2026-04-21**: documented (this file) + read-only verification done (see §4). Live drill (actually halting + resuming the bot) is deferred until the operator explicitly schedules one — every drill is a planned intervention against the 30-day no-intervention gate clock.

## 1. Trigger

Run this procedure when ANY of the following is true:

- Daily realized P&L approaches `POLY_HALT_DD_PCT` (default 0.20 = 20% drawdown floor) and operator wants pre-emptive stop.
- Bot exhibits unexpected behavior — repeated failed trades, stuck scanner, runaway exposure, signals against an obvious anti-pattern.
- Upstream (Polymarket Gamma / CLOB API) has a confirmed outage and the bot keeps trying.
- Real-money mode is being enabled and the operator wants a known-good drill rehearsed within the prior 7 days.
- Migration / deploy went sideways and a code or DB rollback is the safer path forward.

## 2. Preconditions

Before halting:

- [ ] Confirm the operator (Richard) is at the keyboard or has explicitly delegated the action.
- [ ] Capture a snapshot of current state: `pm2 list`, `git log -1 --oneline`, current open-position count via `/poly status` or `/api/poly/overview`. Save to `docs/runbooks/incidents/<YYYY-MM-DD-HHMM>.md` if this is responding to a real incident.
- [ ] Note current claudeclaw restart count from `pm2 list` — every restart resets the gate clock unless the incident is force-majeure.
- [ ] If rolling back DB: confirm a usable backup exists at `/c/claudeclaw-store/backup-<DATE>/` with matching `*.sha256` checksum.
- [ ] If rolling back code: confirm the previous commit is buildable — `git log --oneline -10` to find the target SHA.

## 3. Procedure

Three independent sub-procedures. Pick the one that matches the trigger.

### 3a. Halt trading (FAST — emergency kill phrase) — ⚠️ CURRENTLY INACTIVE

**As of 2026-04-21 this path does NOT work.** `EMERGENCY_KILL_PHRASE` env var is unset in `.env` (verified: `grep -c '^EMERGENCY_KILL_PHRASE=' .env` returns 0). `src/config.ts:199-200` falls back to empty string, and `src/security.ts:155-158` (`checkKillPhrase`) returns `false` when the phrase is empty. Sending any Telegram message — including a literal phrase like "kill" — will not trigger the emergency exit.

**To activate** (Tier 3 — requires operator approval, edits config + restart, counts against gate clock):
1. Choose a non-obvious phrase the operator will memorize (e.g., a passphrase string, not a single word).
2. Append `EMERGENCY_KILL_PHRASE=<phrase>` to `.env`.
3. `pm2 restart claudeclaw`.
4. Test by sending a non-matching message (should NOT exit) then the matching phrase from `ALLOWED_CHAT_ID=5427253313` (should exit).

**Once active, the procedure is**:
1. From the operator's Telegram, send the exact phrase stored in `EMERGENCY_KILL_PHRASE`.
2. The bot's security handler (`src/security.ts:164` `executeEmergencyKill`) calls `process.exit(1)` after a 5s timeout.
3. pm2 sees the exit and (because `autorestart: true` in `ecosystem.config.cjs`) will try to restart in ~10s. To prevent restart, run `pm2 stop claudeclaw` from the host shell within that window.

**Effect (when active)**: all in-flight trade requests aborted. Message queue drains up to 5s (`src/index.ts:220-237`). Scanner stops; no new signals; no new trades. Existing open positions remain in `poly_paper_trades` with status='open'. PnlTracker tick stops, so `poly_positions.unrealized_pnl` becomes stale.

**Until §3a is activated, §3b is the de-facto fastest halt path** — only ~5 minutes of latency until the next strategy tick reads the flag.

### 3b. Halt trading (CONTROLLED — DB flag, no restart)

**Use when**: you want the bot to stop opening new positions but stay running so you can inspect state, query the dashboard, and resume cleanly.

This sets `poly.halt='1'` in the `poly_kv` table. `StrategyEngine` reads the flag at the start of every `onScanComplete` tick (`src/poly/strategy-engine.ts:264, 271`) and skips signal evaluation when set. Scanner keeps running (so dashboard data stays fresh) but no new signals are generated and no new trades open.

**Procedure**:

1. From the host shell, write the flag via better-sqlite3 (sqlite3 CLI is not installed on this Windows box):
   ```
   cd "/c/Users/Richard/OneDrive - Greystar/Documents/Code Projects/CCBot1080/claudeclaw"
   node -e "const Database = require('better-sqlite3'); const db = new Database(process.env.STORE_DIR + '/claudeclaw.db'); db.prepare(\"INSERT INTO poly_kv(key,value) VALUES('poly.halt','1') ON CONFLICT(key) DO UPDATE SET value='1'\").run(); console.log('halt set');"
   ```
2. Wait up to 5 minutes for the next scanner tick. Confirm via `/poly status` Telegram command — should show "Halt: YES" (`src/poly/telegram-commands.ts:182`).
3. Open positions remain open. PnlTracker.runOnce keeps updating their unrealized P&L on each tick. Resolutions still flow through if they happen.

**Effect**: trade flow stops at next tick. Bot stays up. Dashboard stays live. Restart count unchanged.

### 3c. Halt trading (NUCLEAR — POLY_ENABLED=false + restart)

**Use when**: you want the entire Polymarket subsystem disabled at startup. Requires a restart, so this counts as a manual intervention against the gate clock.

1. Edit `.env` and change `POLY_ENABLED=true` to `POLY_ENABLED=false`.
2. `pm2 restart claudeclaw`.
3. On boot, `src/poly/index.ts:55` returns null stubs for scanner / strategy / pnl. No Polymarket activity at all.

**Effect**: total Polymarket shutdown. Bot still runs (Telegram, regime-trader bridge, scheduler) but no Poly tick. Dashboard `/api/poly/*` routes return whatever's already in DB; no new data flows.

### 3d. Resume after a controlled halt (3b)

1. Clear the flag:
   ```
   node -e "const Database = require('better-sqlite3'); const db = new Database(process.env.STORE_DIR + '/claudeclaw.db'); db.prepare(\"UPDATE poly_kv SET value='0' WHERE key='poly.halt'\").run(); console.log('halt cleared');"
   ```
2. Wait for next tick. `/poly status` should show "Halt: no". Trading resumes.

### 3e. Code rollback (revert a deploy)

**Use when**: a recent commit on `main` is causing problems and you want to roll back to a known-good earlier commit.

1. Identify the bad commit and the target good commit:
   ```
   git log --oneline -20
   ```
2. Halt trading FIRST via §3b (DB flag). Don't roll back code while live trades are flowing.
3. Revert (preserves history; preferred):
   ```
   git revert <bad-sha>
   ```
   Or — if the bad commit hasn't been pushed beyond your local main and you accept losing it from history — `git reset --hard <good-sha>`. This is **destructive**; only use if you understand the consequences.
4. `npm run build` — confirms the rolled-back code compiles.
5. `npm test` — confirms 586+ tests pass on the rolled-back code.
6. `pm2 restart claudeclaw`.
7. Resume trading per §3d (clear `poly.halt` flag).

### 3f. DB rollback (restore from backup)

**Use when**: a DB-corrupting incident happened (bad migration, accidental DELETE, file system corruption, ransomware) and you want to restore the database file to a known-good prior state.

1. Halt trading per §3b or §3c — DO NOT skip this. Restoring the DB while writes are in flight will create a half-restored DB.
2. Stop the bot: `pm2 stop claudeclaw`.
3. Move the corrupt DB aside (preserve for forensics):
   ```
   mv /c/claudeclaw-store/claudeclaw.db /c/claudeclaw-store/claudeclaw.db.corrupt-$(date +%Y%m%d-%H%M)
   mv /c/claudeclaw-store/claudeclaw.db-wal /c/claudeclaw-store/claudeclaw.db-wal.corrupt-$(date +%Y%m%d-%H%M) 2>/dev/null
   mv /c/claudeclaw-store/claudeclaw.db-shm /c/claudeclaw-store/claudeclaw.db-shm.corrupt-$(date +%Y%m%d-%H%M) 2>/dev/null
   ```
4. Verify backup integrity:
   ```
   cd /c/claudeclaw-store/backup-<DATE>/
   sha256sum -c *.sha256
   ```
   All lines must end with `: OK`.
5. Copy backup files into place:
   ```
   cp /c/claudeclaw-store/backup-<DATE>/claudeclaw.db /c/claudeclaw-store/
   cp /c/claudeclaw-store/backup-<DATE>/claudeclaw.db-wal /c/claudeclaw-store/ 2>/dev/null || true
   cp /c/claudeclaw-store/backup-<DATE>/claudeclaw.db-shm /c/claudeclaw-store/ 2>/dev/null || true
   ```
6. Check applied-migration version against current code expectations:
   ```
   cat migrations/.applied.json
   ```
   (Note: file lives in the repo's `migrations/` directory, NOT in `STORE_DIR` — verified via `src/migrations.ts:29`.) If the backup is older than the current code's expected migration, you may need to roll code back to match (see §3e) or the next bot start will fail-fast on pending migrations (`src/migrations.ts`). **There is no DOWN migration support — you cannot move forward through a migration on a backup if the schema-changes are non-trivial.**
7. `pm2 start claudeclaw` and watch first scan in `pm2 logs claudeclaw --lines 50`.
8. Confirm DB size + WAL size are sane via `/api/poly/overview`.

## 4. Verifications

After any procedure above, verify ALL of the following:

| Check | Method | Pass criterion |
|---|---|---|
| Process state | `pm2 list \| grep claudeclaw` | `online` (or `stopped` if halted via §3a/§3c) |
| No new trades opening | `/api/poly/overview` → `signals.approvedToday` should not increment after halt time | confirmed via curl ~10 minutes apart |
| Halt flag visible | `/poly status` Telegram | "Halt: YES" (after §3b) or "Halt: no" (after §3d) |
| Open positions intact | `/api/poly/positions/live` | same `open_count` and same trade IDs as pre-halt snapshot (assuming no resolutions in window) |
| DB integrity | file sizes vs pre-incident | within ±5% of expected; WAL < 100 MB at steady state |
| Code SHA matches intended | `git rev-parse HEAD` | matches the target SHA (after §3e) |

**Read-only verifications run on 2026-04-21** (this file's drafting):

- ❌ **`EMERGENCY_KILL_PHRASE` env var is UNSET in `.env`** (`grep -c '^EMERGENCY_KILL_PHRASE=' .env` returned 0). `src/config.ts:199-200` falls back to empty string and `src/security.ts:155-158` returns `false` for empty phrase. **§3a path is currently INACTIVE.** Adding the var is Tier 3 (config + restart).
- ✅ `poly.halt` flag plumbing: `HALT_KEY = 'poly.halt'` at `src/poly/strategy-engine.ts:28`; `isHalted()` method at `:263`; tick-skip guard at `:271`. Verified by direct grep.
- ✅ `POLY_HALT_DD_PCT=0.2` default at `src/config.ts:229`. Verified by direct grep.
- ✅ Backup directory `/c/claudeclaw-store/backup-2026-04-20/` exists (verified via `ls -la /c/claudeclaw-store/`). SHA256 contents not re-verified — operator should run `sha256sum -c *.sha256` before any restore.
- ✅ Graceful shutdown handlers: `process.on('SIGINT', ...)` at `src/index.ts:238` and `'SIGTERM'` at `:239`. Verified by direct grep.
- ✅ Migration applied state: `migrations/.applied.json` exists with `{"lastApplied":"v1.12.0"}`. Note: file lives in repo `migrations/` directory, NOT in `STORE_DIR` (`src/migrations.ts:29`).
- ⏳ Live halt drill (§3b end-to-end) — DEFERRED. Each drill counts as a manual intervention against the gate clock. Schedule before real-money enable.

## 5. Rollback (of the procedure itself)

If you ran §3a (emergency kill) by accident: `pm2 start claudeclaw`. Bot resumes. Sanity-check `/poly status` and `/api/poly/positions/live` before declaring normal.

If you ran §3b (DB flag) by accident: run §3d (clear flag).

If you ran §3c (POLY_ENABLED=false) by accident: edit `.env` back to `POLY_ENABLED=true`, `pm2 restart claudeclaw`.

If you ran §3e (code rollback) by accident: `git revert HEAD` again to revert the revert, `npm run build`, `pm2 restart`.

If you ran §3f (DB restore) by accident: the original corrupt DB is preserved at `claudeclaw.db.corrupt-<TIMESTAMP>`. Halt trading per §3b, `pm2 stop`, move the restored backup aside, move the original back into place, restart. Note: you'll have lost any writes that happened during the brief restore window.

## 6. Outcome signature

Operator (Richard) signs off in `MISSION.md` Operator Sign-Off Log when:

- A drill of §3a + §3d is completed (halt-and-resume cycle), with timestamps and pm2 restart counts before/after.
- A drill of §3f is completed (backup restore on a non-prod copy of the DB at a minimum).
- A drill of §3e is completed (code revert + build + test, no actual restart needed for the drill).

Real-money trading is gated on all three drills having been completed within the prior 30 days, per MISSION gate box 6.

## Known gaps (not blocking documentation, but blocking full gate-checkbox close)

1. **`EMERGENCY_KILL_PHRASE` is unset** — §3a is dead code until the operator sets the env var and restarts. Highest-priority gap because it removes the fastest halt path entirely. Discovered 2026-04-21 during this runbook's verification step. Activation is one-time setup (set in `.env`, single restart), not ongoing maintenance.
2. **No `/poly halt` Telegram command** — currently requires `node -e` shell command (§3b). Regime-trader has `/trade halt` (`src/trading/telegram-commands.ts:103-110`); Polymarket should mirror it. Sprint candidate when the gate clock allows code work + restart.
3. **No automatic DB-flag halt on drawdown** — `gate2PortfolioHealth` rejects new signals at `POLY_HALT_DD_PCT` but does not SET `poly.halt`. The bot keeps trying to open positions on every tick (they get rejected). A small follow-up could write the flag once total DD crosses the threshold, so the engine short-circuits earlier and dashboard shows the halt state.
4. **No DOWN migrations** — DB rollback requires file-level restore from backup. For migrations that only ADD columns (additive), in-place rollback is feasible; for DROPs / RENAMEs it requires backup. Documenting which migrations are safely down-rollable is a future improvement.
5. **No automated backup cron** — current backup at `/c/claudeclaw-store/backup-2026-04-20/` was manual during the DB rescue. Real-money mode should have nightly automated backups with rotation (e.g., 7 daily + 4 weekly + 3 monthly).
