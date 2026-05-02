# Sprint 26 — Swap news-sync from Perplexity REST to pwm CLI (MCP path)

**Verdict:** complement (replaces Sprint 18's `defaultPerplexityFetcher` REST implementation; runNewsSync orchestrator + tests + injection seam unchanged)
**Track:** Polymarket — `src/poly/news-sync.ts`, `scripts/news-sync.ts`
**Tier:** 2 (no risk-gates.ts or paper-broker.ts touched)

## Context

Sprint 18 (`0800872`) reached for Perplexity REST because Sprint 13's kind=claude-agent path was forcing a Claude Code subprocess every 2h at ~$0.19/call (~$68/mo). REST removed the subprocess but introduced a different friction: Perplexity API key procurement, billing, and rotation cadence.

Operator direction (2026-05-01): "We should be using the Perplexity MCP and not the API."

## Existing-code audit

- `src/poly/news-sync.ts:114` — `defaultPerplexityFetcher` does `fetch('${baseUrl}/chat/completions', ...)` against Perplexity REST.
- `src/poly/news-sync.ts:145` — `runNewsSync` orchestrator gates on `config.apiKey` truthiness as the "skip cleanly" signal.
- `scripts/news-sync.ts:30-33` — passes `PPLX_API_KEY`, `PPLX_BASE_URL`, `PPLX_NEWS_MODEL` from config.
- Tests at `src/poly/news-sync.test.ts` use the `fetcher` injection seam — they don't depend on the default implementation.

Verdict: **complement.** Tests remain valid; only the default fetcher body changes.

## Why pwm CLI (Path A) over alternatives

- **`pwm api` localhost sidecar (Path B)**: zero news-sync code change, but adds a pm2 process to manage and an extra port to coordinate. Overkill for a 12-call/day cadence.
- **Re-spawn Claude Code subprocess (Path C)**: $68/mo cost was Sprint 18's exit reason; reversing that without new evidence violates the anti-goal "don't restore what was removed without strong reason."
- **`pwm ask` subprocess (Path A)**: spawn-per-call cost is ~150-300ms (Python startup + HTTP), negligible at 2h cadence. No port/process management. Free Sonar tier via `--intent quick`. Verified output shape via source read.

## pwm output shape (verified)

`pwm ask <query> --json --intent quick --source web` writes to stdout (UTF-8):

```json
{
  "answer": "<full text body>",
  "citations": ["<url1>", "<url2>", ...],
  "model": "sonar",
  "source": "web"
}
```

Confirmed at `site-packages/perplexity_web_mcp/cli/main.py:134-136` (orjson.dumps of `{"answer": answer_text, "citations": citations, "model": model_name, "source": source}`).

Auth errors: pwm exits non-zero, prints `AuthenticationError` to stderr.
Rate-limit errors: same exit-non-zero + stderr pattern (`RateLimitError`).

## Design

`pwmCliFetcher: PerplexityFetcher` in `src/poly/news-sync.ts` wraps `spawn('pwm', ['ask', prompt, '--json', '--intent', 'quick', '--source', 'web'])`. Returns a `PerplexityResponse` shape compatible with the existing `extractSummary` (so the rest of the pipeline is unchanged).

**Windows path safety**: `pwm.exe` is a real .exe (not .cmd/.bat), so the Node 24 EINVAL hardening (CVE-2024-27980, recently patched in scheduler.ts) does NOT trigger. `shell: false` is correct.

**Encoding**: pwm writes UTF-8. Pass `PYTHONIOENCODING=utf-8` in env to defang Python's cp1252 fallback on Windows consoles.

**Skip-vs-error gate**: keep `runNewsSync`'s `if (!config.apiKey) skip` semantics. Operator sets `PPLX_API_KEY=pwm` (or any truthy sentinel) to enable; the value is no longer used as an HTTP credential but the env-var presence acts as the on/off switch. This preserves the exit-0-on-skip behavior without restructuring the orchestrator.

**Default fetcher swap**: rename the REST impl to `restFetcher` (kept for backward-compat tests), set `defaultPerplexityFetcher = pwmCliFetcher`. Tests that inject `fetcher` continue to bypass the default.

## Tests

In `src/poly/news-sync.test.ts`, new describe block for `pwmCliFetcher`:

1. Spawns pwm with the expected argv (`ask`, `--json`, `--intent quick`, `--source web`).
2. Parses well-formed JSON stdout into a `PerplexityResponse` with `choices[0].message.content === answer`.
3. Rejects when pwm exits non-zero, surfacing stderr in the error message.
4. Rejects when stdout is not parseable JSON.
5. Sets PYTHONIOENCODING=utf-8 in env.

Mocks the spawn boundary using a small fake (no real pwm calls). Existing tests stay valid because they inject `fetcher` directly.

## Operator handoff

- After this commit lands and `pwm login` is run (one interactive OTP step), set `PPLX_API_KEY=pwm` in `.env` (or any truthy placeholder), then `pm2 restart claudeclaw-main`.
- News-sync's next 2h cron tick will route through pwm.
- The free Sonar tier (`--intent quick`) covers the cadence with margin; Pro Search and Deep Research quotas are untouched.
- Failure modes (auth expired, rate-limited) surface as Telegram error messages on the cron tick. Same as REST.

## How this changes our code/strategy

Removes Perplexity API as a billing surface. Aligns the data path with the operator's "MCP-first" direction. Cron continues to fail-closed when auth is unavailable. Sprint 21 intersection alerts remain dormant until pwm auth + sentinel env are both in place — same gate as before, different auth provider.
