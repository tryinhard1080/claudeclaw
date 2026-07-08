# Overnight Trading Agent Plan

Date: 2026-06-29

## Directive

Translate the attached "AI agents that work while you sleep" transcript into a
ClaudeClaw trading-only operating surface.

The transcript is about agent harnesses, long-running work, permissions,
traces, evals, and output artifacts. It is not a market strategy transcript.
The implementation therefore creates an overnight evaluator for the existing
paper-trading system. It does not add a strategy, asset class, live-money path,
or risk-gate bypass.

## Transcript Translation

| Transcript pattern | ClaudeClaw implementation |
| --- | --- |
| Long-running agent | Daily scheduler task at 02:15 local time |
| Harness | Existing `kind=shell` scheduler runner |
| Tool permissions | Read-only SQLite access plus artifact writes under `STORE_DIR` |
| Traces | Report trace steps for evidence collection, paper pipeline, filters, equities, and live-money gate posture |
| Built-in eval loop | Self-eval checks for trading scope, live-money gate preservation, settled-vs-MTM separation, and next-action output |
| Predictable artifacts | Markdown and JSON reports under `STORE_DIR/reports/overnight-trading-agent` |
| Human in the loop | Telegram scheduler output plus MISSION gate remains operator-bound |

## Safety Envelope

Allowed:

- Read `claudeclaw.db`.
- Collect existing operational evidence.
- Write Markdown and JSON artifacts under `STORE_DIR`.
- Send a concise scheduler summary to Richard.
- Recommend next actions inside paper-trading and readiness gates.

Not allowed:

- Place trades.
- Change paper capital, max trade dollars, daily loss, drawdown, or deployed-cap settings.
- Lift a halt.
- Touch `risk-gates.ts`, `paper-broker.ts`, or `pnl-tracker.ts`.
- Mark Box 2, Box 3, or Box 7 complete without objective evidence.
- Enable real-money trading.

## Implementation

- `src/readiness/overnight-agent.ts` builds and formats the report.
- `src/readiness/overnight-agent.test.ts` covers gate preservation and report formatting.
- `scripts/overnight-trading-agent.ts` performs a one-shot read-only run and writes artifacts.
- `scripts/register-overnight-trading-agent-cron.ts` registers the daily shell task.
- `npm run overnight:agent` runs the report immediately.
- `npm run overnight:agent:register` registers the recurring overnight task.

## Acceptance

Run:

```bash
npx vitest run src/readiness/overnight-agent.test.ts
npm run typecheck
npm run agent:surface:check
npm run overnight:agent
npm run overnight:agent:register
npx tsx scripts/check-scheduler-state.ts
```

The expected state is a WARN report while paper trading continues. WARN is
correct while live-money boxes remain incomplete.
