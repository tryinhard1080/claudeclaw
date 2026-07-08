import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  collectSettlementImpact,
  formatSettlementImpactReport,
} from './poly-settlement-impact.js';

const NOW = 1_800_000_000;

function db(): Database.Database {
  return new Database(':memory:');
}

describe('Polymarket settlement impact', () => {
  it('summarizes due-window sample movement and realized P&L scenarios', () => {
    const mem = db();
    mem.exec(`
      CREATE TABLE poly_paper_trades (
        id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        outcome_label TEXT,
        entry_price REAL,
        shares REAL,
        status TEXT NOT NULL,
        size_usd REAL,
        realized_pnl REAL
      );
      CREATE TABLE poly_markets (
        slug TEXT PRIMARY KEY,
        question TEXT,
        end_date INTEGER NOT NULL
      );
      CREATE TABLE poly_positions (
        paper_trade_id INTEGER NOT NULL,
        current_price REAL,
        unrealized_pnl REAL
      );
      INSERT INTO poly_paper_trades(id, created_at, market_slug, outcome_label, entry_price, shares, status, size_usd, realized_pnl) VALUES
        (1, ${NOW - 500}, 'settled-win', 'Yes', 0.40, 50, 'won', 20, 30),
        (2, ${NOW - 400}, 'due-negative', 'Yes', 0.40, 50, 'open', 20, NULL),
        (3, ${NOW - 300}, 'due-positive', 'Yes', 0.60, 50, 'open', 30, NULL),
        (4, ${NOW - 200}, 'later', 'Yes', 0.50, 20, 'open', 10, NULL);
      INSERT INTO poly_markets(slug, question, end_date) VALUES
        ('due-negative', 'Due negative?', ${NOW + 2 * 86400}),
        ('due-positive', 'Due positive?', ${NOW + 3 * 86400}),
        ('later', 'Later?', ${NOW + 10 * 86400});
      INSERT INTO poly_positions(paper_trade_id, current_price, unrealized_pnl) VALUES
        (2, 0.30, -5),
        (3, 0.72, 6),
        (4, 0.50, 0);
    `);

    const summary = collectSettlementImpact(mem, { nowSec: NOW, horizonDays: 7, maxItems: 5 });

    expect(summary.settledTrades).toBe(1);
    expect(summary.dueTrades).toBe(2);
    expect(summary.potentialSettledAfterWindow).toBe(3);
    expect(summary.stillNeededAfterWindow).toBe(47);
    expect(summary.dueExposureUsd).toBe(50);
    expect(summary.dueUnrealizedPnlUsd).toBe(1);
    expect(summary.allHeldOutcomesWinPnlUsd).toBe(50);
    expect(summary.allHeldOutcomesLosePnlUsd).toBe(-50);
    expect(summary.items.map(item => item.marketSlug)).toEqual(['due-negative', 'due-positive']);
    expect(summary.items[0]).toMatchObject({
      tradeId: 2,
      winPnlUsd: 30,
      lossPnlUsd: -20,
      unrealizedPnlUsd: -5,
    });

    const report = formatSettlementImpactReport(summary);
    expect(report).toContain('Potential after window    3/50');
    expect(report).toContain('If held outcomes win      +$50.00');
    expect(report).toContain('#2');
    mem.close();
  });

  it('reports missing core tables as schema warnings without throwing', () => {
    const mem = db();

    const summary = collectSettlementImpact(mem, { nowSec: NOW });

    expect(summary.schemaIssues).toEqual([
      'poly_paper_trades table missing',
      'poly_markets table missing',
    ]);
    expect(summary.stillNeededAfterWindow).toBe(50);
    expect(formatSettlementImpactReport(summary)).toContain('Schema warnings');
    mem.close();
  });
});
