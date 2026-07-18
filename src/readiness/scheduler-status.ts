export interface ScheduledTaskStatus {
  id: string;
  agent_id: string | null;
  status: string | null;
  next_run: number | null;
  last_run: number | null;
  last_status?: string | null;
  last_result?: string | null;
  last_result_text?: string | null;
  schedule?: string | null;
  prompt?: string | null;
}

export function formatTimestamp(value: number | null): string {
  return value ? new Date(value * 1000).toISOString() : 'never';
}

export function isTaskOverdue(task: ScheduledTaskStatus, nowSec: number): boolean {
  return task.status === 'active' && task.next_run !== null && Math.floor((nowSec - task.next_run) / 60) > 0;
}

export function summarizeOverdueTasks(tasks: ScheduledTaskStatus[], nowSec: number): {
  mainOverdueIds: string[];
  nonMainOverdueIds: string[];
} {
  const overdue = tasks.filter(task => isTaskOverdue(task, nowSec));
  return {
    mainOverdueIds: overdue.filter(task => task.agent_id === 'main').map(task => task.id),
    nonMainOverdueIds: overdue.filter(task => task.agent_id !== 'main').map(task => task.id),
  };
}

export function formatOverdueSummaryLines(tasks: ScheduledTaskStatus[], nowSec: number): string[] {
  const { mainOverdueIds, nonMainOverdueIds } = summarizeOverdueTasks(tasks, nowSec);
  return [
    `Main-agent overdue tasks: ${mainOverdueIds.length > 0 ? mainOverdueIds.join(', ') : 'none'}`,
    `Non-main overdue tasks: ${nonMainOverdueIds.length > 0 ? `${nonMainOverdueIds.join(', ')} (not main readiness blockers)` : 'none'}`,
  ];
}

export interface FormatScheduledTaskOptions {
  includeLastResult?: boolean;
}

export type SchedulerCadenceKey =
  | 'resolution_fetch'
  | 'resolution_watch'
  | 'readiness_evidence'
  | 'overnight_agent'
  | 'regime_sharpe';

export interface SchedulerCadenceTaskSummary {
  key: SchedulerCadenceKey;
  label: string;
  id: string | null;
  status: 'pass' | 'warn';
  nextRun: number | null;
  lastRun: number | null;
  lastStatus: string | null;
  schedule: string | null;
  overdueMinutes: number | null;
}

export interface TradingSchedulerCadenceSummary {
  status: 'pass' | 'warn';
  mainOverdueIds: string[];
  nonMainOverdueIds: string[];
  tasks: SchedulerCadenceTaskSummary[];
}

export function taskOverdueMinutes(task: ScheduledTaskStatus, nowSec: number): number | null {
  if (task.status !== 'active' || task.next_run === null) return null;
  const minutes = Math.floor((nowSec - task.next_run) / 60);
  return minutes > 0 ? minutes : null;
}

function textForTask(task: ScheduledTaskStatus): string {
  return `${task.id} ${task.prompt ?? ''}`.toLowerCase();
}

function findCadenceTask(
  tasks: ScheduledTaskStatus[],
  patterns: string[],
): ScheduledTaskStatus | null {
  const idMatch = tasks.find(task => {
    const id = task.id.toLowerCase();
    return patterns.some(pattern => id.includes(pattern));
  });
  if (idMatch) return idMatch;

  return tasks.find(task => {
    const haystack = textForTask(task);
    return patterns.some(pattern => haystack.includes(pattern));
  }) ?? null;
}

function cadenceTask(
  tasks: ScheduledTaskStatus[],
  nowSec: number,
  key: SchedulerCadenceKey,
  label: string,
  patterns: string[],
): SchedulerCadenceTaskSummary {
  const task = findCadenceTask(tasks, patterns);
  if (!task) {
    return {
      key,
      label,
      id: null,
      status: 'warn',
      nextRun: null,
      lastRun: null,
      lastStatus: null,
      schedule: null,
      overdueMinutes: null,
    };
  }

  const overdueMinutes = taskOverdueMinutes(task, nowSec);
  return {
    key,
    label,
    id: task.id,
    status: overdueMinutes === null ? 'pass' : 'warn',
    nextRun: task.next_run,
    lastRun: task.last_run,
    lastStatus: task.last_status ?? null,
    schedule: task.schedule ?? null,
    overdueMinutes,
  };
}

export function summarizeTradingSchedulerCadence(
  tasks: ScheduledTaskStatus[],
  nowSec: number,
): TradingSchedulerCadenceSummary {
  const { mainOverdueIds, nonMainOverdueIds } = summarizeOverdueTasks(tasks, nowSec);
  const mainActiveTasks = tasks.filter(task => task.agent_id === 'main' && task.status === 'active');
  const cadenceTasks = [
    cadenceTask(mainActiveTasks, nowSec, 'resolution_fetch', 'Resolution cache refresh', [
      'poly-resolution-fetch',
      'resolution-cache refresh',
    ]),
    cadenceTask(mainActiveTasks, nowSec, 'resolution_watch', 'Resolution watch', [
      'poly-resolution-watch',
      'resolution watch',
    ]),
    cadenceTask(mainActiveTasks, nowSec, 'readiness_evidence', 'Readiness evidence snapshot', [
      'readiness-evidence',
      'readiness evidence snapshot',
    ]),
    cadenceTask(mainActiveTasks, nowSec, 'overnight_agent', 'Overnight trading report', [
      'overnight-agent',
      'overnight trading-agent report',
    ]),
    cadenceTask(mainActiveTasks, nowSec, 'regime_sharpe', 'Regime Sharpe snapshot', [
      'regime-sharpe',
      'regime-trader sharpe snapshot',
    ]),
  ];

  return {
    status: mainOverdueIds.length === 0 && cadenceTasks.every(task => task.status === 'pass') ? 'pass' : 'warn',
    mainOverdueIds,
    nonMainOverdueIds,
    tasks: cadenceTasks,
  };
}

export function formatScheduledTaskLines(
  task: ScheduledTaskStatus,
  nowSec: number,
  options: FormatScheduledTaskOptions = {},
): string[] {
  const includeLastResult = options.includeLastResult ?? true;
  const overdueMinutes = taskOverdueMinutes(task, nowSec);
  const lastAge = task.last_run ? Math.floor((nowSec - task.last_run) / 60) : null;
  const prompt = task.prompt ?? '';
  const lastResult = (task.last_result_text ?? task.last_result) ?? '';
  const lines = [
    `  id=${task.id} agent=${task.agent_id} status=${task.status} lastStatus=${task.last_status ?? '-'} overdue=${
      overdueMinutes !== null ? `${overdueMinutes}m` : 'no'
    } nextRun=${formatTimestamp(task.next_run)} lastRun=${
      lastAge !== null ? `${lastAge}m ago (${formatTimestamp(task.last_run)})` : 'never'
    } schedule=${task.schedule} prompt="${prompt.slice(0, 80)}"`,
  ];
  if (includeLastResult && lastResult.length > 0) {
    lines.push(`    lastResult="${lastResult.slice(0, 160)}"`);
  }
  return lines;
}
