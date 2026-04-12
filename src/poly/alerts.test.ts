import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import {
  formatSignalFilled, formatSignalRejected, formatPositionResolved,
  registerPolyAlerts,
} from './alerts.js';
import type { SignalFilledEvent, SignalRejectedEvent } from './strategy-engine.js';
import type { PositionResolvedEvent } from './pnl-tracker.js';

const filled: SignalFilledEvent = {
  signalId: 1, tradeId: 42, slug: 'will-x', outcomeLabel: 'Yes',
  probability: 0.6, bestAsk: 0.42, edgePct: 18, sizeUsd: 50,
  confidence: 'high', reasoning: 'short reason',
};

const rejected: SignalRejectedEvent = {
  slug: 'will-y', outcomeLabel: 'Yes', bestAsk: 0.5, probability: 0.52, edgePct: 2,
  rejections: [{ gate: 'signal_quality', reason: 'edge_pct 2 < min 8' }],
};

const resolvedWon: PositionResolvedEvent = {
  tradeId: 42, slug: 'will-x', outcomeLabel: 'Yes',
  status: 'won', realizedPnl: 29,
};

const resolvedVoid: PositionResolvedEvent = {
  tradeId: 7, slug: 'will-z', outcomeLabel: 'Yes',
  status: 'voided', realizedPnl: 0, voidedReason: 'delisted',
};

describe('poly alert formatters', () => {
  it('formats a filled signal with slug + edge + size', () => {
    const txt = formatSignalFilled(filled);
    expect(txt).toContain('will-x');
    expect(txt).toContain('#42');
    expect(txt).toContain('+18.0%');
    expect(txt).toContain('$50.00');
  });

  it('truncates long reasoning with ellipsis', () => {
    const long = formatSignalFilled({ ...filled, reasoning: 'x'.repeat(400) });
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThan(420);
  });

  it('formats a rejection with every gate reason', () => {
    const txt = formatSignalRejected({
      ...rejected,
      rejections: [
        { gate: 'position_limits', reason: 'already open' },
        { gate: 'signal_quality', reason: 'edge too low' },
      ],
    });
    expect(txt).toContain('position_limits');
    expect(txt).toContain('signal_quality');
  });

  it('formats a won resolution with realized pnl', () => {
    expect(formatPositionResolved(resolvedWon)).toContain('+$29.00');
    expect(formatPositionResolved(resolvedWon)).toMatch(/✅|won/);
  });

  it('formats a voided resolution with the reason', () => {
    expect(formatPositionResolved(resolvedVoid)).toContain('delisted');
  });
});

describe('registerPolyAlerts', () => {
  it('forwards signal_filled + position_resolved to sender by default', async () => {
    const se = new EventEmitter();
    const pt = new EventEmitter();
    const sent: string[] = [];
    registerPolyAlerts({
      strategyEngine: se, pnlTracker: pt,
      sender: async (t) => { sent.push(t); },
    });
    se.emit('signal_filled', filled);
    se.emit('signal_rejected', rejected);  // should be ignored by default
    pt.emit('position_resolved', resolvedWon);
    // let microtasks flush
    await new Promise(r => setImmediate(r));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('Signal filled');
    expect(sent[1]).toContain('Resolved');
  });

  it('alerts on rejections when alertRejections=true', async () => {
    const se = new EventEmitter();
    const pt = new EventEmitter();
    const sent: string[] = [];
    registerPolyAlerts({
      strategyEngine: se, pnlTracker: pt, alertRejections: true,
      sender: async (t) => { sent.push(t); },
    });
    se.emit('signal_rejected', rejected);
    await new Promise(r => setImmediate(r));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('rejected');
  });

  it('swallows sender errors so listener chain stays alive', async () => {
    const se = new EventEmitter();
    const pt = new EventEmitter();
    let sendCount = 0;
    registerPolyAlerts({
      strategyEngine: se, pnlTracker: pt,
      sender: async () => {
        sendCount++;
        if (sendCount === 1) throw new Error('telegram down');
      },
    });
    se.emit('signal_filled', filled);
    se.emit('signal_filled', filled);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    expect(sendCount).toBe(2);  // second call still happened despite first throwing
  });
});
