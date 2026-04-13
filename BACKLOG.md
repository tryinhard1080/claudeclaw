# BACKLOG — Parked Ideas

Richard's side-requests land here; bot prioritizes them against the EVOLUTION.md roadmap. Each item: **pitch** (why it matters), **effort**, **blocker** (if any), **verdict** (Accepted / Deferred / Declined / Researched).

## Active

### AgentMail email integration
- **Category:** Infrastructure (communication channel)
- **Trigger:** Richard 2026-04-13.
- **Pitch:** Rich HTML reports, brokerage-confirmation parsing, newsletter ingestion, fallback alert channel.
- **Effort:** Sprint Email-A (~3 hrs outbound) + Sprint Email-B (~4 hrs inbound).
- **Blocker:** Richard must provide `AGENTMAIL_API_KEY` + destination email.
- **Research:** Done — see `docs/research/agent-mail-integration.md`.
- **Verdict:** Accepted. Build after EVOLUTION.md Sprints 2-3 (versioning + regime). Reason: versioning unlocks A/B testing the email-vs-Telegram reporting efficacy; regime tagging enriches what goes in the reports. Email before either would ship partial signal.

### Task-master tooling evaluation
- **Category:** Workflow (plan management)
- **Trigger:** Richard 2026-04-13.
- **Pitch:** Alternative to current writing-plans + executing-plans superpowers skills; potentially better task decomposition + dependency tracking.
- **Effort:** ~30 min research + 1 hr POC if worth adopting.
- **Blocker:** None.
- **Research:** Not yet started.
- **Verdict:** Deferred to post-Sprint-2. Rationale: current superpowers workflow is working — 1 sprint shipped, 1 mid-flight, zero rework. Don't replace a functioning tool until there's friction. Will revisit after Sprint 4 if I feel plan-tracking friction.

## Deferred Pending Data

### Sprint 2.5 — Reflection pass on signals
- Literature-backed (Reflexion / Anthropic evaluator-optimizer) second-LLM critic. Directly addresses Orbán-type misreads.
- Depends on Sprint 2 versioning infrastructure to measure impact via A/B.
- Build after Sprint 2 ships.

### Sprint 1.5 — Drift dashboards beyond Brier
- Scan latency, rejection mix drift, market-count drift. Early-warning signals.
- Small ticket. Build when calibration is producing its first data (needs resolved trades first).

### `docs/learned/` distillation ledger
- One-line entry per lesson; periodically condense into SYSTEM_PROMPT updates.
- Starts accumulating the first time a resolved trade diverges from the model. Not yet.

## Declined / Out of Scope

*(Nothing yet — when I decline something, the rationale goes here so Richard sees the decision.)*
