import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type Database from 'better-sqlite3';

export interface BackupEntry {
  name: string;       // "backup-2026-04-21"
  date: string;       // "2026-04-21"
  fullPath: string;
  ageDays: number;
}

export interface RotationResult {
  keep: BackupEntry[];
  delete: BackupEntry[];
}

const BACKUP_DIR_RE = /^backup-(\d{4}-\d{2}-\d{2})$/;
const BACKUP_HEARTBEAT_KEY = 'backup.last_success_at';

const DAILY_RETENTION = 7;     // last 7 days
const WEEKLY_RETENTION = 4;    // last 4 Sundays
const MONTHLY_RETENTION = 3;   // last 3 first-of-months

/** Parse "backup-YYYY-MM-DD" → Date at UTC midnight, or null. */
export function parseBackupDate(name: string): Date | null {
  const m = name.match(BACKUP_DIR_RE);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

/** UTC day-difference between two dates (todayUtc - backupUtc), rounded down. */
function diffDays(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / 86400_000);
}

/**
 * Rotation policy: keep
 *   - last 7 daily (within 7 days)
 *   - last 4 weekly (most-recent backup on or before each of the last 4 Sundays)
 *   - last 3 monthly (most-recent backup on or before the 1st of each of the last 3 months)
 *
 * The "most-recent on or before" rule means we don't require an EXACT
 * Sunday/1st backup — if the cron didn't fire that day, we keep the
 * latest before it. This way a missed-day doesn't cascade-delete the
 * weekly/monthly anchor.
 *
 * Pure function: takes a list of backup entries + today's date, returns
 * the partition. No filesystem access.
 */
export function pruneRotation(existing: BackupEntry[], today: Date): RotationResult {
  if (existing.length === 0) return { keep: [], delete: [] };

  // Annotate with computed ages relative to `today`.
  const annotated = existing
    .map((e) => ({ ...e, _date: parseBackupDate(e.name)! }))
    .filter((e) => e._date !== null)
    .sort((a, b) => b._date.getTime() - a._date.getTime()); // newest first

  const keepIds = new Set<string>();

  // Daily: last 7 calendar days (age 0..6)
  for (const e of annotated) {
    if (diffDays(today, e._date) <= DAILY_RETENTION - 1) {
      keepIds.add(e.name);
    }
  }

  // Weekly: most-recent backup on or before each of the last 4 Sundays
  // (today's most-recent prior Sunday + 3 more weeks back)
  const todayDayOfWeek = today.getUTCDay(); // 0 = Sunday
  for (let w = 0; w < WEEKLY_RETENTION; w++) {
    const sundayOffset = todayDayOfWeek + w * 7;
    const sundayUtc = new Date(today.getTime() - sundayOffset * 86400_000);
    // Find latest backup on or before this Sunday
    const anchor = annotated.find((e) => e._date.getTime() <= sundayUtc.getTime());
    if (anchor) keepIds.add(anchor.name);
  }

  // Monthly: most-recent backup on or before the 1st of each of the last
  // 3 months (current month's 1st, prev month's 1st, prev-prev month's 1st)
  for (let m = 0; m < MONTHLY_RETENTION; m++) {
    const firstUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 1));
    const anchor = annotated.find((e) => e._date.getTime() <= firstUtc.getTime());
    if (anchor) keepIds.add(anchor.name);
  }

  const keep = annotated.filter((e) => keepIds.has(e.name)).map((e) => stripDate(e));
  const del = annotated.filter((e) => !keepIds.has(e.name)).map((e) => stripDate(e));
  return { keep, delete: del };
}

function stripDate(e: BackupEntry & { _date: Date }): BackupEntry {
  // Strip the helper field so we don't leak it externally
  const { _date, ...rest } = e;
  void _date;
  return rest;
}

/** Scan filesystem for backup-YYYY-MM-DD/ dirs under rootPath. */
export function getBackupDirs(rootPath: string, today: Date = new Date()): BackupEntry[] {
  if (!fs.existsSync(rootPath)) return [];
  const entries: BackupEntry[] = [];
  for (const name of fs.readdirSync(rootPath)) {
    const date = parseBackupDate(name);
    if (!date) continue;
    const fullPath = path.join(rootPath, name);
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) continue;
    entries.push({
      name,
      date: name.replace(/^backup-/, ''),
      fullPath,
      ageDays: diffDays(today, date),
    });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

/** Compute sha256 hex of a file (sync for small DB files). */
export function sha256OfFile(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export interface RunBackupResult {
  ok: boolean;
  reason?: string;
  backupDir?: string;
  backupBytes?: number;
  sha256?: string;
  pruned?: BackupEntry[];
  durationMs?: number;
}

/**
 * Full backup procedure: run SQLite Online Backup, compute checksum,
 * write SHA256 file, apply rotation, write heartbeat. Idempotent for
 * the same day — if today's backup already exists, returns ok with a
 * skip reason and still updates heartbeat (so monitoring sees the
 * cron fired).
 */
export async function runBackup(
  db: Database.Database,
  args: {
    storeDir: string;
    nowSec?: number;
    nowDate?: Date;
  },
): Promise<RunBackupResult> {
  const startMs = Date.now();
  const today = args.nowDate ?? new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const backupDir = path.join(args.storeDir, `backup-${dateStr}`);
  const backupDbPath = path.join(backupDir, 'claudeclaw.db');
  const shaPath = path.join(backupDir, 'SHA256');

  if (fs.existsSync(backupDbPath)) {
    writeBackupHeartbeat(db, args.nowSec);
    return {
      ok: true, reason: 'today already backed up',
      backupDir, backupBytes: fs.statSync(backupDbPath).size,
      durationMs: Date.now() - startMs,
    };
  }

  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  try {
    await db.backup(backupDbPath);
  } catch (err) {
    return { ok: false, reason: `db.backup failed: ${String(err).slice(0, 300)}`, durationMs: Date.now() - startMs };
  }

  const backupBytes = fs.statSync(backupDbPath).size;
  const hash = sha256OfFile(backupDbPath);
  fs.writeFileSync(shaPath, `${hash}  claudeclaw.db\n`);

  // Rotation
  const all = getBackupDirs(args.storeDir, today);
  const rotation = pruneRotation(all, today);
  for (const entry of rotation.delete) {
    try { fs.rmSync(entry.fullPath, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  writeBackupHeartbeat(db, args.nowSec);
  return {
    ok: true, backupDir, backupBytes, sha256: hash,
    pruned: rotation.delete, durationMs: Date.now() - startMs,
  };
}

export function writeBackupHeartbeat(db: Database.Database, nowSec?: number): void {
  const ts = String(nowSec ?? Math.floor(Date.now() / 1000));
  db.prepare(
    `INSERT INTO poly_kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(BACKUP_HEARTBEAT_KEY, ts);
}

export function readBackupHeartbeat(db: Database.Database): number | null {
  const row = db.prepare(`SELECT value FROM poly_kv WHERE key = ?`).get(BACKUP_HEARTBEAT_KEY) as
    | { value: string } | undefined;
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}
