import { readFile, stat } from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

import { logger } from '../logger.js';
import type { InstanceState } from './types.js';

const DEFAULT_STALENESS_MS = 60 * 60 * 1000; // 1 hour

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

export interface InstanceStaleEvent {
  instance: string;
  stateFileMtime: number;
  ageMs: number;
}

/**
 * Polls regime-trader instance state.json files and emits events
 * on regime changes, circuit breaker activations, and errors.
 */
export class StatePoller extends EventEmitter {
  private states = new Map<string, InstanceState>();
  private previousRegimes = new Map<string, string>();
  private previousBreakers = new Map<string, Set<string>>();
  private staleFlagged = new Set<string>();
  private errorFlagged = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly stalenessMs: number;
  private readonly now: () => number;

  constructor(
    private readonly basePath: string,
    private readonly instanceNames: readonly string[],
    private readonly intervalMs = 5000,
    opts: { stalenessMs?: number; now?: () => number } = {},
  ) {
    super();
    this.stalenessMs = opts.stalenessMs ?? DEFAULT_STALENESS_MS;
    this.now = opts.now ?? (() => Date.now());
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
      const st = await stat(stateFile);
      const ageMs = this.now() - st.mtimeMs;
      if (ageMs > this.stalenessMs) {
        if (!this.staleFlagged.has(name)) {
          const event: InstanceStaleEvent = { instance: name, stateFileMtime: st.mtimeMs, ageMs };
          this.emit('instance_stale', event);
          logger.warn(event, 'Instance state file is stale (Python partner may be down)');
          this.staleFlagged.add(name);
        }
      } else if (this.staleFlagged.has(name)) {
        this.staleFlagged.delete(name);
        logger.info({ instance: name }, 'Instance state file is fresh again');
      }
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

      // Instance is healthy again: clear error flag (next down event will re-alert)
      if (this.errorFlagged.has(name)) {
        this.errorFlagged.delete(name);
        logger.info({ instance: name }, 'Instance state file readable again');
      }
    } catch {
      // Only emit once per down period — flag is cleared when state becomes readable again
      if (!this.errorFlagged.has(name)) {
        const event: InstanceErrorEvent = { instance: name, error: 'Cannot read state.json' };
        this.emit('instance_error', event);
        this.errorFlagged.add(name);
      }
    }
  }

  getState(instance: string): InstanceState | undefined {
    return this.states.get(instance);
  }

  getAllStates(): Map<string, InstanceState> {
    return new Map(this.states);
  }
}
