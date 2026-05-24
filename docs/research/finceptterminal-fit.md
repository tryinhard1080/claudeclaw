# FinceptTerminal Fit Assessment

Date: 2026-05-22

## Verdict

FinceptTerminal is useful as architecture reference only. Do not import code, copy UI, fork it into ClaudeClaw, or make it a dependency.

Confidence: high.

## Sources

- FinceptTerminal GitHub README: <https://github.com/Fincept-Corporation/FinceptTerminal>
- FinceptTerminal license: <https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/main/LICENSE>
- FinceptTerminal architecture doc: <https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/main/docs/ARCHITECTURE.md>
- FinceptTerminal Alpha Arena doc: <https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/main/docs/ALPHA_ARENA.md>

## What It Is

The current README describes Fincept Terminal v4 as a native C++20 and Qt6 financial terminal with embedded Python analytics, AI agents, more than 100 data connectors, and broker integrations. The architecture doc frames it as a modular monolith with bounded contexts, an in-process data plane, adapters, MCP tooling, Python subprocess integration, broker abstractions, and SQLite-backed persistence.

This is far larger than ClaudeClaw's active mission. ClaudeClaw is a narrow Node/TypeScript trading agent with Polymarket paper trading and a file-IPC bridge to a separate equity regime trader.

## License Constraint

The license is a hard boundary. It describes AGPL-3.0 availability for non-commercial personal, learning, academic, or contribution use, but states that business, internal company, fund, SaaS, hosted, white-label, resale, or fork-and-replace use requires a paid commercial license.

Because ClaudeClaw is an operational trading agent, no code, trade dress, UI structure, schema, or implementation detail should be copied from FinceptTerminal without explicit license clearance. Treat it as reading material, not source material.

## Beneficial Patterns

1. Typed data-plane topics.

   FinceptTerminal's DataHub idea is relevant. ClaudeClaw already has event emitters and scan-driven flows; the useful pattern is a typed event contract for trading facts such as `poly.scan.complete`, `poly.signal.rejected`, `poly.position.resolved`, `regime.state.updated`, and `gate.warn`.

2. Replay-faithful evaluation.

   Alpha Arena's strongest pattern is deterministic replay: prompts, model decisions, risk verdicts, orders, fills, P&L snapshots, and events are all persisted so an agent's history can be reconstructed. ClaudeClaw has the pieces, but the evaluation surface could be made more explicit for Polymarket signals and strategy comparisons.

3. Paper/live venue contract.

   Alpha Arena separates venue interface, paper venue, live venue, risk engine, and audit. ClaudeClaw already has paper-broker separation. The useful action is to keep strengthening tests that prove paper execution is the only path before real-money approval.

4. MCP tool registry discipline.

   FinceptTerminal's MCP layer is relevant as a reminder that tool surfaces should be registered, named, permissioned, and tied to bounded contexts. For ClaudeClaw that means finance research tools only, not broad personal-assistant connectors.

## Non-Fit Areas

- Desktop UI, Qt screens, dock managers, charting, and trade dress are not useful here.
- Multi-broker expansion conflicts with `MISSION.md` anti-goals.
- Crypto, derivatives, options, and additional venues are explicitly out of scope.
- Large-scale terminal architecture would slow the current gate work.
- Code import is blocked by license risk.

## Adoption Rule

Borrow concepts only when they move a named `MISSION.md` gate box. The first safe candidates are:

1. A typed trading-event manifest for existing events.
2. A replay report for Polymarket signal-to-risk-to-paper-trade history.
3. Stronger paper/live boundary tests before any real-money implementation.

No FinceptTerminal code should enter this repo.

## How this changes our code/strategy

FinceptTerminal does not change the immediate trading strategy. It changes the architecture backlog: ClaudeClaw should prefer replayability, typed trading events, and explicit paper/live boundaries over adding new markets or UI. Any future sprint inspired by FinceptTerminal must be implemented from scratch, cite this note, and name the gate box it moves.

