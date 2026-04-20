# Sprint scheduler-exorcism — route trivial crons off Claude CLI (v1.11.0)

## 1. Existing-code audit

- `src/scheduler.ts::runDueTasks` — fires every scheduled task through
  `runAgent()` unconditionally (line ~121 pre-change). One code path
  for all tasks regardless of whether the work is agentic.
- `src/agent.ts::runAgent` — spawns the `claude` CLI subprocess via
  `@anthropic-ai/claude-agent-sdk`. Reads `CLAUDE_CODE_OAUTH_TOKEN` or
  `ANTHROPIC_API_KEY` from `.env` via `readEnvFile`.
- `scripts/research-ingest.ts` — already a standalone script. Runs the
  RSS/Atom fetcher and writes to `research_items`.
- `scripts/fetch-resolutions.ts` — already a standalone script. Iterates
  distinct slugs, fetches Gamma closed markets, UPSERTs
  `poly_resolutions`.
- No existing `spawn` or `child_process` usage in `src/scheduler.ts`.
- `scheduled_tasks` schema: 11 columns post-migrations. No `kind` or
  `script_path`.

## 2. Literature / NotebookLM finding

Not applicable — this is a routing change against an internal dispatch
point, not a research question.

## 3. Duplicate / complement / conflict verdict

**Complement.** Adds dispatch; does not remove the claude-agent path.
The v1.11.0 migration adds two columns with a `DEFAULT 'claude-agent'`
so zero existing rows change behavior. New routing only activates for
rows explicitly updated by `scripts/migrate-cron-kinds.ts`.

## 4. Why now

The 2026-04-13 trading-only pivot took ~1014 LOC off the PA surface but
left `src/scheduler.ts` unchanged. Every scheduled cron still requires
the Claude CLI, which means:

- Post-2026-04-18 halt, every cron fire hits the `ANTHROPIC_API_KEY=` +
  `CLAUDE_CODE_OAUTH_TOKEN?` auth maze. The subprocess can init a session
  (saw this at 2026-04-20 05:35:54 in the log) and then hang because
  there's no tokens to actually query Anthropic. The scheduler's
  `messageQueue.enqueue` chain stays parked forever, blocking
  subsequent scheduled tasks for the same chat.
- It's a Max-OAuth-in-headless-prod ToS grey area (see
  `docs/research/sprint-glm-migration.md` §2).

Post-change the scheduler has ZERO mandatory Claude CLI surface:

| Task | Kind | Requires Claude? |
|---|---|---|
| news-sync | paused | No (paused, redundant with research-ingest) |
| research-ingest | shell | No |
| resolution-fetch | shell | No |
| adversarial-review | claude-agent | Yes — gated by auth preflight |

`adversarial-review` runs weekly Sun 18:00 ET. If no OAuth + no API key
is configured at the time of fire, `runClaudeAgentTask` returns a
"skipped — no auth" message without spawning anything. So the bot can
operate indefinitely in GLM-only mode and only revive Claude
auth when the operator wants adversarial reviews.

## 5. Out of scope

- Revival of `news-sync` under a direct Perplexity API key. If the
  operator wires `PPLX_API_KEY` later, `news-sync` can be updated to
  `kind='shell'` pointing at a new `scripts/news-sync.ts`. Not doing
  that here — research-ingest already covers the trading-research
  surface at weekly cadence.
- Migration of `adversarial-review` to GLM. Genuinely agentic; plausible
  migration target, but the GLM subscription may not have enough
  reasoning depth for the critic role. Deferred.
- Any change to `src/agent.ts::runAgent` beyond the auth preflight
  inside the scheduler. `runAgent` is still used by the Telegram
  interactive path where operator auth is present.

## 6. Risk

- **Auth preflight false negative**: if the user has OAuth but
  `readEnvFile` misses it (token lives in `~/.claude/` not `.env`), the
  preflight might skip a task unnecessarily. The existing runAgent path
  relies on Claude CLI's own auto-discovery of `~/.claude/`. Mitigation:
  the preflight only gates when BOTH secrets are empty in `.env`; a
  populated `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` proceeds
  as before.
- **Shell task security**: `kind='shell'` spawns `npx tsx <script_path>`
  with the parent's env. `script_path` comes from the DB and is written
  only by our migration script + the (locally-run) scheduler. No
  user-controlled input path. Not a new attack surface vs `runAgent`.
- **Stdout size**: scripts with noisy output get truncated to 3500 chars
  (existing scheduler pattern). Matches existing last_result column
  limits.

## 7. Verification plan

- `scripts/migrate-cron-kinds.ts` runs idempotently; verify with
  `scripts/check-scheduler-state.ts` that 4 crons have the expected
  `kind` + `script_path` + `status`.
- After restart, next fire of `research-ingest` (Sun 06:00 ET) appears
  in `docs/research/ingestions/YYYY-MM-DD.md` AND `research_items`
  row count increases (currently at 45 items). No "Starting agent query"
  log line appears for this task.
- Next fire of `resolution-fetch` (Sun 07:00 ET) populates
  `poly_resolutions`. Same log absence check.
- When `adversarial-review` fires (Sun 18:00 ET): either creates
  `docs/research/weekly-adversarial-YYYY-MM-DD.md` (if auth present) OR
  logs "claude-agent task skipped — no CLAUDE_CODE_OAUTH_TOKEN or
  ANTHROPIC_API_KEY" and sends the "no auth" Telegram.
