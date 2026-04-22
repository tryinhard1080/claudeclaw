import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
  parseBackupDate, pruneRotation, getBackupDirs,
  runBackup, writeBackupHeartbeat, readBackupHeartbeat,
  type BackupEntry,
} from './db-backup.js';

function entry(name: string): BackupEntry {
  return { name, date: name.replace(/^backup-/, ''), fullPath: '/tmp/' + name, ageDays: 0 };
}

describe('parseBackupDate', () => {
  it('parses well-formed dir name', () => {
    const d = parseBackupDate('backup-2026-04-21');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-04-21T00:00:00.000Z');
  });
  it('returns null on non-backup dir', () => {
    expect(parseBackupDate('not-a-backup')).toBeNull();
    expect(parseBackupDate('backup-2026-04')).toBeNull();
    expect(parseBackupDate('backup-bad-date')).toBeNull();
  });
});

describe('pruneRotation', () => {
  const today = new Date('2026-04-21T12:00:00Z'); // Tuesday

  it('returns empty result on empty input', () => {
    const r = pruneRotation([], today);
    expect(r.keep).toEqual([]);
    expect(r.delete).toEqual([]);
  });

  it('keeps last 7 daily backups', () => {
    const dirs = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
      dirs.push(entry(`backup-${d}`));
    }
    const r = pruneRotation(dirs, today);
    // Daily window keeps age 0..6 (7 days). Older may still be kept by weekly/monthly anchors.
    const keepNames = new Set(r.keep.map((e) => e.name));
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
      expect(keepNames.has(`backup-${d}`)).toBe(true);
    }
  });

  it('keeps weekly anchors (most-recent backup on or before each of last 4 Sundays)', () => {
    // Today = Tuesday 2026-04-21. Most recent Sunday = 2026-04-19.
    // Last 4 Sundays: 04-19, 04-12, 04-05, 03-29
    const dirs = [
      entry('backup-2026-04-19'), // Sunday
      entry('backup-2026-04-12'), // Sunday
      entry('backup-2026-04-05'), // Sunday
      entry('backup-2026-03-29'), // Sunday
      entry('backup-2026-03-22'), // Sunday — should be pruned (>4 weeks back)
    ];
    const r = pruneRotation(dirs, today);
    const keepNames = new Set(r.keep.map((e) => e.name));
    expect(keepNames.has('backup-2026-04-19')).toBe(true);
    expect(keepNames.has('backup-2026-04-12')).toBe(true);
    expect(keepNames.has('backup-2026-04-05')).toBe(true);
    expect(keepNames.has('backup-2026-03-29')).toBe(true);
    expect(keepNames.has('backup-2026-03-22')).toBe(false);
  });

  it('weekly anchor uses "most recent on or before" Sunday when exact Sunday is missing', () => {
    // No Sunday backups exist — the anchor should be the latest before each Sunday
    const dirs = [
      entry('backup-2026-04-18'), // Sat (anchor for 04-19)
      entry('backup-2026-04-10'), // Fri (anchor for 04-12)
    ];
    const r = pruneRotation(dirs, today);
    const keepNames = new Set(r.keep.map((e) => e.name));
    expect(keepNames.has('backup-2026-04-18')).toBe(true);
    expect(keepNames.has('backup-2026-04-10')).toBe(true);
  });

  it('keeps monthly anchors (last 3 month-1st backups)', () => {
    // Today = 2026-04-21. Last 3 month-1sts: 2026-04-01, 2026-03-01, 2026-02-01
    const dirs = [
      entry('backup-2026-04-01'),
      entry('backup-2026-03-01'),
      entry('backup-2026-02-01'),
      entry('backup-2026-01-01'), // should be pruned (>3 months back)
    ];
    const r = pruneRotation(dirs, today);
    const keepNames = new Set(r.keep.map((e) => e.name));
    expect(keepNames.has('backup-2026-04-01')).toBe(true);
    expect(keepNames.has('backup-2026-03-01')).toBe(true);
    expect(keepNames.has('backup-2026-02-01')).toBe(true);
    expect(keepNames.has('backup-2026-01-01')).toBe(false);
  });

  it('prunes random middle-aged backups when better anchors exist', () => {
    // With dense weekly/monthly anchors present, a non-anchor middle backup is pruned.
    const dirs = [
      entry('backup-2026-04-21'), // today (daily)
      entry('backup-2026-04-19'), // Sunday weekly anchor
      entry('backup-2026-04-12'), // Sunday weekly anchor
      entry('backup-2026-04-05'), // Sunday weekly anchor
      entry('backup-2026-04-01'), // monthly anchor (April 1)
      entry('backup-2026-03-29'), // Sunday weekly anchor
      entry('backup-2026-03-15'), // middle-aged Sunday but already past 4-Sunday window AND not a month-1st
      entry('backup-2026-03-01'), // monthly anchor (March 1)
      entry('backup-2026-02-01'), // monthly anchor (February 1)
    ];
    const r = pruneRotation(dirs, today);
    const keepNames = new Set(r.keep.map((e) => e.name));
    expect(keepNames.has('backup-2026-04-21')).toBe(true);
    expect(keepNames.has('backup-2026-03-15')).toBe(false); // pruned: not in daily/weekly/monthly anchor sets
  });

  it('keep + delete partition is exhaustive and disjoint', () => {
    const dirs = [];
    for (let i = 0; i < 100; i++) {
      const d = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
      dirs.push(entry(`backup-${d}`));
    }
    const r = pruneRotation(dirs, today);
    expect(r.keep.length + r.delete.length).toBe(dirs.length);
    const keepNames = new Set(r.keep.map((e) => e.name));
    const delNames = new Set(r.delete.map((e) => e.name));
    for (const n of keepNames) expect(delNames.has(n)).toBe(false);
  });

  it('skips entries with malformed names defensively', () => {
    const dirs = [
      entry('backup-2026-04-21'),
      entry('backup-not-a-date'),
      entry('not-a-backup-dir'),
    ];
    const r = pruneRotation(dirs, today);
    expect(r.keep.some((e) => e.name === 'backup-not-a-date')).toBe(false);
    expect(r.delete.some((e) => e.name === 'backup-not-a-date')).toBe(false);
  });
});

