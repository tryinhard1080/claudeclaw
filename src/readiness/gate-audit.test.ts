import { describe, expect, it } from 'vitest';

import type { GateProgressCheck } from './gate-progress.js';
import { collectGateAudit } from './gate-audit.js';

function gate(partial: Partial<GateProgressCheck> & Pick<GateProgressCheck, 'box'>): GateProgressCheck {
  return {
    box: partial.box,
    name: partial.name ?? `Box ${partial.box}`,
    status: partial.status ?? 'warn',
    state: partial.state ?? 'incomplete',
    detail: partial.detail ?? 'detail',
    current: partial.current,
    target: partial.target,
  };
}

describe('real-money gate audit', () => {
  it('separates review-ready operator actions from sample and time blockers', () => {
    const payload = collectGateAudit([
      gate({ box: 1, state: 'elapsed_review_ready', current: 41, target: 30 }),
      gate({ box: 2, state: 'incomplete', current: 0, target: 50 }),
      gate({ box: 3, state: 'incomplete', current: 8, target: 60 }),
      gate({ box: 4, status: 'pass', state: 'clear' }),
      gate({ box: 5, status: 'pass', state: 'clear' }),
      gate({ box: 6, status: 'pass', state: 'mission_checked' }),
      gate({ box: 7, state: 'pending' }),
    ], 1_800_000_000);

    expect(payload.status).toBe('warn');
    expect(payload.liveMoneyReady).toBe(false);
    expect(payload.completeCount).toBe(3);
    expect(payload.operatorActionCount).toBe(2);
    expect(payload.sampleOrTimeCount).toBe(2);
    expect(payload.systemBlockerCount).toBe(0);
    expect(payload.items.find(item => item.box === 1)?.category).toBe('operator_action');
    expect(payload.items.find(item => item.box === 2)?.category).toBe('sample_or_time');
    expect(payload.items.find(item => item.box === 7)?.action).toContain('final written live-money sign-off');
  });

  it('treats failed safety gates as system blockers', () => {
    const payload = collectGateAudit([
      gate({ box: 4, status: 'fail', state: 'halted', detail: 'halt flag set' }),
      gate({ box: 5, status: 'pass', state: 'clear' }),
    ]);

    expect(payload.status).toBe('fail');
    expect(payload.systemBlockerCount).toBe(1);
    expect(payload.items[0]!.category).toBe('system_blocker');
  });

  it('passes only when every gate is complete', () => {
    const payload = collectGateAudit([
      gate({ box: 1, status: 'pass', state: 'mission_checked' }),
      gate({ box: 2, status: 'pass', state: 'complete' }),
    ]);

    expect(payload.status).toBe('pass');
    expect(payload.liveMoneyReady).toBe(true);
    expect(payload.completeCount).toBe(2);
  });
});
