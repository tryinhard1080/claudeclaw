# Sprint 23 — Scheduler `spawn EINVAL` on Node 24 + Windows

**Verdict:** novel (closes a regression that the prior `[hotfix] d906198` no longer covers under Node 24)
**Track:** Ops (`src/scheduler.ts` — not under `src/poly/` or `src/trading/`, pre-commit hook does not gate this)
**Tier:** 2 (do then report — no risk-gates.ts or paper-broker.ts touched)

## Problem

`npm test` reports 646 passed / 1 failed. The failing case:

```
src/scheduler.test.ts > runShellTask (v1.11.0 dispatch) > reports non-zero exit from a missing script
→ spawn EINVAL
  src/scheduler.ts:57:19
```

The call site:

```ts
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(npxBin, ['tsx', absScript, ...args], {
  cwd: PROJECT_ROOT,
  env: { ...process.env },
  shell: false,
});
```

## Root cause

Node v24.12.0 enforces the CVE-2024-27980 hardening: `child_process.spawn()` refuses to spawn `.bat` / `.cmd` files when `shell: false`. It throws `EINVAL` immediately at the spawn syscall, before the child ever runs. This is intentional behavior change vs. the older Node series the prior hotfix was tested against.

The April 26 hotfix (`d906198`) explicitly chose `shell: false` to avoid `cmd.exe` arg-joining/path-splitting bugs (relevant when PROJECT_ROOT contained spaces, e.g. the OneDrive path). That tradeoff inverted under Node 24:

- `shell: true` + `npx`: still re-introduces the path-split bug if PROJECT_ROOT ever contains a space.
- `shell: false` + `npx.cmd`: now throws EINVAL (Node 24 hardening).

So both prior options are now broken on Node 24 + Windows.

## Fix

Stop using npx. Spawn the current Node binary (`process.execPath`) directly with the resolved tsx CLI module path:

```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve('tsx/cli');

// ... inside runShellTask ...
const child = spawn(process.execPath, [TSX_CLI, absScript, ...args], {
  cwd: PROJECT_ROOT,
  env: { ...process.env },
  shell: false,
});
```

Why this works:
- `process.execPath` is an absolute path to a `.exe` (Windows) or ELF binary (POSIX). Not `.cmd` / `.bat` — no CVE-2024-27980 trigger.
- `require.resolve('tsx/cli')` gives the absolute path to `node_modules/tsx/dist/cli.mjs`. Cross-platform, robust to tsx version bumps.
- `shell: false` keeps argv passed natively, no quoting hazards, no path-splitting on spaces.
- One code path on all platforms — drops the `process.platform === 'win32'` branch.

## Compared to alternatives

| Option | Verdict |
|---|---|
| `shell: true` + `npx` | Re-introduces space-in-path splitting (the bug d906198 fixed). Reject. |
| `spawn('node_modules/.bin/tsx.cmd', ...)` with `shell: false` | Same .cmd hardening trigger. Same EINVAL. Reject. |
| Hard-coded `path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')` | Works, but brittle to tsx layout changes. Reject. |
| **`process.execPath` + `require.resolve('tsx/cli')`** | Canonical post-CVE-2024-27980 pattern. **Adopt.** |

## Test impact

The existing test (`reports non-zero exit from a missing script`) goes from EINVAL throw to its intended behavior: tsx resolves, fails to find `scripts/definitely-not-a-real-script.ts`, exits non-zero with stderr. Test passes without code change.

No new test required for the fix itself — the existing test exercises the exact failure mode and will go green. A regression test against the EINVAL path would require pinning the host Node version, which is not stable infrastructure.

## How this changes our code/strategy

One file (`src/scheduler.ts`), surgical change inside `runShellTask`. No public API change. No DB change. No env change. pm2 picks up the fix on next `npm run build && pm2 restart claudeclaw-main`. Same-path restart is sufficient (no `pm2 delete && pm2 start`) per memory `feedback_pm2_path_stickiness.md`.