describe('getBackupDirs (filesystem)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-backup-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns empty when root does not exist', () => {
    expect(getBackupDirs(path.join(tmpRoot, 'no-such-dir'))).toEqual([]);
  });

  it('discovers backup-YYYY-MM-DD subdirs only', () => {
    fs.mkdirSync(path.join(tmpRoot, 'backup-2026-04-21'));
    fs.mkdirSync(path.join(tmpRoot, 'backup-2026-04-20'));
    fs.mkdirSync(path.join(tmpRoot, 'unrelated'));
    fs.writeFileSync(path.join(tmpRoot, 'backup-2026-04-19'), 'not a dir');
    const dirs = getBackupDirs(tmpRoot, new Date('2026-04-21T00:00:00Z'));
    expect(dirs.map((d) => d.name).sort()).toEqual(['backup-2026-04-20', 'backup-2026-04-21']);
  });

  it('computes ageDays correctly', () => {
    fs.mkdirSync(path.join(tmpRoot, 'backup-2026-04-21'));
    fs.mkdirSync(path.join(tmpRoot, 'backup-2026-04-15'));
    const dirs = getBackupDirs(tmpRoot, new Date('2026-04-21T12:00:00Z'));
    const today = dirs.find((d) => d.name === 'backup-2026-04-21')!;
    const old = dirs.find((d) => d.name === 'backup-2026-04-15')!;
    expect(today.ageDays).toBe(0);
    expect(old.ageDays).toBe(6);
  });
});

describe('writeBackupHeartbeat / readBackupHeartbeat', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  });
  afterEach(() => { db.close(); });

  it('round-trip', () => {
    writeBackupHeartbeat(db, 999000);
    expect(readBackupHeartbeat(db)).toBe(999000);
  });

  it('null when not set', () => {
    expect(readBackupHeartbeat(db)).toBeNull();
  });
});

describe('runBackup (integration)', () => {
  let tmpStore: string;
  let db: Database.Database;
  beforeEach(() => {
    tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-backup-int-'));
    db = new Database(path.join(tmpStore, 'claudeclaw.db'));
    db.exec(`
      CREATE TABLE poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE sample (id INTEGER PRIMARY KEY, msg TEXT);
      INSERT INTO sample (msg) VALUES ('hello'), ('world');
    `);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(tmpStore, { recursive: true, force: true });
  });

  it('produces backup-YYYY-MM-DD/claudeclaw.db with SHA256 + heartbeat', async () => {
    const r = await runBackup(db, { storeDir: tmpStore, nowSec: 1_500_000, nowDate: new Date('2026-04-21T12:00:00Z') });
    expect(r.ok).toBe(true);
    expect(r.backupDir).toContain('backup-2026-04-21');
    expect(r.backupBytes).toBeGreaterThan(0);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    const shaPath = path.join(r.backupDir!, 'SHA256');
    expect(fs.existsSync(shaPath)).toBe(true);
    expect(fs.readFileSync(shaPath, 'utf8')).toContain(r.sha256!);
    expect(readBackupHeartbeat(db)).toBe(1_500_000);
  });

  it('idempotent: second call same day skips with heartbeat update', async () => {
    await runBackup(db, { storeDir: tmpStore, nowSec: 1_000_000, nowDate: new Date('2026-04-21T12:00:00Z') });
    const r = await runBackup(db, { storeDir: tmpStore, nowSec: 1_000_999, nowDate: new Date('2026-04-21T12:00:00Z') });
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/already backed up/);
    expect(readBackupHeartbeat(db)).toBe(1_000_999); // heartbeat advances
  });

  it('backup file is a valid SQLite DB readable via better-sqlite3', async () => {
    const r = await runBackup(db, { storeDir: tmpStore, nowDate: new Date('2026-04-21T12:00:00Z') });
    expect(r.ok).toBe(true);
    const restored = new Database(path.join(r.backupDir!, 'claudeclaw.db'), { readonly: true });
    try {
      const rows = restored.prepare(`SELECT msg FROM sample ORDER BY id`).all() as Array<{ msg: string }>;
      expect(rows.map((r) => r.msg)).toEqual(['hello', 'world']);
    } finally {
      restored.close();
    }
  });

  it('rotation deletes old non-anchored backups but keeps daily window', async () => {
    // Pre-seed 10 days of backup dirs (only need them present, content empty)
    for (let i = 1; i <= 10; i++) {
      const d = new Date(Date.UTC(2026, 3, 21 - i)).toISOString().slice(0, 10);
      fs.mkdirSync(path.join(tmpStore, `backup-${d}`));
      fs.writeFileSync(path.join(tmpStore, `backup-${d}`, 'claudeclaw.db'), 'x');
    }
    const r = await runBackup(db, { storeDir: tmpStore, nowDate: new Date('2026-04-21T12:00:00Z') });
    expect(r.ok).toBe(true);
    // Today's backup must remain
    expect(fs.existsSync(path.join(tmpStore, 'backup-2026-04-21'))).toBe(true);
    // 10 days ago (2026-04-11) is non-anchored (not Sun, not 1st, age > 6) and should be pruned
    expect(fs.existsSync(path.join(tmpStore, 'backup-2026-04-11'))).toBe(false);
  });
});
