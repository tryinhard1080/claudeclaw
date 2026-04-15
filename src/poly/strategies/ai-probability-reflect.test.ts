import { describe, it, expect } from 'vitest';
import {
  applyReflectionRule,
  composeCriticUser,
  parseCriticResponse,
  REFLECT_PROMPT_VERSION,
} from './ai-probability-reflect.js';
import type { ProbabilityEstimate } from '../types.js';

function mkInitial(overrides: Partial<ProbabilityEstimate> = {}): ProbabilityEstimate {
  return {
    probability: 0.62,
    confidence: 'high',
    reasoning: 'Strong evidence X supports YES; Y is priced in.',
    contrarian: 'Market might know something we do not.',
    ...overrides,
  };
}

describe('REFLECT_PROMPT_VERSION', () => {
  it('tags as v3-reflect', () => {
    expect(REFLECT_PROMPT_VERSION).toBe('v3-reflect');
  });
});

describe('composeCriticUser', () => {
  it('includes question, ask, and primary probability', () => {
    const s = composeCriticUser({
      question: 'Will X happen?',
      category: 'politics',
      endDateSec: 1_700_000_000,
      ask: 0.41,
      initial: mkInitial({ probability: 0.62 }),
    });
    expect(s).toContain('Will X happen?');
    expect(s).toContain('0.410');
    expect(s).toContain('0.620');
    expect(s).toContain('high');
  });

  it('shows (none) when contrarian is missing', () => {
    const s = composeCriticUser({
      question: 'Q', category: null, endDateSec: 0, ask: 0.5,
      initial: mkInitial({ contrarian: undefined }),
    });
    expect(s).toContain('(none)');
  });
});

describe('parseCriticResponse', () => {
  it('parses a well-formed confirm judgment', () => {
    const raw = JSON.stringify({
      verdict: 'confirm', revisedProbability: 0.62,
      revisedConfidence: 'high', rationale: 'consistent',
    });
    const out = parseCriticResponse(raw);
    expect(out?.verdict).toBe('confirm');
    expect(out?.revisedProbability).toBe(0.62);
  });

  it('parses JSON wrapped in markdown fences', () => {
    const raw = '```json\n{"verdict":"revise","revisedProbability":0.55,"revisedConfidence":"medium","rationale":"tighter"}\n```';
    const out = parseCriticResponse(raw);
    expect(out?.verdict).toBe('revise');
    expect(out?.revisedProbability).toBe(0.55);
  });

  it('rejects probability out of range', () => {
    const raw = JSON.stringify({
      verdict: 'revise', revisedProbability: 1.5,
      revisedConfidence: 'low', rationale: 'x',
    });
    expect(parseCriticResponse(raw)).toBeNull();
  });

  it('rejects unknown verdict', () => {
    const raw = JSON.stringify({
      verdict: 'maybe', revisedProbability: 0.5,
      revisedConfidence: 'low', rationale: 'x',
    });
    expect(parseCriticResponse(raw)).toBeNull();
  });

  it('returns null on junk', () => {
    expect(parseCriticResponse('not json')).toBeNull();
  });

  it('tolerates missing rationale as empty string', () => {
    const raw = JSON.stringify({
      verdict: 'confirm', revisedProbability: 0.3, revisedConfidence: 'low',
    });
    const out = parseCriticResponse(raw);
    expect(out?.rationale).toBe('');
  });
});

describe('applyReflectionRule', () => {
  const ask = 0.40;

  it('confirm: passes through unchanged', () => {
    const initial = mkInitial({ probability: 0.62, confidence: 'high' });
    const out = applyReflectionRule(
      initial,
      { verdict: 'confirm', revisedProbability: 0.62, revisedConfidence: 'high', rationale: 'ok' },
      ask,
    );
    expect(out).toEqual(initial);
  });

  it('revise: uses critic probability + confidence, appends rationale tag', () => {
    const initial = mkInitial({ probability: 0.62, confidence: 'high' });
    const out = applyReflectionRule(
      initial,
      { verdict: 'revise', revisedProbability: 0.55, revisedConfidence: 'medium', rationale: 'tighter' },
      ask,
    );
    expect(out.probability).toBe(0.55);
    expect(out.confidence).toBe('medium');
    expect(out.reasoning).toContain('critic-revise');
    expect(out.reasoning).toContain('tighter');
    expect(out.contrarian).toBe(initial.contrarian);
  });

  it('contradiction: pulls probability to midpoint and forces low confidence', () => {
    const initial = mkInitial({ probability: 0.62, confidence: 'high' });
    const out = applyReflectionRule(
      initial,
      { verdict: 'contradiction', revisedProbability: 0.62, revisedConfidence: 'high', rationale: 'reasoning hedges' },
      ask,
    );
    // midpoint(0.62, 0.40) = 0.51
    expect(out.probability).toBeCloseTo(0.51, 3);
    expect(out.confidence).toBe('low');
    expect(out.reasoning).toContain('critic-contradiction');
  });

  it('contradiction from below-market: midpoint still between initial and ask', () => {
    const initial = mkInitial({ probability: 0.20, confidence: 'medium' });
    const out = applyReflectionRule(
      initial,
      { verdict: 'contradiction', revisedProbability: 0.20, revisedConfidence: 'medium', rationale: 'x' },
      0.40,
    );
    // midpoint(0.20, 0.40) = 0.30
    expect(out.probability).toBeCloseTo(0.30, 3);
    expect(out.confidence).toBe('low');
  });
});
