import type Database from 'better-sqlite3';

import {
  EMERGENCY_KILL_PHRASE,
  EQUITY_LIVE_EXECUTION_ENABLED,
  POLYMARKET_US_LIVE_EXECUTION_ENABLED,
} from '../config.js';
import { collectGateProgress, type ReadinessStatus } from './gate-progress.js';
import { buildSignalSourceContext } from './source-freshness.js';

export interface LiveStartupFlags {
  equityLiveEnabled: boolean;
  polymarketUsLiveEnabled: boolean;
  emergencyKillPhraseSet: boolean;
}

export interface LiveStartupCheck {
  name: string;
  status: ReadinessStatus;
  state: string;
  detail: string;
}

export interface LiveStartupPayload {
  generatedAt: number;
  status: ReadinessStatus;
  checks: LiveStartupCheck[];
}

export function defaultLiveStartupFlags(): LiveStartupFlags {
  return {
    equityLiveEnabled: EQUITY_LIVE_EXECUTION_ENABLED,
    polymarketUsLiveEnabled: POLYMARKET_US_LIVE_EXECUTION_ENABLED,
    emergencyKillPhraseSet: EMERGENCY_KILL_PHRASE.length > 0,
  };
}

function rank(status: ReadinessStatus): number {
  return status === 'fail' ? 2 : status === 'warn' ? 1 : 0;
}

function worstStatus(checks: readonly LiveStartupCheck[]): ReadinessStatus {
  return checks.reduce<ReadinessStatus>((worst, check) => (
    rank(check.status) > rank(worst) ? check.status : worst
  ), 'pass');
}

export function collectLiveStartupChecks(
  db: Database.Database,
  nowSec: number,
  flags: LiveStartupFlags = defaultLiveStartupFlags(),
): LiveStartupPayload {
  const gateChecks = collectGateProgress(db);
  const gateBlockers = gateChecks.filter(check => check.status !== 'pass');
  const sourceContext = buildSignalSourceContext(db, nowSec);
  const sourceBlockers = sourceContext.sources.filter(source => source.status !== 'pass');

  const checks: LiveStartupCheck[] = [
    {
      name: 'Equity live flag',
      status: flags.equityLiveEnabled ? 'fail' : 'pass',
      state: flags.equityLiveEnabled ? 'enabled_blocked' : 'disabled',
      detail: flags.equityLiveEnabled
        ? 'EQUITY_LIVE_EXECUTION_ENABLED is true; written live gate sign-off is not machine-verified'
        : 'equity bridge remains paper or read-only',
    },
    {
      name: 'Polymarket US live flag',
      status: flags.polymarketUsLiveEnabled ? 'fail' : 'pass',
      state: flags.polymarketUsLiveEnabled ? 'enabled_blocked' : 'disabled',
      detail: flags.polymarketUsLiveEnabled
        ? 'POLYMARKET_US_LIVE_EXECUTION_ENABLED is true; live execution remains blocked'
        : 'Polymarket US client remains read-only',
    },
    {
      name: 'Emergency kill phrase',
      status: flags.emergencyKillPhraseSet ? 'pass' : 'fail',
      state: flags.emergencyKillPhraseSet ? 'configured' : 'missing',
      detail: flags.emergencyKillPhraseSet
        ? 'kill phrase is configured'
        : 'EMERGENCY_KILL_PHRASE must be set before live trading',
    },
    {
      name: 'Real-money gate boxes',
      status: gateBlockers.length === 0 ? 'pass' : 'fail',
      state: gateBlockers.length === 0 ? 'complete' : 'blocked',
      detail: gateBlockers.length === 0
        ? 'all seven gate boxes pass'
        : `${gateBlockers.length} blockers: ${gateBlockers.map(check => `Box ${check.box}`).join(', ')}`,
    },
    {
      name: 'Signal data sources',
      status: sourceBlockers.length === 0 ? 'pass' : 'fail',
      state: sourceBlockers.length === 0 ? 'fresh' : 'blocked',
      detail: sourceBlockers.length === 0
        ? 'all required signal sources are fresh'
        : `${sourceBlockers.length} source blockers: ${sourceBlockers.map(source => source.name).join(', ')}`,
    },
  ];

  return {
    generatedAt: nowSec,
    status: worstStatus(checks),
    checks,
  };
}
