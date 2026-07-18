import type { EventEmitter } from 'events';
import { logger } from '../logger.js';
import type { SignalFilledEvent, SignalRejectedEvent } from './strategy-engine.js';
import type { PositionResolvedEvent } from './pnl-tracker.js';

export type AlertSender = (text: string) => Promise<void>;

const pct = (n: number, digits = 1): string =>
  (n >= 0 ? '+' : '') + n.toFixed(digits) + '%';

const money = (n: number): string =>
  (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toFixed(2);

export function formatSignalFilled(e: SignalFilledEvent): string {
  return [
    `🎯 Signal filled · #${e.tradeId}`,
    `${e.slug} (${e.outcomeLabel})`,
    `ask ${(e.bestAsk * 100).toFixed(1)}¢ · p̂ ${(e.probability * 100).toFixed(1)}% · edge ${pct(e.edgePct)} · ${e.confidence}`,
    `size $${e.sizeUsd.toFixed(2)}`,
    e.reasoning.length > 200 ? e.reasoning.slice(0, 200) + '…' : e.reasoning,
  ].join('\n');
}

export function formatSignalRejected(e: SignalRejectedEvent): string {
  const reasons = e.rejections.map(r => `  · ${r.gate}: ${r.reason}`).join('\n');
  return [
    `⚠️ Signal rejected`,
    `${e.slug} (${e.outcomeLabel})`,
    `ask ${(e.bestAsk * 100).toFixed(1)}¢ · p̂ ${(e.probability * 100).toFixed(1)}% · edge ${pct(e.edgePct)}`,
    reasons,
  ].join('\n');
}

export function formatPositionResolved(e: PositionResolvedEvent): string {
  const icon = e.status === 'won' ? '✅' : e.status === 'lost' ? '❌' : '◻️';
  const tail = e.status === 'voided'
    ? ` (${e.voidedReason ?? 'voided'})`
    : ` · ${money(e.realizedPnl)}`;
  return `${icon} Resolved · #${e.tradeId} ${e.slug} (${e.outcomeLabel}) ${e.status}${tail}`;
}

/** Batch window for position_resolved alerts. One reconcile pass can settle
 *  dozens of positions in the same tick; per-event sends would hit Telegram's
 *  per-chat rate limit and get silently dropped by the catch below. */
const RESOLVED_FLUSH_MS = 2000;
const RESOLVED_BATCH_MAX_LINES = 25;

export function formatResolvedBatch(events: PositionResolvedEvent[]): string {
  const won = events.filter(e => e.status === 'won').length;
  const lost = events.filter(e => e.status === 'lost').length;
  const other = events.length - won - lost;
  const net = events.reduce((s, e) => s + e.realizedPnl, 0);
  const lines = events.slice(0, RESOLVED_BATCH_MAX_LINES).map(formatPositionResolved);
  const more = events.length - RESOLVED_BATCH_MAX_LINES;
  return [
    `📊 Resolved ${events.length} positions · ✅ ${won} · ❌ ${lost} · ◻️ ${other} · net ${money(net)}`,
    ...lines,
    ...(more > 0 ? [`… and ${more} more`] : []),
  ].join('\n');
}

export interface RegisterAlertsOpts {
  strategyEngine: EventEmitter;
  pnlTracker: EventEmitter;
  sender: AlertSender;
  /** Emit alerts for gate rejections. Noisy — default off. */
  alertRejections?: boolean;
}

export function registerPolyAlerts(opts: RegisterAlertsOpts): void {
  const send = (text: string): void => {
    opts.sender(text).catch(err =>
      logger.warn({ err: String(err) }, 'poly alert send failed'));
  };

  opts.strategyEngine.on('signal_filled', (e: SignalFilledEvent) => send(formatSignalFilled(e)));
  if (opts.alertRejections) {
    opts.strategyEngine.on('signal_rejected', (e: SignalRejectedEvent) =>
      send(formatSignalRejected(e)));
  }

  let pendingResolved: PositionResolvedEvent[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  const flushResolved = (): void => {
    flushTimer = null;
    const events = pendingResolved;
    pendingResolved = [];
    if (events.length === 0) return;
    if (events.length === 1) send(formatPositionResolved(events[0]!));
    else send(formatResolvedBatch(events));
  };
  opts.pnlTracker.on('position_resolved', (e: PositionResolvedEvent) => {
    pendingResolved.push(e);
    if (flushTimer === null) {
      flushTimer = setTimeout(flushResolved, RESOLVED_FLUSH_MS);
      flushTimer.unref?.();
    }
  });
}
