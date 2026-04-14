import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { runAt } from '../../migrations/v1.6.0/v1.6.0-research-ingest.js';

describe('v1.6.0 research-ingest migration', () => {
  it('creates research_items with expected columns + indexes', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-ri-mig-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const cols = db.prepare(`PRAGMA table_info(research_items)`).all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'source', 'url', 'title', 'published_at', 'fetched_at', 'tier', 'notebook', 'snippet', 'upload_status',
    ]));
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='research_items'`).all() as Array<{ name: string }>;
    const idxNames = idx.map(i => i.name);
    expect(idxNames).toContain('idx_research_items_fetched');
    expect(idxNames).toContain('idx_research_items_source');
    expect(idxNames).toContain('idx_research_items_upload');
    db.close();
    fs.unlinkSync(tmp);
  });

  it('enforces UNIQUE constraint on url', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-ri-mig-uniq-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    const db = new Database(tmp);
    db.prepare(`INSERT INTO research_items (source,url,title,fetched_at,tier) VALUES (?,?,?,?,?)`).run('aqr','https://x/1','T',100,1);
    expect(() => db.prepare(`INSERT INTO research_items (source,url,title,fetched_at,tier) VALUES (?,?,?,?,?)`).run('aqr','https://x/1','T2',200,1)).toThrow(/UNIQUE/);
    db.close();
    fs.unlinkSync(tmp);
  });

  it('is idempotent', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-ri-mig-idem-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const tabs = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='research_items'`).get() as { n: number };
    expect(tabs.n).toBe(1);
    db.close();
    fs.unlinkSync(tmp);
  });
});
