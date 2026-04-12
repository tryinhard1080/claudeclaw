import { readFile } from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

import { logger } from '../logger.js';
import type { InstanceState } from './types.js';

export interface RegimeChangeEvent {
  instance: string;
  from: string;
  to: string;
  confidence: number;
}

export interface CircuitBreakerEvent {
  instance: string;
  breaker: string;
}

export interface InstanceErrorEvent {
  instance: string;
  error: string;
}

/**
 * Polls regime-trader instance state.json files and emits events
 * on regime changes, circuit breaker activations, and errors.
 */
export class StatePoller extends EventEmitter {
  private states = new Map<string, InstanceState>();
  private previousRegimes = new Map<string, string>();
  private previousBreakers = new Map<string, Set<string>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly basePath: string,
    private readonly instanceNames: readonly string[],
    private readonly intervalMs = 5000,
  ) {
    super();
  }

  start(): void {
    if (this.timer) return;
    // Initial poll
    void this.pollAll();
    this.timer = setInterval(() => void this.pollAll(), this.intervalMs);
    logger.info({ instances: this.instanceNames, intervalMs: this.intervalMs }, 'Trading state poller started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async pollAll(): Promise<void> {
    await Promise.all(this.instanceNames.map(name => this.pollInstance(name)));
  }

  private async pollInstance(name: string): Promise<void> {
    const stateFile = path.join(this.basePath, 'instances', name, 'data', 'state.json');
    try {
      const raw = await readFile(stateFile, 'utf8');
      const state: InstanceState = JSON.parse(raw);

      // Detect regime change
      const prevRegime = this.previousRegimes.get(name);
      if (prevRegime !== undefined && prevRegime !== state.regime.regime) {
        const event: RegimeChangeEvent = {
          instance: name,
          from: prevRegime,
          to: state.regime.regime,
          confidence: state.regime.confidence,
        };
        this.emit('regime_change', event);
        logger.info(event, 'Regime change detected');
      }
      this.previousRegimes.set(name, state.regime.regime);

      // Detect circuit breaker activations (only fire on NEW activations)
      const prevBreakers = this.previousBreakers.get(name) ?? new Set<string>();
      const currentBreakers = new Set<string>();
      if (state.risk.circuit_breakers) {
        for (const [key, active] of Object.entries(state.risk.circuit_breakers)) {
          if (active) {
            currentBreakers.add(key);
            if (!prevBreakers.has(key)) {
              const event: CircuitBreakerEvent = { instance: name, breaker: key };
              this.emit('circuit_breaker', event);
              logger.warn(event, 'Circuit breaker activated');
            }
          }
        }
      }
      this.previousBreakers.set(name, currentBreakers);

      this.states.set(name, state);
    } catch {
      const event: InstanceErrorEvent = { instance: name, error: 'Cannot read state.json' };
      this.emit('instance_error', event);
    }
  }

  getState(instance: string): InstanceState | undefined {
    return this.states.get(instance);
  }

  getAllStates(): Map<string, InstanceState> {
    return new Map(this.states);
  }
}
