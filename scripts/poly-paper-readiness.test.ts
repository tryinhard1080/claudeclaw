import { describe, expect, it } from 'vitest';

import {
  classifyAdvancedPaperFlag,
  classifyHaltFlag,
  classifyOpenPaperPositions,
  classifyRecentScanHealth,
} from './poly-paper-readiness.js';

const NOW_SEC = 1_800_000_000;

describe('classifyRecentScanHealth', () => {
  it('passes when the latest successful scan is inside twice the scan interval', () => {
    const result = classifyRecentScanHealth(
      [{ started_at: NOW_SEC - 6 * 60, duration_ms: 900, market_count: 863, status: 'ok', error: null }],
      NOW_SEC,
      5,
    );

    expect(result.status).toBe('pass');
    expect(result.state).toBe('fresh');
  });
});

describe('classifyOpenPaperPositions', () => {
  it('passes when paper positions are open', () => {
    const result = classifyOpenPaperPositions(2);

    expect(result.status).toBe('pass');
    expect(result.state).toBe('positions_open');
  });
});

describe('classifyHaltFlag', () => {
  it('fails readiness when the halt flag is on', () => {
    const result = classifyHaltFlag('1');

    expect(result.status).toBe('fail');
    expect(result.state).toBe('halted');
  });

  it('passes when the halt flag is clear or absent', () => {
    const result = classifyHaltFlag(null);

    expect(result.status).toBe('pass');
    expect(result.state).toBe('clear');
  });
});

describe('classifyAdvancedPaperFlag', () => {
  it('passes baseline readiness when a gated advanced feature is disabled', () => {
    const result = classifyAdvancedPaperFlag('POLY_EXIT_ENABLED', false);

    expect(result.status).toBe('pass');
    expect(result.state).toBe('disabled');
  });

  it('warns when a gated advanced feature is enabled before acceptance gates are met', () => {
    const result = classifyAdvancedPaperFlag('POLY_EXPOSURE_AWARE_SIZING', true);

    expect(result.status).toBe('warn');
    expect(result.state).toBe('enabled');
  });
});
