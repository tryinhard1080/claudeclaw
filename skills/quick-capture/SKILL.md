---
name: quickcapture
description: Fast capture a note or task to Obsidian inbox
user_invocable: true
---

# Quick Capture

Fast-capture a thought, task, or note to the Obsidian vault inbox without the overhead of full memory extraction.

## When to Use

- User says "remember that...", "note:", "capture:", "add to inbox"
- User wants to save something quickly without it going through the memory extraction pipeline
- User wants to create a task or reminder

## How It Works

1. Parse the user's message for the content to capture
2. Determine the type: note, task, or idea
3. Write to the Obsidian vault inbox as a markdown file
4. Confirm with a brief acknowledgment

## Capture Format

For notes:
```markdown
---
created: YYYY-MM-DD
source: claudeclaw
type: note
---

[Content here]
```

For tasks:
```markdown
- [ ] [Task description] (captured YYYY-MM-DD via ClaudeClaw)
```

## Rules

- Keep the capture fast -- no lengthy processing
- Don't over-format the content
- Preserve the user's exact wording when possible
- Confirm with just "Captured." or "Added to inbox."
