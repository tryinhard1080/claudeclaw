---
name: projectstatus
description: Check the health and status of a specific project
user_invocable: true
---

# Project Status

Check the health of a specific project or all active projects.

## For a specific project

When the user says "status of [project]" or "how's [project] doing":

1. **Git status**: Check for uncommitted changes, recent commits (last 7 days)
2. **Test health**: Run tests if a test runner is configured (vitest, jest, pytest)
3. **Build status**: Check if the project builds cleanly
4. **Dependencies**: Quick check for outdated packages
5. **Last activity**: When was the most recent commit?

## For all projects

When the user says "project pulse" or "status of everything":

For each project listed in the user profile:
1. Navigate to the project directory
2. Run `git log --oneline -5` for recent activity
3. Flag anything that looks unhealthy (no commits in 7+ days, failing tests)

## Format

- Present as a clean status table
- Use checkmarks for healthy, warnings for issues
- Keep it actionable: only flag things that need attention
