#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { POLY_SCAN_INTERVAL_MIN, STORE_DIR } from '../src/config.js';
import { recordSourceFreshness } from '../src/readiness/source-freshness.js';

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name) as { name?: string } | undefined;
  return row?.name === name;
}

function refreshPolymarketScan(db: Database.Database, nowSec: number): void {
  if (!tableExists(db, 'poly_scan_runs')) {
    recordSourceFreshness(db, {
      sourceName: 'polymarket-gamma-scan',
      fetchedAt: nowSec,
      success: false,
      staleAfterSec: POLY_SCAN_INTERVAL_MIN * 2 * 60,
      lastError: 'poly_scan_runs table missing',
      usedBySignal: true,
    });
    return;
  }
  const row = db.prepare(`
    SELECT started_at, status, error
      FROM poly_scan_runs
     ORDER BY started_at DESC
     LIMIT 1
  `).get() as { started_at: number; status: string; error: string | null } | undefined;
  recordSourceFreshness(db, {
    sourceName: 'polymarket-gamma-scan',
    fetchedAt: row?.started_at ?? nowSec,
    success: row?.status === 'ok',
    staleAfterSec: POLY_SCAN_INTERVAL_MIN * 2 * 60,
    lastError: row?.status === 'ok' ? null : row?.error ?? 'no successful scan row',
    usedBySignal: true,
  });
}

function refreshPriceHistory(db: Database.Database, nowSec: number): void {
  if (!tableExists(db, 'poly_price_history')) {
    recordSourceFreshness(db, {
      sourceName: 'polymarket-price-history',
      fetchedAt: nowSec,
      success: false,
      staleAfterSec: POLY_SCAN_INTERVAL_MIN * 2 * 60,
      lastError: 'poly_price_history table missing',
      usedBySignal: true,
    });
    return;
  }
  const row = db.prepare('SELECT MAX(captured_at) AS captured_at FROM poly_price_history')
    .get() as { captured_at: number | null };
  recordSourceFreshness(db, {
    sourceName: 'polymarket-price-history',
    fetchedAt: row.captured_at ?? nowSec,
    success: row.captured_at !== null,
    staleAfterSec: POLY_SCAN_INTERVAL_MIN * 2 * 60,
    lastError: row.captured_at === null ? 'no captured prices' : null,
    usedBySignal: true,
  });
}

function refreshTtlShadow(db: Database.Database, nowSec: number): void {
  if (!tableExists(db, 'poly_ttl_shadow_ticks')) {
    recordSourceFreshness(db, {
      sourceName: 'poly-ttl-shadow',
      fetchedAt: nowSec,
      success: false,
      staleAfterSec: POLY_SCAN_INTERVAL_MIN * 2 * 60,
      lastError: 'poly_ttl_shadow_ticks table missing',
      usedBySignal: false,
    });
    return;
  }
  const row = db.prepare('SELECT MAX(scan_tick_at) AS scan_tick_at FROM poly_ttl_shadow_ticks')
    .get() as { scan_tick_at: number | null };
  recordSourceFreshness(db, {
    sourceName: 'poly-ttl-shadow',
    fetchedAt: row.scan_tick_at ?? nowSec,
    success: row.scan_tick_at !== null,
    staleAfterSec: POLY_SCAN_INTERVAL_MIN * 2 * 60,
    lastError: row.scan_tick_at === null ? 'no TTL shadow ticks' : null,
    usedBySignal: false,
  });
}

function refreshNewsSync(db: Database.Database, nowSec: number): void {
  if (!tableExists(db, 'news_items')) {
    recordSourceFreshness(db, {
      sourceName: 'news-sync',
      fetchedAt: nowSec,
      success: false,
      staleAfterSec: 3 * 60 * 60,
      lastError: 'news_items table missing',
      usedBySignal: false,
    });
    return;
  }
  const row = db.prepare(`
    SELECT fetched_at, status
      FROM news_items
     ORDER BY fetched_at DESC
     LIMIT 1
  `).get() as { fetched_at: number; status: string } | undefined;
  recordSourceFreshness(db, {
    sourceName: 'news-sync',
    fetchedAt: row?.fetched_at ?? nowSec,
    success: row?.status === 'ok',
    staleAfterSec: 3 * 60 * 60,
    lastError: row ? `latest status=${row.status}` : 'no news rows',
    usedBySignal: false,
  });
}

export function main(): number {
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 5000');
    const nowSec = Math.floor(Date.now() / 1000);
    refreshPolymarketScan(db, nowSec);
    refreshPriceHistory(db, nowSec);
    refreshTtlShadow(db, nowSec);
    refreshNewsSync(db, nowSec);
    console.log('Source freshness refreshed.');
    return 0;
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error('Source freshness refresh failed:', error);
    process.exitCode = 1;
  }
}

