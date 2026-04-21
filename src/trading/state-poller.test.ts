import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { StatePoller, type InstanceStaleEvent, type RegimeChangeEvent, type CircuitBreakerEvent, type InstanceErrorEvent } from './state-poller.js';

function mkState(regime = 'NEUTRAL', confidence = 0.8, breakers: Record<string, boolean> = {}) {
  return JSON.stringify({
    instance: 'spy-aggressive',
    timestamp: new Date().toISOString(),
    regime: { regime, confidence, reasoning: 'test' },
    risk: { circuit_breakers: breakers },
    positions: [],
    regime_infos: [],
    recent_signals: [],
  });
}

async function writeStateFile(base: string, name: string, content: string, mtime?: number): Promise<string> {
  const dir = path.join(base, 'instances', name, 'data');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'state.json');
  await writeFile(file, content);
  if (mtime !== undefined) {
    await utimes(file, mtime / 1000, mtime / 1000);
  }
  return file;
}

describe('StatePoller', () => {
  let base: string;
  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'claudeclaw-state-'));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('emits regime_change when regime transitions', async () => {
    await writeStateFile(base, 'spy', mkState('NEUTRAL'));
    const poller = new StatePoller(base, ['spy'], 99999);
    const events: RegimeChangeEvent[] = [];
    poller.on('regime_change', (e: RegimeChangeEvent) => events.push(e));
    await (poller as any).pollAll();
    await writeStateFile(base, 'spy', mkState('STRONG_BULL'));
    await (poller as any).pollAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ instance: 'spy', from: 'NEUTRAL', to: 'STRONG_BULL' });
  });

  it('emits circuit_breaker only on new activation (not re-fire while active)', async () => {
    await writeStateFile(base, 'spy', mkState('NEUTRAL', 0.9, {}));
    const poller = new StatePoller(base, ['spy'], 99999);
    const events: CircuitBreakerEvent[] = [];
    poller.on('circuit_breaker', (e: CircuitBreakerEvent) => events.push(e));
    await (poller as any).pollAll();
    await writeStateFile(base, 'spy', mkState('NEUTRAL', 0.9, { max_loss: true }));
    await (poller as any).pollAll();
    await (poller as any).pollAll();
    expect(events).toHaveLength(1);
    expect(events[0]?.breaker).toBe('max_loss');
  });

  it('emits instance_error once when state.json unreadable (dedupes repeat polls)', async () => {
    const poller = new StatePoller(base, ['ghost'], 99999);
    const events: InstanceErrorEvent[] = [];
    poller.on('instance_error', (e: InstanceErrorEvent) => events.push(e));
    await (poller as any).pollAll();
    await (poller as any).pollAll(); // second poll should NOT re-fire
    await (poller as any).pollAll(); // third poll should NOT re-fire
    expect(events).toHaveLength(1);
    expect(events[0]?.instance).toBe('ghost');
  });

  it('re-arms instance_error alert after file becomes readable then unreadable again', async () => {
    const poller = new StatePoller(base, ['spy'], 99999);
    const events: InstanceErrorEvent[] = [];
    poller.on('instance_error', (e: InstanceErrorEvent) => events.push(e));

    // File missing → fires
    await (poller as any).pollAll();
    expect(events).toHaveLength(1);

    // File appears → clears flag
    await writeStateFile(base, 'spy', mkState());
    await (poller as any).pollAll();
    expect(events).toHaveLength(1); // no new alert

    // File deleted → re-arms and fires again
    await rm(path.join(base, 'instances', 'spy', 'data', 'state.json'));
    await (poller as any).pollAll();
    expect(events).toHaveLength(2);
  });

  it('emits instance_stale once when state.json mtime exceeds threshold', async () => {
    const now = 10_000_000;
    const old = now - 90 * 60 * 1000; // 90 min old
    await writeStateFile(base, 'spy', mkState(), old);
    const poller = new StatePoller(base, ['spy'], 99999, {
      stalenessMs: 60 * 60 * 1000, // 1 hour
      now: () => now,
    });
    const events: InstanceStaleEvent[] = [];
    poller.on('instance_stale', (e: InstanceStaleEvent) => events.push(e));
    await (poller as any).pollAll();
    await (poller as any).pollAll(); // second poll should NOT re-fire
    expect(events).toHaveLength(1);
    expect(events[0]?.instance).toBe('spy');
    expect(events[0]?.ageMs).toBeGreaterThan(60 * 60 * 1000);
  });

  it('does NOT emit instance_stale when state.json is fresh', async () => {
    const now = 10_000_000;
    const fresh = now - 5000; // 5s old
    await writeStateFile(base, 'spy', mkState(), fresh);
    const poller = new StatePoller(base, ['spy'], 99999, {
      stalenessMs: 60 * 60 * 1000,
      now: () => now,
    });
    const events: InstanceStaleEvent[] = [];
    poller.on('instance_stale', (e: InstanceStaleEvent) => events.push(e));
    await (poller as any).pollAll();
    expect(events).toHaveLength(0);
  });

  it('re-arms staleness alert after file becomes fresh then stale again', async () => {
    let clock = 10_000_000;
    const file = await writeStateFile(base, 'spy', mkState(), clock - 90 * 60 * 1000);
    const poller = new StatePoller(base, ['spy'], 99999, {
      stalenessMs: 60 * 60 * 1000,
      now: () => clock,
    });
    const events: InstanceStaleEvent[] = [];
    poller.on('instance_stale', (e: InstanceStaleEvent) => events.push(e));

    await (poller as any).pollAll(); // stale → fires
    expect(events).toHaveLength(1);

    // file becomes fresh
    await utimes(file, clock / 1000, clock / 1000);
    await (poller as any).pollAll(); // fresh, clears flag
    expect(events).toHaveLength(1);

    // later, file stale again
    clock += 2 * 60 * 60 * 1000;
    await (poller as any).pollAll(); // stale again → fires a 2nd time
    expect(events).toHaveLength(2);
  });
});
