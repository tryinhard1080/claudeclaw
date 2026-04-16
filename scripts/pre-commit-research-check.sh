#!/usr/bin/env bash
# Blocks commits touching src/poly/ or src/trading/ unless a matching
# docs/research/sprint-*.md or docs/plans/sprint-*.md exists in the commit
# or in the last 7 days of history.
#
# Escape tags in the commit message (case-insensitive):
#   [retro]   — acknowledged skip, post-hoc docs owed
#   [hotfix]  — urgent fix, research note to follow
#   [chore]   — non-sprint maintenance
#   [audit]   — audit remediation work, pre-approved
#
# Reason: feedback_baby_steps_research_first memory (2026-04-15) —
# 0/12 sprints had research notes. Memory alone did not hold.
set -e

STAGED=$(git diff --cached --name-only --diff-filter=ACM)
if ! echo "$STAGED" | grep -qE '^src/(poly|trading)/'; then
  exit 0
fi

MSG_FILE="${1:-.git/COMMIT_EDITMSG}"
if [ -f "$MSG_FILE" ]; then
  MSG=$(cat "$MSG_FILE")
  if echo "$MSG" | grep -qiE '\[retro\]|\[hotfix\]|\[chore\]|\[audit\]'; then
    echo "pre-commit-research-check: escape tag present — allowing."
    exit 0
  fi
fi

RESEARCH=$(echo "$STAGED" | grep -E '^docs/(research|plans)/(sprint|TEMPLATE)' || true)
if [ -n "$RESEARCH" ]; then
  echo "pre-commit-research-check: sprint research/plan note staged — allowing."
  exit 0
fi

RECENT=$(git log --since='7 days ago' --name-only --pretty=format: -- 'docs/research/sprint-*.md' 'docs/plans/sprint-*.md' 2>/dev/null | sort -u | grep -v '^$' || true)
if [ -n "$RECENT" ]; then
  echo "pre-commit-research-check: recent research/plan note in last 7 days — allowing."
  exit 0
fi

cat <<EOF
pre-commit-research-check: BLOCKED

You are committing to src/poly/ or src/trading/ without a sprint
research or plan note. Options:

  1. Write docs/research/sprint-<N>-<topic>.md first (see
     docs/research/TEMPLATE-sprint.md) and stage it in this commit.
  2. Add one of [retro] [hotfix] [chore] [audit] to the commit message
     to bypass with an audit trail.

Staged files that triggered this check:
EOF
echo "$STAGED" | grep -E '^src/(poly|trading)/' | sed 's/^/  /'
exit 1
