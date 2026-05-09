import { describe, expect, it } from 'vitest';

import {
  claudeLookupCommand,
  pm2ServiceDescribeCommands,
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
});
