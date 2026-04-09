/**
 * Proactive notification system.
 *
 * Manages when and how to push notifications to Telegram.
 * Respects quiet hours and batches low-priority items.
 */

import { logger } from './logger.js';

// ── Types ────────────────────────────────────────────────────────────

export type NotificationPriority = 'high' | 'normal' | 'low';

export interface Notification {
  readonly message: string;
  readonly priority: NotificationPriority;
  readonly source: string;
}

type Sender = (text: string) => Promise<void>;

// ── State ────────────────────────────────────────────────────────────

let sender: Sender | null = null;
const pendingLow: Notification[] = [];

// Quiet hours: don't send non-high-priority notifications during these hours.
// Default: 9pm - 7am. Override via setQuietHours().
let quietStart = 21; // 9 PM
let quietEnd = 7; // 7 AM

// ── Init ─────────────────────────────────────────────────────────────

export function initNotifications(send: Sender): void {
  sender = send;

  // Flush low-priority digest every 2 hours
  setInterval(() => void flushDigest(), 2 * 60 * 60 * 1000);
}

export function setQuietHours(start: number, end: number): void {
  quietStart = start;
  quietEnd = end;
}

// ── Core ─────────────────────────────────────────────────────────────

function isQuietHour(): boolean {
  const hour = new Date().getHours();
  if (quietStart > quietEnd) {
    // Wraps midnight (e.g., 21-7)
    return hour >= quietStart || hour < quietEnd;
  }
  return hour >= quietStart && hour < quietEnd;
}

/**
 * Send a notification. Respects quiet hours for non-high-priority items.
 */
export async function notify(notification: Notification): Promise<void> {
  if (!sender) {
    logger.warn('Notification system not initialized');
    return;
  }

  if (notification.priority === 'high') {
    // High priority: always send immediately
    await sender(notification.message);
    return;
  }

  if (isQuietHour()) {
    // During quiet hours, batch non-high-priority notifications
    pendingLow.push(notification);
    logger.debug({ source: notification.source }, 'Notification batched (quiet hours)');
    return;
  }

  if (notification.priority === 'low') {
    // Low priority: batch for digest
    pendingLow.push(notification);
    return;
  }

  // Normal priority, not quiet hours: send immediately
  await sender(notification.message);
}

/**
 * Flush batched low-priority notifications as a digest.
 */
async function flushDigest(): Promise<void> {
  if (pendingLow.length === 0 || !sender) return;

  // Don't flush during quiet hours
  if (isQuietHour()) return;

  const items = pendingLow.splice(0);
  const lines = items.map((n) => `- [${n.source}] ${n.message}`);
  const digest = `Notification digest (${items.length} items):\n${lines.join('\n')}`;

  try {
    await sender(digest);
    logger.info({ count: items.length }, 'Notification digest sent');
  } catch (err) {
    logger.error({ err }, 'Failed to send notification digest');
    // Put them back for next attempt
    pendingLow.unshift(...items);
  }
}
