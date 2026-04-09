/**
 * Proactive daily routines.
 *
 * Pre-built autonomous tasks that run on schedule without user prompting.
 * Each routine builds a prompt that references the user profile and
 * formats output for Telegram delivery.
 */

import { loadProfile } from './profile.js';

// ── Types ────────────────────────────────────────────────────────────

export interface RoutineDefinition {
  /** Unique stable ID for this routine (used as scheduled_tasks.id). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Cron schedule expression. */
  readonly schedule: string;
  /** Description shown in task list. */
  readonly description: string;
  /** Build the full prompt for the agent. */
  buildPrompt(): string;
}

// ── Prompt wrapper ───────────────────────────────────────────────────

function wrapRoutinePrompt(routineInstructions: string): string {
  const profile = loadProfile();
  const parts: string[] = [
    'You are running an autonomous routine. No human is waiting for a response -- you are pushing a proactive update to Telegram.',
  ];
  if (profile) parts.push(profile);
  parts.push(routineInstructions);
  parts.push(
    'Format output for Telegram. Be concise and scannable. Use plain text over heavy markdown.',
    'If nothing noteworthy, send: "All quiet. Nothing needs your attention."',
  );
  return parts.join('\n\n');
}

// ── Routine definitions ──────────────────────────────────────────────

const morningBriefing: RoutineDefinition = {
  id: 'routine-morning-briefing',
  name: 'Morning Briefing',
  schedule: '0 8 * * 1-5',
  description: 'Weekday 8am: calendar, email, tasks overview',
  buildPrompt() {
    return wrapRoutinePrompt(`MORNING BRIEFING ROUTINE

Gather and present a concise morning briefing:

1. TODAY'S CALENDAR: Check Google Calendar for today's events. List meetings with times.
2. EMAIL INBOX: Check Gmail for unread/important emails from the last 12 hours. List top 5 by urgency.
3. ACTIVE TASKS: Check Obsidian vault inbox and any open tasks. List items that need attention today.
4. PROJECT STATUS: For each active project in the user profile, provide a one-line status (last commit, any failing tests if easily checkable).

Present as a clean daily briefing. Prioritize what needs action TODAY.`);
  },
};

const eveningWrap: RoutineDefinition = {
  id: 'routine-evening-wrap',
  name: 'Evening Wrap',
  schedule: '0 18 * * 1-5',
  description: 'Weekday 6pm: daily recap and tomorrow preview',
  buildPrompt() {
    return wrapRoutinePrompt(`EVENING WRAP ROUTINE

Summarize the day and prep for tomorrow:

1. TODAY'S ACTIVITY: Check conversation history for what was discussed/accomplished today. Summarize in 3-5 bullets.
2. TOMORROW'S CALENDAR: Check Google Calendar for tomorrow's events.
3. OPEN THREADS: Any unfinished tasks or conversations that need follow-up?
4. MEMORY HEALTH: How many new memories were created today? Any worth highlighting?

Keep it brief. End with "Have a good evening." if nothing urgent.`);
  },
};

const weeklyReview: RoutineDefinition = {
  id: 'routine-weekly-review',
  name: 'Weekly Review',
  schedule: '0 9 * * 1',
  description: 'Monday 9am: week accomplishments and planning',
  buildPrompt() {
    return wrapRoutinePrompt(`WEEKLY REVIEW ROUTINE

Generate a Monday morning weekly review:

1. LAST WEEK'S ACCOMPLISHMENTS: Check git logs across active projects for commits from the past 7 days. Summarize what shipped.
2. THIS WEEK'S CALENDAR: List all meetings and events for Mon-Fri.
3. PRIORITIES: Based on the user's goals and project status, suggest top 3 priorities for this week.
4. STALE ITEMS: Any scheduled tasks that have been failing? Any projects with no commits in 7+ days?
5. MEMORY INSIGHTS: Surface the most recent memory consolidation insights.

Present as a structured weekly kickoff.`);
  },
};

const inboxSweep: RoutineDefinition = {
  id: 'routine-inbox-sweep',
  name: 'Inbox Sweep',
  schedule: '0 */4 * * *',
  description: 'Every 4h: check for urgent emails',
  buildPrompt() {
    return wrapRoutinePrompt(`INBOX SWEEP ROUTINE

Quick check for anything urgent:

1. Check Gmail for unread messages from the last 4 hours.
2. Filter for anything that looks urgent, time-sensitive, or from key contacts.
3. If there are urgent items, summarize them with a clear call to action.
4. If nothing urgent, respond with "All quiet. Nothing needs your attention."

Do NOT list routine newsletters, automated notifications, or low-priority items. Only surface things that genuinely need attention NOW.`);
  },
};

const projectPulse: RoutineDefinition = {
  id: 'routine-project-pulse',
  name: 'Project Pulse',
  schedule: '0 10 * * 3',
  description: 'Wednesday 10am: project health check',
  buildPrompt() {
    return wrapRoutinePrompt(`PROJECT PULSE ROUTINE

Mid-week project health check:

For each active project listed in the user profile:
1. Git status: any uncommitted changes? How many commits this week?
2. Test health: run tests if test runner is configured. Report pass/fail.
3. Dependencies: any outdated or vulnerable packages? (quick check only)
4. Last activity: when was the most recent commit?

Flag anything that looks unhealthy. Skip projects that are dormant/low-priority.
Present as a clean status table.`);
  },
};

// ── Exports ──────────────────────────────────────────────────────────

/** All available routine definitions. */
export const ROUTINES: readonly RoutineDefinition[] = Object.freeze([
  morningBriefing,
  eveningWrap,
  weeklyReview,
  inboxSweep,
  projectPulse,
]);

/** Look up a routine by ID. */
export function getRoutine(id: string): RoutineDefinition | undefined {
  return ROUTINES.find((r) => r.id === id);
}

/** Check if a task ID belongs to a system routine. */
export function isSystemRoutine(taskId: string): boolean {
  return taskId.startsWith('routine-');
}
