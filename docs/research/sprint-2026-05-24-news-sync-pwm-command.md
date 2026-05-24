# Sprint 2026-05-24 - News Sync pwm Command Drift

## Scope

Fix the news-sync subprocess command after `npx tsx scripts/news-sync.ts`
failed with:

```text
[news-sync] FAILED: fetch failed: Error: pwm exit 2: Usage: pwm [OPTIONS] COMMAND [ARGS]...
```

## Existing-Code Audit

Commands run:

```bash
rg -n "news-sync|pwm|ask-cmd|Perplexity" package.json scripts src docs -S
pwm --help
pwm ask --help
pwm ask-cmd --help
pwm ask-cmd "Respond with OK only." --json --intent quick --source none
npx vitest run src/poly/news-sync.test.ts
```

Findings:

- `src/poly/news-sync.ts` wraps the local `pwm` CLI through `makePwmCliFetcher`.
- Existing tests asserted the old argv: `pwm ask ...`.
- Installed `pwm` is `perplexity-web-mcp-cli 0.9.5`.
- `pwm ask` now exits with "No such command 'ask'".
- `pwm ask-cmd` is the current command and supports the same `--json`,
  `--intent`, and `--source` flags.
- A smoke query returned JSON with an `answer` field, matching the parser
  contract already in `makePwmCliFetcher`.

## Verdict

Duplicate: no duplicate implementation found.

Complement: this complements Sprint 26's pwm CLI route by updating the command
name to the currently installed CLI.

Conflict: the old code conflicted with local `pwm 0.9.5`, where `ask` no
longer exists.

Novel: the regression test now locks the subprocess argv to `ask-cmd` so future
CLI drift is caught before the scheduled news sync goes stale.

## How This Changes Code Or Strategy

No strategy change. News sync remains advisory trading context only. The fix
restores the existing two-hour news heartbeat path so source freshness can go
green when `pwm` is authenticated and Sonar returns usable current headlines.
