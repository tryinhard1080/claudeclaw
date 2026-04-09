---
name: dailybriefing
description: Generate a morning briefing with calendar, email, tasks, and project status
user_invocable: true
---

# Daily Briefing

Generate a concise daily briefing covering:

1. **Calendar**: Check Google Calendar for today's events. List meetings with times.
2. **Email**: Check Gmail for unread/important emails from the last 12 hours. Summarize top 5 by urgency.
3. **Tasks**: Check Obsidian vault inbox for open tasks needing attention today.
4. **Projects**: For each active project, provide a one-line status.

## Format

Present as a clean, scannable briefing for Telegram:
- Use plain text, not heavy markdown
- Lead with what needs action TODAY
- Group by urgency: urgent first, then informational
- Keep total output under 1000 characters

## When to Use

- User says "brief me", "morning briefing", "what's on my plate", "daily update"
- Automatically via the morning briefing scheduled routine (8am weekdays)
