import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  compareSnapshot,
  unifiedDiff,
  buildAiProbSnapshotBody,
  runCheck,
} from './check-prompt-drift.js';

describe('compareSnapshot', () => {
  it('reports no drift when expected matches actual', () => {
    const r = compareSnapshot('news', 'hello', 'hello');
    expect(r.drifted).toBe(false);
    expect(r.snapshotMissing).toBe(false);
  });

  it('reports drift when contents differ', () => {
    const r = compareSnapshot('news', 'old', 'new');
    expect(r.drifted).toBe(true);
    expect(r.snapshotMissing).toBe(false);
    expect(r.reason).toContain('runtime differs');
  });

  it('reports drift with snapshotMissing=true when expected is null', () => {
    const r = compareSnapshot('news', null, 'anything');
    expect(r.drifted).toBe(true);
    expect(r.snapshotMissing).toBe(true);
    expect(r.reason).toContain('--update');
  });
});

describe('unifiedDiff', () => {
  it('returns empty string for identical inputs', () => {
    expect(unifiedDiff('a\nb\nc', 'a\nb\nc')).toBe('');
  });

  it('marks removed and added lines with - and +', () => {
    const out = unifiedDiff('a\nb\nc', 'a\nB\nc');
    expect(out).toContain('- b');
    expect(out).toContain('+ B');
    expect(out).not.toContain('a');
  });

  it('handles different lengths', () => {
    const out = unifiedDiff('a\nb', 'a\nb\nc');
    expect(out).toContain('+ c');
  });
});

describe('buildAiProbSnapshotBody', () => {
  it('formats as two-line key=value with trailing newline', () => {
    expect(buildAiProbSnapshotBody('v3', 'abc123')).toBe('version=v3\nhash=abc123\n');
  });
});

describe('runCheck', () => {
  function withTmpDir<T>(fn: (dir: string) => T): T {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-prompt-drift-'));
    try {
      return fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('seeds snapshots in --update mode and reports zero drift afterward', () => {
    withTmpDir(dir => {
      const updateResult = runCheck({ update: true, snapDir: dir });
      expect(updateResult.exitCode).toBe(0);
      // Snapshot files should now exist.
      expect(fs.existsSync(path.join(dir, 'news-sync.txt'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'ai-probability.hash'))).toBe(true);

      // Re-running without --update should be clean.
      const checkResult = runCheck({ update: false, snapDir: dir });
      expect(checkResult.exitCode).toBe(0);
      expect(checkResult.reports.every(r => !r.drifted)).toBe(true);
    });
  });

  it('exit-codes 1 with snapshotMissing reports when snapshot dir is empty', () => {
    withTmpDir(dir => {
      const result = runCheck({ update: false, snapDir: dir });
      expect(result.exitCode).toBe(1);
      expect(result.reports).toHaveLength(2);
      expect(result.reports.every(r => r.drifted && r.snapshotMissing)).toBe(true);
    });
  });

  it('detects drift when a snapshot is stale', () => {
    withTmpDir(dir => {
      // Seed first to generate valid snapshots, then corrupt one.
      runCheck({ update: true, snapDir: dir });
      fs.writeFileSync(path.join(dir, 'news-sync.txt'), 'STALE PROMPT', 'utf8');

      const result = runCheck({ update: false, snapDir: dir });
      expect(result.exitCode).toBe(1);
      const news = result.reports.find(r => r.name === 'news-sync');
      expect(news?.drifted).toBe(true);
      expect(news?.snapshotMissing).toBe(false);
    });
  });
});
