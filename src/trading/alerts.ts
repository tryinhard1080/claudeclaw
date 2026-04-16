import { logger } from '../logger.js';
import type { TradingAlert } from './types.js';

type Sender = (text: string) => Promise<void>;

/**
 * Rate-limited trading alert manager.
 * Sends Telegram messages on regime changes, circuit breakers, etc.
 * Throttles to max 1 alert per type per instance per 15 minutes.
 */
export class TradingAlertManager {
  private lastAlerts = new Map<string, number>();
  private readonly throttleMs: number;
  private enabled = true;

  constructor(
    private readonly sender: Sender,
    throttleMinutes = 15,
  ) {
    this.throttleMs = throttleMinutes * 60 * 1000;
  }

  toggle(on: boolean): void {
    this.enabled = on;
    logger.info({ enabled: on }, 'Trading alerts toggled');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async send(alert: TradingAlert): Promise<boolean> {
    if (!this.enabled) return false;

    const key = `${alert.type}:${alert.instance}`;
    const last = this.lastAlerts.get(key);
    if (last && Date.now() - last < this.throttleMs) return false;

    this.lastAlerts.set(key, Date.now());

    try {
      await this.sender(this.formatAlert(alert));
      logger.info({ type: alert.type, instance: alert.instance }, 'Trading alert sent');
      return true;
    } catch (err) {
      logger.error({ err, alert }, 'Failed to send trading alert');
      return false;
    }
  }

  private formatAlert(alert: TradingAlert): string {
    const timestamp = new Date(alert.timestamp).toLocaleTimeString();

    switch (alert.type) {
      case 'regime_change':
        return `REGIME CHANGE [${alert.instance}]\n${alert.message}\nTime: ${timestamp}`;
      case 'circuit_breaker':
        return `CIRCUIT BREAKER [${alert.instance}]\n${alert.message}\nTime: ${timestamp}`;
      case 'instance_down':
        return `INSTANCE DOWN [${alert.instance}]\n${alert.message}\nTime: ${timestamp}`;
      case 'instance_halted':
        return `INSTANCE HALTED [${alert.instance}]\n${alert.message}\nTime: ${timestamp}`;
      case 'instance_stale':
        return `INSTANCE STALE [${alert.instance}]\n${alert.message}\nTime: ${timestamp}`;
      default:
        return `TRADING ALERT [${alert.instance}]\n${alert.message}`;
    }
  }
}
