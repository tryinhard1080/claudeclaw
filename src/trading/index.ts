import { logger } from '../logger.js';
import { StatePoller } from './state-poller.js';
import { InstanceController } from './instance-control.js';
import { TradingAlertManager } from './alerts.js';
import type { TradingAlert } from './types.js';

export { StatePoller } from './state-poller.js';
export { InstanceController } from './instance-control.js';
export { TradingAlertManager } from './alerts.js';
export { registerTradingCommands } from './telegram-commands.js';

interface TradingModules {
  poller: StatePoller;
  controller: InstanceController;
  alertManager: TradingAlertManager;
}

/**
 * Initialize the trading integration bridge.
 * Starts polling regime-trader state files and wires up alerts.
 */
export function initTrading(
  sender: (text: string) => Promise<void>,
  regimeTraderPath: string,
  instanceNames: readonly string[],
): TradingModules {
  const poller = new StatePoller(regimeTraderPath, instanceNames);
  const controller = new InstanceController(regimeTraderPath);
  const alertManager = new TradingAlertManager(sender);

  // Wire poller events to Telegram alerts
  poller.on('regime_change', (data: { instance: string; from: string; to: string; confidence: number }) => {
    const alert: TradingAlert = {
      type: 'regime_change',
      instance: data.instance,
      message: `${data.from} -> ${data.to} (conf: ${data.confidence.toFixed(2)})`,
      timestamp: Date.now(),
    };
    void alertManager.send(alert);
  });

  poller.on('circuit_breaker', (data: { instance: string; breaker: string }) => {
    const alert: TradingAlert = {
      type: 'circuit_breaker',
      instance: data.instance,
      message: `Breaker activated: ${data.breaker}`,
      timestamp: Date.now(),
    };
    void alertManager.send(alert);
  });

  poller.on('instance_error', (data: { instance: string; error: string }) => {
    const alert: TradingAlert = {
      type: 'instance_down',
      instance: data.instance,
      message: data.error,
      timestamp: Date.now(),
    };
    void alertManager.send(alert);
  });

  poller.on('instance_stale', (data: { instance: string; stateFileMtime: number; ageMs: number }) => {
    const ageMin = Math.round(data.ageMs / 60000);
    const alert: TradingAlert = {
      type: 'instance_stale',
      instance: data.instance,
      message: `state.json not updated for ${ageMin}m (regime-trader Python partner may be stopped)`,
      timestamp: Date.now(),
    };
    void alertManager.send(alert);
  });

  poller.start();
  logger.info({ path: regimeTraderPath, instances: instanceNames }, 'Trading integration initialized');

  return { poller, controller, alertManager };
}
