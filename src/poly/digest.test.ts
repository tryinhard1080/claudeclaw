import { describe, it, expect } from 'vitest';
import { shouldRunDigest } from './digest.js';

describe('shouldRunDigest', () => {
  it('returns true when current hour matches and not yet run today', () => {
    expect(
      shouldRunDigest({
        hour: 6,
        timezone: 'UTC',
        now: new Date('2026-04-12T06:30:00Z'),
        lastRunYmd: '2026-04-11',
      }),
    ).toBe(true);
  });

  it('returns false if already run today', () => {
    expect(
      shouldRunDigest({
        hour: 6,
        timezone: 'UTC',
        now: new Date('2026-04-12T06:30:00Z'),
        lastRunYmd: '2026-04-12',
      }),
    ).toBe(false);
  });

  it('returns false before the configured hour', () => {
    expect(
      shouldRunDigest({
        hour: 6,
        timezone: 'UTC',
        now: new Date('2026-04-12T05:30:00Z'),
        lastRunYmd: '2026-04-11',
      }),
    ).toBe(false);
  });

  it('returns false after midnight rollover when digest already ran for the target-tz day', () => {
    // Digest hour is 23 local (America/New_York). "now" is 2026-04-13T03:30Z =
    // 2026-04-12T23:30 America/New_York. lastRunYmd is already '2026-04-12' in
    // that tz, so the ymd-gate must short-circuit to false (no double-fire).
    expect(
      shouldRunDigest({
        hour: 23,
        timezone: 'America/New_York',
        now: new Date('2026-04-13T03:30:00Z'),
        lastRunYmd: '2026-04-12',
      }),
    ).toBe(false);
  });
});
