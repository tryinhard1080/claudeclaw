import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import { AGENT_ID, ALLOWED_CHAT_ID, PROJECT_ROOT } from './config.js';
import {
  getDueTasks,
  getNextDueTimeMs,
  getSession,
  logConversationTurn,
  claimTaskExecution,
  updateTaskAfterRun,
  resetStuckTasks,
  claimNextMissionTask,
  completeMissionTask,
  resetStuckMissionTasks,
  type ScheduledTask,
} from './db.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { messageQueue } from './message-queue.js';
import { runAgent } from './agent.js';
import { formatForTelegram, splitMessage } from './bot.js';
import { getRoutine, isSystemRoutine } from './routines.js';
import { emitChatEvent } from './state.js';

/**
 * Shape the scheduler expects back from every task-runner strategy.
 * Mirrors AgentResult so the surrounding result-handling code is unchanged.
 */
export interface TaskRunResult {
  text: string | null;
  aborted?: boolean;
}

/**
 * kind='shell' — spawn `npx tsx <script_path>` and return its stdout.
 * Timeout is enforced by the caller's AbortController on top of the
 * scheduler's TASK_TIMEOUT_MS. Captures stdout + stderr; success requires
 * exit 0. No Claude CLI involvement.
 */
export function runShellTask(task: ScheduledTask, abortController: AbortController): Promise<TaskRunResult> {
  if (!task.script_path) {
    return Promise.resolve({ text: `shell task ${task.id} has null script_path`, aborted: false });
  }
  // script_path can include args (e.g. "scripts/foo.ts --all-tiers").
  const [scriptRel, ...args] = task.script_path.split(/\s+/);
  const absScript = path.join(PROJECT_ROOT, scriptRel!);
  return new Promise(resolve => {
    const child = spawn('npx', ['tsx', absScript, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += String(d); });
    child.stderr.on('data', d => { stderr += String(d); });
    const onAbort = (): void => { child.kill('SIGTERM'); };
    abortController.signal.addEventListener('abort', onAbort);
    child.on('close', (code) => {
      abortController.signal.removeEventListener('abort', onAbort);
      if (abortController.signal.aborted) {
        resolve({ text: null, aborted: true });
        return;
      }
      const combined = stdout + (stderr ? `\n---stderr---\n${stderr}` : '');
      const text = code === 0
        ? combined.trim() || `${scriptRel} completed (exit 0, no output)`
        : `${scriptRel} exit ${code}\n${combined}`;
      resolve({ text: text.slice(0, 3500), aborted: false });
    });
  });
}

/**
 * kind='claude-agent' — existing runAgent path. Preflights auth: if no
 * CLAUDE_CODE_OAUTH_TOKEN and no ANTHROPIC_API_KEY, skip with a warning
 * rather than spawning a subprocess that will hang indefinitely on
 * stdin auth prompts.
 */
export async function runClaudeAgentTask(task: ScheduledTask, abortController: AbortController): Promise<TaskRunResult> {
  const secrets = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
  if (!secrets.CLAUDE_CODE_OAUTH_TOKEN && !secrets.ANTHROPIC_API_KEY) {
    logger.warn({ taskId: task.id }, 'claude-agent task skipped — no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY');
    return {
      text: `Skipped: no Claude auth available (CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY both empty). Configure one in .env and restart.`,
      aborted: false,
    };
  }
  let taskPrompt = task.prompt;
  if (isSystemRoutine(task.id)) {
    const routine = getRoutine(task.id);
    if (routine) taskPrompt = routine.buildPrompt();
  }
  const result = await runAgent(taskPrompt, undefined, () => {}, undefined, undefined, abortController);
  return { text: result.text, aborted: result.aborted };
}

type Sender = (text: string) => Promise<void>;

/** Max time (ms) a scheduled task can run before being killed. */
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let sender: Sender;

/**
 * In-memory set of task IDs currently being executed.
 * Acts as a fast-path guard alongside the DB-level lock in markTaskRunning.
 */
const runningTaskIds = new Set<string>();

/**
 * Initialise the scheduler. Call once after the Telegram bot is ready.
 * @param send  Function that sends a message to the user's Telegram chat.
 */
let schedulerAgentId = 'main';

export function initScheduler(send: Sender, agentId = 'main'): void {
  if (!ALLOWED_CHAT_ID) {
    logger.warn('ALLOWED_CHAT_ID not set — scheduler will not send results');
  }
  sender = send;
  schedulerAgentId = agentId;

  // Recover tasks stuck in 'running' from a previous crash
  const recovered = resetStuckTasks(agentId);
  if (recovered > 0) {
    logger.warn({ recovered, agentId }, 'Reset stuck tasks from previous crash');
  }
  const recoveredMission = resetStuckMissionTasks(agentId);
  if (recoveredMission > 0) {
    logger.warn({ recovered: recoveredMission, agentId }, 'Reset stuck mission tasks from previous crash');
  }

  void scheduleNextTick();
  logger.info({ agentId }, 'Scheduler started (precision timer)');
}

async function scheduleNextTick(): Promise<void> {
  await runDueTasks();
  const nextDueMs = getNextDueTimeMs(schedulerAgentId);
  const delay = nextDueMs
    ? Math.max(1000, Math.min(nextDueMs - Date.now(), 60_000))
    : 60_000;
  setTimeout(() => void scheduleNextTick(), delay);
}

