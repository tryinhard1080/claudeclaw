import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { runAt } from '../../migrations/v1.3.0/v1.3.0-calibration.js';

describe('v1.3.0 calibration migration', () => {
  it('creates poly_calibration_snapshots with the expected columns and index', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-cal-mig-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const cols = db.prepare(`PRAGMA table_info(poly_calibration_snapshots)`).all() as Array<{ name: string }>;
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual([
      'brier_score', 'created_at', 'curve_json', 'id',
      'log_loss', 'n_samples', 'win_rate', 'window_end', 'window_start',
    ]);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='poly_calibration_snapshots'`).all() as Array<{ name: string }>;
    expect(idx.map(i => i.name)).toContain('idx_poly_calibration_created');
    db.close();
    fs.unlinkSync(tmp);
  });

  it('is idempotent (CREATE IF NOT EXISTS)', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-cal-mig-idem-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM poly_calibration_snapshots`).get()).toEqual({ n: 0 });
    db.close();
    fs.unlinkSync(tmp);
  });
});
