# Operator Action Checklist — 2026-05-11

> Copy-paste-ready Telegram message. Each line is an operator action that closes a real-money gate sub-condition, unblocks a sprint, or removes an open chore.
> Phase 3 of plan `review-this-code-base-rustling-whistle.md`. Estimated total operator time: **~20 minutes**.

---

## 1. MISSION.md sign-off log — three pending acks (closes Box 7)

`MISSION.md` lines 86-88 still read **PROPOSED** since 2026-04-21. Each line needs the word `PROPOSED` struck through and replaced with `ACK 2026-05-11` (or override with replacement reasoning).

- **A1 — Gate-clock reading: PERMISSIVE.** Operator-directed deploy restarts during the 30-day clock don't reset it. Default: `ACK`. If you want to be stricter and treat any restart as a reset, override with new reasoning.
- **A2 — Defer reflection / exit / exposure-aware sizing flags pre-calibration.** Phase-3 flag flips wait for ≥15-20 resolved trades. Default: `ACK`. **Note:** Phase-4 P&L verification (`docs/research/2026-05-11-box2-pnl-verification.md`) found 0 resolved trades, so this defer is now mandatory regardless.
- **A3 — Defer adversarial-review OAuth.** Sunday cron skip-mode is correct without resolution data to ground the critique. Default: `ACK`.

## 2. `EMERGENCY_KILL_PHRASE` setup (kill-switch §3a)

`docs/runbooks/kill-switch-drill.md` notes the fastest halt path is inactive because `EMERGENCY_KILL_PHRASE` is unset in `.env`. Pick a phrase you'd remember under stress (e.g., a few unrelated words you'd never type by accident). Add to `.env`. Restart with `pm2 restart claudeclaw-main --update-env`.

## 3. `.env.stale-2026-04-26.bak` Anthropic key rotation

The leaked Anthropic key is local-disk-only (verified — `git log --all` zero hits). Two steps:
- Rotate the key at the Anthropic console (revoke old, generate new, update `.env` with new value).
- Delete `.env.stale-2026-04-26.bak`.

## 4. `pwm login` + `PPLX_API_KEY=pwm` (activates news pipeline)

Required for Sprint 18 news-sync + Sprint 21 intersection alerts.
```powershell
pwm login           # interactive OTP, ~30s
# In .env, set:    PPLX_API_KEY=pwm
pm2 restart claudeclaw-main --update-env
```
Verify:
```powershell
pwm doctor          # should show non-zero Pro Search remaining
```

## 5. `OPERATOR_EMAIL` (unblocks Sprint Email-A)

Email address where weekly trading digest should land. Set in `.env`:
```
OPERATOR_EMAIL=your-address@example.com
```
After setting: Sprint Email-A becomes shippable (`docs/research/agent-mail-integration.md`).

## 6. `POLY_RESEARCH_NOTEBOOK_ID` (unblocks Sprint 4.5)

Create a "ClaudeClaw Research" notebook in NotebookLM. Copy the notebook ID. Set in `.env`:
```
POLY_RESEARCH_NOTEBOOK_ID=<id>
```
After setting + pm2 restart: weekly research-ingest cron uploads `research_items` rows automatically.

## 7. `CLAUDE_CODE_OAUTH_TOKEN` (wakes adversarial cron)

Currently the Sunday 18:00 ET adversarial-review cron silent-skips because `kind=claude-agent` rows lack auth. Add to `.env` to enable; the bot will then spawn Claude Code sessions on cron fires.

**Note (A3):** with Box-2 P&L at 0 resolved trades, adversarial review will produce speculative critique, not actionable findings. Setting this token now is harmless but won't add value until ≥15 trades have resolved. Recommended: defer until late 2026-Q2 / early 2026-Q3.

## 8. `.gitignore` extension — ✅ DONE 2026-05-11

Shipped in commit `9ee256c` `[chore] gitignore: add .env*.bak`. `.gitignore` line 9 now reads `.env*.bak`. No operator action needed.

---

## Order of operations (recommended)

1. A1 + A3 sign-offs (60 sec each, zero risk) — start of session.
2. A2 sign-off after reading `docs/research/2026-05-11-box2-pnl-verification.md` (~3 min).
3. `EMERGENCY_KILL_PHRASE` + `pm2 restart --update-env` (~5 min).
4. `pwm login` + `PPLX_API_KEY=pwm` + restart (~5 min).
5. `.env.stale` rotation + delete (~5 min).
6. `OPERATOR_EMAIL` decision (any time).
7. `POLY_RESEARCH_NOTEBOOK_ID` (any time, optional).
8. `CLAUDE_CODE_OAUTH_TOKEN` (defer per A3 logic).

## What you do NOT have to do today

- Capital changes (`POLY_MAX_TRADE_USD`, `POLY_PAPER_CAPITAL`, `POLY_HALT_DD_PCT`) — Tier 3, no operator-side change needed unless you're changing the envelope.
- Phase-3 flag flips (`POLY_REFLECTION_ENABLED`, `POLY_EXIT_ENABLED`, `POLY_EXPOSURE_AWARE_SIZING`) — gated on Phase 4 P&L data, which is at 0 resolved. Default: stay off.
- Real-money authorization — Box 2 is structurally blocked (Q4 2026 projection per Phase 4). Do not lobby to bypass.
