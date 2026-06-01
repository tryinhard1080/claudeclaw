import type { GateProgressCheck, ReadinessStatus } from './gate-progress.js';

export type GateAuditCategory =
  | 'complete'
  | 'operator_action'
  | 'sample_or_time'
  | 'system_blocker';

export interface GateAuditItem extends GateProgressCheck {
  category: GateAuditCategory;
  action: string;
}

export interface GateAuditPayload {
  generatedAt: number;
  status: ReadinessStatus;
  liveMoneyReady: boolean;
  completeCount: number;
  totalCount: number;
  operatorActionCount: number;
  sampleOrTimeCount: number;
  systemBlockerCount: number;
  items: GateAuditItem[];
}

function classifyGate(check: GateProgressCheck): Pick<GateAuditItem, 'category' | 'action'> {
  if (check.status === 'pass') {
    return {
      category: 'complete',
      action: 'No action needed.',
    };
  }

  if (check.status === 'fail') {
    return {
      category: 'system_blocker',
      action: 'Fix the failing safety condition before any live-money review.',
    };
  }

  if (check.box === 1) {
    if (check.state === 'elapsed_review_ready') {
      return {
        category: 'operator_action',
        action: 'Review the elapsed paper-clock evidence and update the MISSION checkbox only if accepted.',
      };
    }
    if (check.state === 'clock_running') {
      return {
        category: 'sample_or_time',
        action: 'Keep paper trading running until the 30-day clock reaches target.',
      };
    }
    return {
      category: 'operator_action',
      action: 'Resolve the MISSION paper-clock evidence so the start date and A1 reading are explicit.',
    };
  }

  if (check.box === 2) {
    if (check.state === 'table_missing') {
      return {
        category: 'system_blocker',
        action: 'Restore the Polymarket paper-trade table or migration state before evaluating live readiness.',
      };
    }
    return {
      category: 'sample_or_time',
      action: 'Keep paper trading inside existing gates until 50 settled trades and positive realized P&L are proven.',
    };
  }

  if (check.box === 3) {
    if (check.state === 'incomplete') {
      return {
        category: 'sample_or_time',
        action: 'Keep regime-trader paper evidence running until the 60-day positive-Sharpe sample is complete.',
      };
    }
    return {
      category: 'system_blocker',
      action: 'Restore regime Sharpe evidence before evaluating live readiness.',
    };
  }

  if (check.box === 6) {
    return {
      category: 'operator_action',
      action: 'Run or document the kill-switch and rollback drill before live-money review.',
    };
  }

  if (check.box === 7) {
    return {
      category: 'operator_action',
      action: 'Richard must add final written live-money sign-off in MISSION.md after Boxes 1-6 pass.',
    };
  }

  return {
    category: 'operator_action',
    action: 'Review and close the remaining MISSION evidence item.',
  };
}

function worstStatus(items: readonly GateAuditItem[]): ReadinessStatus {
  if (items.some(item => item.category === 'system_blocker')) return 'fail';
  if (items.some(item => item.category !== 'complete')) return 'warn';
  return 'pass';
}

export function collectGateAudit(
  checks: readonly GateProgressCheck[],
  generatedAt = Math.floor(Date.now() / 1000),
): GateAuditPayload {
  const items = checks.map(check => ({
    ...check,
    ...classifyGate(check),
  }));
  const completeCount = items.filter(item => item.category === 'complete').length;
  const operatorActionCount = items.filter(item => item.category === 'operator_action').length;
  const sampleOrTimeCount = items.filter(item => item.category === 'sample_or_time').length;
  const systemBlockerCount = items.filter(item => item.category === 'system_blocker').length;
  const status = worstStatus(items);

  return {
    generatedAt,
    status,
    liveMoneyReady: status === 'pass',
    completeCount,
    totalCount: items.length,
    operatorActionCount,
    sampleOrTimeCount,
    systemBlockerCount,
    items,
  };
}