async function runDueTasks(): Promise<void> {
  const tasks = getDueTasks(schedulerAgentId);

  if (tasks.length > 0) {
    logger.info({ count: tasks.length }, 'Running due scheduled tasks');
  }

  for (const task of tasks) {
    // In-memory guard: skip if already running in this process
    if (runningTaskIds.has(task.id)) {
      logger.warn({ taskId: task.id }, 'Task already running, skipping duplicate fire');
      continue;
    }

    // Compute next occurrence BEFORE executing so we can lock the task
    // in the DB immediately, preventing re-fire on subsequent ticks.
    const nextRun = computeNextRun(task.schedule);
    const nonce = randomUUID();
    const claimed = claimTaskExecution(task.id, nonce, nextRun);
    if (!claimed) {
      logger.warn({ taskId: task.id }, 'Task already claimed by another execution, skipping');
      continue;
    }
    runningTaskIds.add(task.id);

    logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 60) }, 'Firing task');

    // Route through the message queue so scheduled tasks wait for any
    // in-flight user message to finish before running. This prevents
    // two Claude processes from hitting the same session simultaneously.
    const chatId = ALLOWED_CHAT_ID || 'scheduler';
    messageQueue.enqueue(chatId, async () => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

      try {
        // v1.11.0 dispatch on kind. Default 'claude-agent' preserves
        // pre-2026-04-20 behavior for unmigrated tasks.
        const kind = task.kind ?? 'claude-agent';
        const promptPreview = (task.kind === 'shell' && task.script_path
          ? `[shell] ${task.script_path}`
          : task.prompt
        ).slice(0, 80);
        await sender(`Scheduled task running: "${promptPreview}${promptPreview.length >= 80 ? '...' : ''}"`);

        const result: TaskRunResult = kind === 'shell'
          ? await runShellTask(task, abortController)
          : await runClaudeAgentTask(task, abortController);
        clearTimeout(timeout);

        if (result.aborted) {
          updateTaskAfterRun(task.id, nextRun, 'Timed out after 10 minutes', 'timeout');
          await sender(`⏱ Task timed out after 10m: "${task.prompt.slice(0, 60)}..." — killed.`);
          logger.warn({ taskId: task.id }, 'Task timed out');
          return;
        }

        const text = result.text?.trim() || 'Task completed with no output.';
        for (const chunk of splitMessage(formatForTelegram(text))) {
          await sender(chunk);
        }

        // Inject task output into the active chat session so user replies have context
        if (ALLOWED_CHAT_ID) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', `[Scheduled task]: ${task.prompt}`, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }

        updateTaskAfterRun(task.id, nextRun, text, 'success');

        logger.info({ taskId: task.id, nextRun }, 'Task complete, next run scheduled');
      } catch (err) {
        clearTimeout(timeout);
        const errMsg = err instanceof Error ? err.message : String(err);
        updateTaskAfterRun(task.id, nextRun, errMsg.slice(0, 500), 'failed');

        logger.error({ err, taskId: task.id }, 'Scheduled task failed');
        try {
          await sender(`❌ Task failed: "${task.prompt.slice(0, 60)}..." — ${errMsg.slice(0, 200)}`);
        } catch {
          // ignore send failure
        }
      } finally {
        runningTaskIds.delete(task.id);
      }
    });
  }

  // Also check for queued mission tasks (one-shot async tasks from Mission Control)
  await runDueMissionTasks();
}

async function runDueMissionTasks(): Promise<void> {
  // Drain all queued mission tasks per tick, not just one
  let claimed = claimNextMissionTask(schedulerAgentId);
  while (claimed) {
    // Capture as const so the async callback closure has a stable reference
    const mission = claimed;
    const missionKey = 'mission-' + mission.id;
    if (runningTaskIds.has(missionKey)) {
      claimed = claimNextMissionTask(schedulerAgentId);
      continue;
    }
    runningTaskIds.add(missionKey);

    logger.info({ missionId: mission.id, title: mission.title }, 'Running mission task');

    const chatId = ALLOWED_CHAT_ID || 'mission';
    messageQueue.enqueue(chatId, async () => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

      try {
        const result = await runAgent(mission.prompt, undefined, () => {}, undefined, undefined, abortController);
        clearTimeout(timeout);

        if (result.aborted) {
          completeMissionTask(mission.id, null, 'failed', 'Timed out after 10 minutes');
          logger.warn({ missionId: mission.id }, 'Mission task timed out');
          try { await sender('Mission task timed out: "' + mission.title + '"'); } catch {}
        } else {
          const text = result.text?.trim() || 'Task completed with no output.';
          completeMissionTask(mission.id, text, 'completed');
          logger.info({ missionId: mission.id }, 'Mission task completed');

          // Send result to Telegram
          for (const chunk of splitMessage(formatForTelegram(text))) {
            await sender(chunk);
          }

          // Inject into conversation context so agent can reference it
          if (ALLOWED_CHAT_ID) {
            const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
            logConversationTurn(ALLOWED_CHAT_ID, 'user', '[Mission task: ' + mission.title + ']: ' + mission.prompt, activeSession ?? undefined, schedulerAgentId);
            logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
          }
        }

        emitChatEvent({
          type: 'mission_update',
          chatId,
          content: JSON.stringify({
            id: mission.id,
            status: result.aborted ? 'failed' : 'completed',
            title: mission.title,
          }),
        });
      } catch (err) {
        clearTimeout(timeout);
        const errMsg = err instanceof Error ? err.message : String(err);
        completeMissionTask(mission.id, null, 'failed', errMsg.slice(0, 500));
        logger.error({ err, missionId: mission.id }, 'Mission task failed');
      } finally {
        runningTaskIds.delete(missionKey);
      }
    });

    // Claim next mission task for the next iteration
    claimed = claimNextMissionTask(schedulerAgentId);
  }
}

export function computeNextRun(cronExpression: string): number {
  const interval = CronExpressionParser.parse(cronExpression);
  return Math.floor(interval.next().getTime() / 1000);
}
