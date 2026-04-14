import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { runAt } from '../../migrations/v1.7.0/v1.7.0-resolutions-cache.js';

describe('v1.7.0 resolutions-cache migration', () => {
  it('creates poly_resolutions with expected columns + indexes', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-bt-mig-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const cols = db.prepare(`PRAGMA table_info(poly_resolutions)`).all() as Array<{ name: string; pk: number }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['slug', 'closed', 'outcomes_json', 'fetched_at', 'resolved_at']));
    expect(cols.find(c => c.name === 'slug')!.pk).toBe(1);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='poly_resolutions'`).all() as Array<{ name: string }>;
    const idxNames = idx.map(i => i.name);
    expect(idxNames).toContain('idx_poly_resolutions_closed');
    expect(idxNames).toContain('idx_poly_resolutions_fetched');
    db.close();
    fs.unlinkSync(tmp);
  });

  it('is idempotent', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-bt-mig-idem-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='poly_resolutions'`).get() as { n: number }).n;
    expect(n).toBe(1);
    db.close();
    fs.unlinkSync(tmp);
  });

  it('PRIMARY KEY slug enforces one row per market', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-bt-mig-pk-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    const db = new Database(tmp);
    db.prepare(`INSERT INTO poly_resolutions (slug,closed,outcomes_json,fetched_at) VALUES (?,?,?,?)`).run('a', 0, '[]', 100);
    expect(() =>
      db.prepare(`INSERT INTO poly_resolutions (slug,closed,outcomes_json,fetched_at) VALUES (?,?,?,?)`).run('a', 1, '[]', 200),
    ).toThrow(/PRIMARY KEY|UNIQUE/);
    db.close();
    fs.unlinkSync(tmp);
  });
});
