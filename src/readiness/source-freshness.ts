import type Database from 'better-sqlite3';

import type { ReadinessStatus } from './gate-progress.js';

export interface SourceFreshnessRow {
  source_name: string;
  last_fetch_at: number | null;
  last_success_at: number | null;
  stale_after_sec: number;
  last_error: string | null;
  used_by_signal: number;
  updated_at: number;
}

export interface SourceFreshnessInput {
  sourceName: string;
  fetchedAt: number;
  success: boolean;
  staleAfterSec: number;
  lastError?: string | null;
  usedBySignal?: boolean;
  updatedAt?: number;
}

export interface SourceFreshnessCheck {
  name: string;
  status: ReadinessStatus;
  state: string;
  detail: string;
}

export function ensureSourceFreshnessTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_freshness (
      source_name      TEXT PRIMARY KEY,
      last_fetch_at    INTEGER,
      last_success_at  INTEGER,
      stale_after_sec  INTEGER NOT NULL,
      last_error       TEXT,
      used_by_signal   INTEGER NOT NULL DEFAULT 0,
      updated_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_source_freshness_success
      ON source_freshness(last_success_at DESC);
  `);
}

export function recordSourceFreshness(db: Database.Database, input: SourceFreshnessInput): void {
  ensureSourceFreshnessTable(db);
  const updatedAt = input.updatedAt ?? input.fetchedAt;
  const lastSuccessAt = input.success ? input.fetchedAt : null;
  db.prepare(`
    INSERT INTO source_freshness (
      source_name, last_fetch_at, last_success_at, stale_after_sec,
      last_error, used_by_signal, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_name) DO UPDATE SET
      last_fetch_at = excluded.last_fetch_at,
      last_success_at = COALESCE(excluded.last_success_at, source_freshness.last_success_at),
      stale_after_sec = excluded.stale_after_sec,
      last_error = excluded.last_error,
      used_by_signal = excluded.used_by_signal,
      updated_at = excluded.updated_at
  `).run(
    input.sourceName,
    input.fetchedAt,
    lastSuccessAt,
    input.staleAfterSec,
    input.lastError ?? null,
    input.usedBySignal ? 1 : 0,
    updatedAt,
  );
}

export function classifySourceFreshness(row: SourceFreshnessRow, nowSec: number): SourceFreshnessCheck {
  if (row.last_success_at === null) {
    return {
      name: row.source_name,
      status: 'fail',
      state: 'never_succeeded',
      detail: row.last_error ?? 'no successful fetch recorded',
    };
  }

  const ageSec = nowSec - row.last_success_at;
  if (ageSec <= row.stale_after_sec) {
    return {
      name: row.source_name,
      status: 'pass',
      state: row.used_by_signal ? 'fresh_signal_source' : 'fresh',
      detail: `${Math.round(ageSec / 60)}m old; threshold ${Math.round(row.stale_after_sec / 60)}m`,
    };
  }

  return {
    name: row.source_name,
    status: 'warn',
    state: row.used_by_signal ? 'stale_signal_source' : 'stale',
    detail: `${Math.round(ageSec / 60)}m old; threshold ${Math.round(row.stale_after_sec / 60)}m`,
  };
}

export function readSourceFreshnessChecks(db: Database.Database, nowSec: number): SourceFreshnessCheck[] {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='source_freshness'",
  ).get() as { name?: string } | undefined;

  if (table?.name !== 'source_freshness') {
    return [{
      name: 'source_freshness',
      status: 'warn',
      state: 'table_missing',
      detail: 'run migrations to create source_freshness',
    }];
  }

  const rows = db.prepare(`
    SELECT source_name, last_fetch_at, last_success_at, stale_after_sec,
           last_error, used_by_signal, updated_at
      FROM source_freshness
     ORDER BY source_name ASC
  `).all() as SourceFreshnessRow[];

  if (rows.length === 0) {
    return [{
      name: 'source_freshness',
      status: 'warn',
      state: 'empty',
      detail: 'no source freshness rows yet',
    }];
  }

  return rows.map(row => classifySourceFreshness(row, nowSec));
}

