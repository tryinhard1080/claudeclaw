import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { runAt } from '../../migrations/v1.8.0/v1.8.0-scan-runs.js';

describe('v1.8.0 scan-runs migration', () => {
  it('creates poly_scan_runs with expected columns + index', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-sr-mig-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const names = (db.prepare(`PRAGMA table_info(poly_scan_runs)`).all() as Array<{ name: string }>).map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['id', 'started_at', 'duration_ms', 'market_count', 'status', 'error']));
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='poly_scan_runs'`).all() as Array<{ name: string }>;
    expect(idx.map(i => i.name)).toContain('idx_poly_scan_runs_started');
    db.close();
    fs.unlinkSync(tmp);
  });

  it('is idempotent', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-sr-mig-idem-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='poly_scan_runs'`).get() as { n: number }).n;
    expect(n).toBe(1);
    db.close();
    fs.unlinkSync(tmp);
  });
});
