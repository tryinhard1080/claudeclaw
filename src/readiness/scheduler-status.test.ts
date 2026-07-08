import { describe, expect, it } from 'vitest';
import {
  formatOverdueSummaryLines,
  formatScheduledTaskLines,
  summarizeTradingSchedulerCadence,
  summarizeOverdueTasks,
  type ScheduledTaskStatus,
} from './scheduler-status.js';

const NOW = 1_800_000_000;

function task(overrides: Partial<ScheduledTaskStatus>): ScheduledTaskStatus {
  return {
    id: 'task',
    agent_id: 'main',
    status: 'active',
    next_run: NOW + 60,
    last_run: null,
    schedule: '* * * * *',
    prompt: '',
    ...overrides,
  };
}

describe('scheduler status formatting', () => {
  it('separates main overdue tasks from non-main scheduler noise', () => {
    const tasks = [
      task({ id: 'poly-resolution-fetch-872d', agent_id: 'main', next_run: NOW + 1_800 }),
      task({ id: 'main-stale', agent_id: 'main', next_run: NOW - 121 }),
      task({ id: 'f7aed33a', agent_id: 'comms', next_run: NOW - 10_000 }),
      task({ id: 'inactive-old', agent_id: 'main', status: 'paused', next_run: NOW - 10_000 }),
    ];

    expect(summarizeOverdueTasks(tasks, NOW)).toEqual({
      mainOverdueIds: ['main-stale'],
      nonMainOverdueIds: ['f7aed33a'],
    });
    expect(formatOverdueSummaryLines(tasks, NOW)).toEqual([
      'Main-agent overdue tasks: main-stale',
      'Non-main overdue tasks: f7aed33a (not main readiness blockers)',
    ]);
  });

  it('prints full scheduler IDs, ISO run times, and last status', () => {
    const lines = formatScheduledTaskLines(
      task({
        id: 'poly-resolution-watch-a7be',
        agent_id: 'main',
        next_run: NOW + 300,
        last_run: NOW - 120,
        last_status: 'success',
        last_result: 'resolution watch ok',
        prompt: '[shell] Every 2h Polymarket paper resolution watch',
      }),
      NOW,
    );

    expect(lines[0]).toContain('id=poly-resolution-watch-a7be');
    expect(lines[0]).toContain('lastStatus=success');
    expect(lines[0]).toContain('overdue=no');
    expect(lines[0]).toContain('nextRun=2027-01-15T08:05:00.000Z');
    expect(lines[0]).toContain('lastRun=2m ago (2027-01-15T07:58:00.000Z)');
    expect(lines[1]).toBe('    lastResult="resolution watch ok"');
  });

  it('can suppress stale last-result previews for summary views', () => {
    const lines = formatScheduledTaskLines(
      task({
        id: '3d623e0e',
        agent_id: 'main',
        last_run: NOW - 120,
        last_status: 'success',
        last_result: 'historical parser error that is no longer current',
        prompt: 'Execute the 2-hour trading-news sync',
      }),
      NOW,
      { includeLastResult: false },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('id=3d623e0e');
    expect(lines[0]).toContain('lastStatus=success');
    expect(lines[0]).not.toContain('historical parser error');
  });

  it('summarizes the trading-readiness scheduler cadence', () => {
    const summary = summarizeTradingSchedulerCadence([
      task({
        id: 'poly-resolution-fetch-872d',
        next_run: NOW + 300,
        last_run: NOW - 300,
        last_status: 'success',
        prompt: '[shell] Every 2h prioritized Polymarket resolution-cache refresh before the resolution watch',
      }),
      task({
        id: 'poly-resolution-watch-a7be',
        next_run: NOW + 600,
        last_run: NOW - 600,
        last_status: 'success',
        prompt: '[shell] Every 2h Polymarket paper resolution watch',
      }),
      task({
        id: '3d623e0e',
        next_run: NOW + 600,
        last_run: NOW - 600,
        last_status: 'success',
        prompt: "Execute the 2-hour trading-news sync",
      }),
      task({
        id: 'readiness-evidence-5056',
        next_run: NOW + 3600,
        last_run: NOW - 86400,
        last_status: 'success',
        prompt: '[shell] Daily 17:15 CT readiness evidence snapshot',
      }),
      task({
        id: 'overnight-agent-e85f',
        next_run: NOW + 7200,
        last_run: null,
        prompt: '[shell] Daily 02:15 local overnight trading-agent report',
      }),
      task({
        id: 'regime-sharpe-9a08',
        next_run: NOW + 10800,
        last_run: NOW - 86400,
        last_status: 'success',
        prompt: '[shell] Daily 17:00 CT regime-trader Sharpe snapshot',
      }),
    ], NOW);

    expect(summary.status).toBe('pass');
    expect(summary.mainOverdueIds).toEqual([]);
    expect(summary.tasks.map(row => row.key)).toEqual([
      'resolution_fetch',
      'resolution_watch',
      'news_sync',
      'readiness_evidence',
      'overnight_agent',
      'regime_sharpe',
    ]);
    expect(summary.tasks[0]).toMatchObject({
      label: 'Resolution cache refresh',
      id: 'poly-resolution-fetch-872d',
      status: 'pass',
      nextRun: NOW + 300,
      lastRun: NOW - 300,
      lastStatus: 'success',
      overdueMinutes: null,
    });
    expect(summary.tasks[1]).toMatchObject({
      label: 'Resolution watch',
      id: 'poly-resolution-watch-a7be',
      nextRun: NOW + 600,
    });
  });

  it('warns when a trading cadence task is missing or overdue', () => {
    const summary = summarizeTradingSchedulerCadence([
      task({
        id: 'poly-resolution-fetch-872d',
        next_run: NOW - 180,
        prompt: '[shell] Every 2h prioritized Polymarket resolution-cache refresh',
      }),
    ], NOW);

    expect(summary.status).toBe('warn');
    expect(summary.mainOverdueIds).toEqual(['poly-resolution-fetch-872d']);
    expect(summary.tasks.find(row => row.key === 'resolution_fetch')).toMatchObject({
      status: 'warn',
      overdueMinutes: 3,
    });
    expect(summary.tasks.find(row => row.key === 'resolution_watch')).toMatchObject({
      status: 'warn',
      id: null,
    });
  });
});
