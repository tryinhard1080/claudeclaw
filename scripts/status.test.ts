import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  claudeLookupCommand,
  pm2ServiceDescribeCommands,
  resolveStoreDir,
} from './status.js';

describe('status script platform commands', () => {
  it('uses where to find Claude CLI on Windows', () => {
    expect(claudeLookupCommand('win32')).toBe('where claude');
  });

  it('checks the PM2 ecosystem app name before the legacy service name', () => {
    expect(pm2ServiceDescribeCommands()).toEqual([
      'pm2 describe claudeclaw-main',
      'pm2 describe claudeclaw',
    ]);
  });

  it('uses configured STORE_DIR for the memory DB when present', () => {
    const configured = path.resolve('tmp', 'configured-store');
    expect(resolveStoreDir(path.resolve('tmp', 'repo'), configured)).toBe(configured);
  });

  it('falls back to repo-local store when STORE_DIR is not configured', () => {
    const projectRoot = path.resolve('tmp', 'repo');
    expect(resolveStoreDir(projectRoot)).toBe(path.join(projectRoot, 'store'));
  });
});
