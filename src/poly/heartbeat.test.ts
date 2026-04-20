import { describe, it, expect } from 'vitest';
import { computeHeartbeatAlerts } from './heartbeat.js';

const nowMs = 1_760_000_000_000; // fixed epoch for all samples
const cfg = {
  staleMinutes: 10,        // alert when >10 min with no ok scan
  graceSeconds: 300,        // no alerts in first 5 min of uptime
  walWarnBytes: 100 * 1024 * 1024,  // 100 MB
  dbWarnBytes: 500 * 1024 * 1024,   // 500 MB
};

describe('computeHeartbeatAlerts', () => {
  it('emits no alerts during the grace period', () => {
    const r = computeHeartbeatAlerts(
      {
        lastOkAtSec: null,             // no scan ever
        walSizeBytes: 10 * 1024 ** 3,  // 10 GB WAL (would normally alert)
        dbSizeBytes: 10 * 1024 ** 3,
        nowMs,
        uptimeMs: 60_000,              // 1 min — still in grace
      },
      cfg,
    );
    expect(r.alerts).toEqual([]);
  });

  it('emits scan_stale when the last ok scan is older than the threshold', () => {
    const r = computeHeartbeatAlerts(
      {
        lastOkAtSec: Math.floor(nowMs / 1000) - 20 * 60, // 20 min ago > 10 min
        walSizeBytes: 0,
        dbSizeBytes: 0,
        nowMs,
        uptimeMs: 10 * 60 * 1000, // past grace
      },
      cfg,
    );
    expect(r.alerts).toContain('scan_stale');
  });

  it('does not emit scan_stale when last scan is within threshold', () => {
    const r = computeHeartbeatAlerts(
      {
        lastOkAtSec: Math.floor(nowMs / 1000) - 5 * 60, // 5 min ago < 10 min
        walSizeBytes: 0,
        dbSizeBytes: 0,
        nowMs,
        uptimeMs: 60 * 60 * 1000,
      },
      cfg,
    );
    expect(r.alerts).not.toContain('scan_stale');
  });

  it('emits scan_stale when MAX(started_at) returns null (never scanned)', () => {
    const r = computeHeartbeatAlerts(
      {
        lastOkAtSec: null,
        walSizeBytes: 0,
        dbSizeBytes: 0,
        nowMs,
        uptimeMs: 30 * 60 * 1000, // past grace
      },
      cfg,
    );
    expect(r.alerts).toContain('scan_stale');
  });

  it('emits wal_size when WAL exceeds threshold', () => {
    const r = computeHeartbeatAlerts(
      {
        lastOkAtSec: Math.floor(nowMs / 1000),
        walSizeBytes: 200 * 1024 * 1024, // 200 MB
        dbSizeBytes: 10 * 1024 * 1024,
        nowMs,
        uptimeMs: 60 * 60 * 1000,
      },
      cfg,
    );
    expect(r.alerts).toContain('wal_size');
  });

  it('emits db_size when DB exceeds threshold', () => {
    const r = computeHeartbeatAlerts(
      {
        lastOkAtSec: Math.floor(nowMs / 1000),
        walSizeBytes: 0,
        dbSizeBytes: 9 * 1024 * 1024 * 1024, // 9 GB
        nowMs,
        uptimeMs: 60 * 60 * 1000,
      },
      cfg,
    );
    expect(r.alerts).toContain('db_size');
  });

  it('can emit all three alerts at once', () => {
    const r = computeHeartbeatAlerts(
      {
        lastOkAtSec: Math.floor(nowMs / 1000) - 60 * 60, // 1h stale
        walSizeBytes: 5 * 1024 ** 3,
        dbSizeBytes: 9 * 1024 ** 3,
        nowMs,
        uptimeMs: 60 * 60 * 1000,
      },
      cfg,
    );
    expect(r.alerts).toEqual(['scan_stale', 'wal_size', 'db_size']);
  });
});
