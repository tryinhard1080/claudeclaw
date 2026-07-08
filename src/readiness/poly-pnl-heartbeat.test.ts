import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  collectPnlHeartbeat,
  formatPnlHeartbeatReport,
} from './poly-pnl-heartbeat.js';

const NOW = 1_800_000_000;

function db(): Database.Database {
  return new Database(':memory:');
}

function createCoreTables(mem: Database.Database): void {
  mem.exec(`
    CREATE TABLE poly_paper_trades (
      id INTEGER PRIMARY KEY,
      market_slug TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE poly_positions (
      paper_trade_id INTEGER PRIMARY KEY,
      updated_at INTEGER
    );
  `);
}

describe('Polymarket P&L heartbeat', () => {
  it('passes when all open positions were recently marked', () => {
    const mem = db();
    createCoreTables(mem);
    mem.exec(`
      INSERT INTO poly_paper_trades(id, market_slug, status) VALUES
        (1, 'fresh-one', 'open'),
        (2, 'fresh-two', 'open'),
        (3, 'settled', 'won');
      INSERT INTO poly_positions(paper_trade_id, updated_at) VALUES
        (1, ${NOW - 300}),
        (2, ${NOW - 600});
    `);

    const summary = collectPnlHeartbeat(mem, { nowSec: NOW, maxAgeSec: 3600 });

    expect(summary.status).toBe('pass');
    expect(summary.state).toBe('fresh');
    expect(summary.openTrades).toBe(2);
    expect(summary.positionRows).toBe(2);
    expect(summary.freshPositionRows).toBe(2);
    expect(summary.newestPositionAgeSec).toBe(300);
    expect(summary.oldestPositionAgeSec).toBe(600);
    expect(formatPnlHeartbeatReport(summary)).toContain('Status                    PASS fresh');
    mem.close();
  });

  it('warns when open positions are stale or missing position rows', () => {
    const mem = db();
    createCoreTables(mem);
    mem.exec(`
      INSERT INTO poly_paper_trades(id, market_slug, status) VALUES
        (1, 'stale-one', 'open'),
        (2, 'fresh-two', 'open'),
        (3, 'missing-position', 'open');
      INSERT INTO poly_positions(paper_trade_id, updated_at) VALUES
        (1, ${NOW - 7201}),
        (2, ${NOW - 60});
    `);

    const summary = collectPnlHeartbeat(mem, { nowSec: NOW, maxAgeSec: 7200 });

    expect(summary.status).toBe('warn');
    expect(summary.state).toBe('missing_positions');
    expect(summary.openTrades).toBe(3);
    expect(summary.positionRows).toBe(2);
    expect(summary.freshPositionRows).toBe(1);
    expect(summary.stalePositionRows).toBe(1);
    expect(summary.missingPositionRows).toBe(1);
    expect(formatPnlHeartbeatReport(summary)).toContain('Stale / missing positions 1/1');
    mem.close();
  });

  it('fails when core tables are missing', () => {
    const mem = db();

    const summary = collectPnlHeartbeat(mem, { nowSec: NOW });

    expect(summary.status).toBe('fail');
    expect(summary.state).toBe('schema_issue');
    expect(summary.schemaIssues).toEqual([
      'poly_paper_trades table missing',
      'poly_positions table missing',
    ]);
    expect(formatPnlHeartbeatReport(summary)).toContain('Schema warnings');
    mem.close();
  });
});
