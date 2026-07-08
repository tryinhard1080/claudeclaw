import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  collectSettledCalibration,
  formatSettledCalibrationReport,
} from './poly-settled-calibration.js';

const NOW = 1_800_000_000;

function db(): Database.Database {
  return new Database(':memory:');
}

function bootDb(): Database.Database {
  const mem = db();
  mem.exec(`
    CREATE TABLE poly_paper_trades (
      id INTEGER PRIMARY KEY,
      created_at INTEGER NOT NULL,
      market_slug TEXT NOT NULL,
      outcome_label TEXT,
      status TEXT NOT NULL,
      resolved_at INTEGER,
      size_usd REAL,
      realized_pnl REAL
    );
    CREATE TABLE poly_signals (
      id INTEGER PRIMARY KEY,
      paper_trade_id INTEGER,
      estimated_prob REAL,
      edge_pct REAL,
      regime_label TEXT
    );
  `);
  return mem;
}

function insertTrade(
  mem: Database.Database,
  id: number,
  status: 'open' | 'won' | 'lost' | 'voided' | 'exited',
  prob: number,
  realizedPnl: number,
  sizeUsd = 50,
): void {
  mem.prepare(`
    INSERT INTO poly_paper_trades
      (id, created_at, market_slug, outcome_label, status, resolved_at, size_usd, realized_pnl)
    VALUES (?, ?, ?, 'Yes', ?, ?, ?, ?)
  `).run(id, NOW - 100, `m-${id}`, status, status === 'open' ? null : NOW - 10, sizeUsd, realizedPnl);
  if (status === 'won' || status === 'lost') {
    mem.prepare(`
      INSERT INTO poly_signals(id, paper_trade_id, estimated_prob, edge_pct, regime_label)
      VALUES (?, ?, ?, 8.5, 'vnorm_bmix_ymid')
    `).run(id, id, prob);
  }
}

describe('Polymarket settled calibration readiness', () => {
  it('fails only on missing core trade schema', () => {
    const mem = db();

    const summary = collectSettledCalibration(mem, { nowSec: NOW });

    expect(summary.status).toBe('fail');
    expect(summary.state).toBe('schema_issue');
    expect(summary.schemaIssues).toEqual(['poly_paper_trades table missing']);
    expect(formatSettledCalibrationReport(summary)).toContain('Schema warnings');
    mem.close();
  });

  it('warns clearly while waiting for actual won/lost settlements', () => {
    const mem = bootDb();
    insertTrade(mem, 1, 'open', 0.60, 0);
    insertTrade(mem, 2, 'voided', 0.60, 0);

    const summary = collectSettledCalibration(mem, { nowSec: NOW });

    expect(summary.status).toBe('warn');
    expect(summary.state).toBe('waiting_for_settlements');
    expect(summary.settledTrades).toBe(0);
    expect(summary.openTrades).toBe(1);
    expect(summary.voidedTrades).toBe(1);
    expect(summary.verdict).toMatch(/no won\/lost/i);
    mem.close();
  });

  it('computes calibration and realized-P&L metrics before the 50-trade target', () => {
    const mem = bootDb();
    insertTrade(mem, 1, 'won', 0.70, 30, 40);
    insertTrade(mem, 2, 'lost', 0.30, -10, 20);

    const summary = collectSettledCalibration(mem, { nowSec: NOW });

    expect(summary.status).toBe('warn');
    expect(summary.state).toBe('sample_incomplete');
    expect(summary.settledTrades).toBe(2);
    expect(summary.realizedPnlUsd).toBe(20);
    expect(summary.settledRoiPct).toBeCloseTo(20 / 60, 6);
    expect(summary.winRate).toBeCloseTo(0.5, 6);
    expect(summary.brierScore).toBeCloseTo(0.09, 6);
    expect(summary.logLoss).toBeLessThan(0.4);
    expect(summary.avgEdgePct).toBeCloseTo(8.5, 6);
    expect(summary.populatedBuckets.map(bucket => bucket.label)).toEqual(['30-40%', '70-80%']);
    mem.close();
  });

  it('passes only when sample size, realized P&L, and calibration links all pass', () => {
    const mem = bootDb();
    for (let i = 1; i <= 50; i++) {
      insertTrade(mem, i, 'won', 0.60, 1, 10);
    }

    const summary = collectSettledCalibration(mem, { nowSec: NOW });

    expect(summary.status).toBe('pass');
    expect(summary.state).toBe('box2_ready_for_review');
    expect(summary.settledTrades).toBe(50);
    expect(summary.calibrationSamples).toBe(50);
    expect(summary.realizedPnlUsd).toBe(50);
    expect(summary.realizedPnlPositive).toBe(true);
    expect(summary.brierScore).toBeCloseTo(0.16, 6);
    mem.close();
  });

  it('keeps Box 2 open when settled trades lack linked signal probabilities', () => {
    const mem = bootDb();
    for (let i = 1; i <= 50; i++) {
      insertTrade(mem, i, 'won', 0.60, 1, 10);
    }
    mem.prepare('DELETE FROM poly_signals WHERE id = 50').run();

    const summary = collectSettledCalibration(mem, { nowSec: NOW });

    expect(summary.status).toBe('warn');
    expect(summary.state).toBe('calibration_link_incomplete');
    expect(summary.calibrationSamples).toBe(49);
    expect(summary.missingCalibrationSamples).toBe(1);
    mem.close();
  });
});
