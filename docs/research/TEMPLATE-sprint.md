# Sprint <N> — <topic>

> Fill every section before writing code. If you can't fill a section, you
> don't yet understand the sprint well enough to build it.

## 1. Existing-code audit

What already exists in the repo that touches this concern? Grep paths, file
references, line numbers. If nothing exists, say so explicitly — that itself
is a finding.

## 2. Literature / NotebookLM finding

One focused query. One citation or quote. Don't synthesize three textbooks.
If the answer is "standard technique, no special literature needed," say so.

## 3. Duplicate / complement / conflict verdict

Given sections 1 and 2, does the proposed sprint:

- **Duplicate** existing code? → probably kill the sprint.
- **Complement** existing code? → explain why both are needed.
- **Conflict** with existing code? → flag the bug, fix upstream first.
- **Novel** ? → justify why it wasn't built before.

## 4. Why now

What metric improves, by how much, on what timeline? "Calibration improves"
is not a metric. "Brier score drops by ≥0.02 on resolved trades within 30
days" is.

## 5. Out of scope

Two or three bullets of what this sprint is **not** doing, to prevent scope
creep during coding.

## 6. Risk

One sentence on the blast radius if the sprint ships wrong. Risk-gates
impact? Sizing impact? Execution impact? None (shadow-only)?

## 7. Verification plan

How will you know the sprint worked after ~30 days of live data?

---

Commit this note with the sprint code. Pre-commit hook blocks src/poly or
src/trading commits without it (see scripts/pre-commit-research-check.sh).
