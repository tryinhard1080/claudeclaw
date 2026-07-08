import type { FullRegimeInstanceState, InstanceState } from './types.js';

export type InstanceStateParseResult =
  | { ok: true; state: InstanceState }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function latestSignalRegime(raw: { recent_signals?: unknown }): string | null {
  const signals = raw.recent_signals;
  if (!Array.isArray(signals)) return null;
  for (let index = signals.length - 1; index >= 0; index -= 1) {
    const signal = signals[index];
    if (isRecord(signal) && isNonEmptyString(signal.regime)) return signal.regime;
  }
  return null;
}

function hasRegimeLabelSource(raw: Record<string, unknown>): boolean {
  return isRecord(raw.regime)
    || isNonEmptyString(raw.last_regime)
    || latestSignalRegime(raw) !== null;
}

function requireField(record: Record<string, unknown>, key: string, predicate: (value: unknown) => boolean): string | null {
  return predicate(record[key]) ? null : `${key} is required`;
}

export function parseInstanceState(raw: unknown): InstanceStateParseResult {
  if (!isRecord(raw)) return { ok: false, error: 'state must be an object' };

  const commonChecks = [
    requireField(raw, 'mode', value => value === 'paper' || value === 'live' || value === 'backtest'),
    requireField(raw, 'market_open', value => typeof value === 'boolean'),
    requireField(raw, 'equity', isFiniteNumber),
    requireField(raw, 'cash', isFiniteNumber),
  ].filter((item): item is string => item !== null);
  if (commonChecks.length > 0) return { ok: false, error: commonChecks.join('; ') };

  if (raw.market_open === false) {
    if (typeof raw.next_open !== 'string' || Number.isNaN(Date.parse(raw.next_open))) {
      return { ok: false, error: 'next_open is required for closed-market state' };
    }
    return { ok: true, state: raw as unknown as InstanceState };
  }

  const openChecks = [
    hasRegimeLabelSource(raw) ? null : 'regime label is required',
    requireField(raw, 'risk', isRecord),
    requireField(raw, 'positions', Array.isArray),
    requireField(raw, 'recent_signals', Array.isArray),
  ].filter((item): item is string => item !== null);
  if (openChecks.length > 0) return { ok: false, error: openChecks.join('; ') };

  return { ok: true, state: raw as unknown as InstanceState };
}

export function isClosedUntilNextOpen(state: InstanceState, nowMs: number, graceMs = 0): boolean {
  if (state.market_open !== false || !state.next_open) return false;
  const nextOpenMs = Date.parse(state.next_open);
  return Number.isFinite(nextOpenMs) && nowMs <= nextOpenMs + graceMs;
}

export function isFullRegimeState(state: InstanceState): state is FullRegimeInstanceState {
  return Boolean(
    state.market_open === true &&
    state.regime &&
    state.risk &&
    Array.isArray(state.positions) &&
    Array.isArray(state.recent_signals),
  );
}

export function getRegimeLabel(state: InstanceState): string | null {
  return state.regime?.label
    ?? state.regime?.regime
    ?? (isNonEmptyString(state.last_regime) ? state.last_regime : null)
    ?? latestSignalRegime(state);
}

export function getRegimeTargetAllocation(state: InstanceState): number | null {
  const latestSignal = state.recent_signals?.at(-1);
  const value = state.regime?.target_allocation
    ?? latestSignal?.approved_allocation
    ?? latestSignal?.target_allocation;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
