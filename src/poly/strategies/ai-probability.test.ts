import { describe, it, expect } from 'vitest';
import { computeCacheKey, computeEdgePct, extractJson } from './ai-probability.js';

describe('ai-probability helpers', () => {
  describe('computeEdgePct', () => {
    it('computes edge in percentage points', () => {
      expect(computeEdgePct(0.58, 0.42)).toBeCloseTo(16, 5);
    });
  });

  describe('computeCacheKey', () => {
    const base = {
      ask: 0.5, volume: 10000, spreadPct: 2, askDepthUsd: 500,
      question: 'Will X happen by Y?', category: 'politics',
      endDateSec: 1_700_000_000,
    };

    it('is stable for inputs that round to the same quantization bucket', () => {
      const k1 = computeCacheKey('slug', 'tok', { ...base, ask: 0.421, volume: 12300 });
      const k2 = computeCacheKey('slug', 'tok', { ...base, ask: 0.419, volume: 12400 });
      expect(k1).toBe(k2);
    });

    it('differs when token_id changes (cache is per-token)', () => {
      const k1 = computeCacheKey('slug', 'tokA', base);
      const k2 = computeCacheKey('slug', 'tokB', base);
      expect(k1).not.toBe(k2);
    });

    it('differs when ask rounds to a different 1% bucket', () => {
      const k1 = computeCacheKey('slug', 'tok', { ...base, ask: 0.42 });
      const k2 = computeCacheKey('slug', 'tok', { ...base, ask: 0.43 });
      expect(k1).not.toBe(k2);
    });

    it('differs when spread changes materially (no stale cache on wider book)', () => {
      const k1 = computeCacheKey('slug', 'tok', { ...base, spreadPct: 2 });
      const k2 = computeCacheKey('slug', 'tok', { ...base, spreadPct: 8 });
      expect(k1).not.toBe(k2);
    });

    it('differs when ask depth changes materially', () => {
      const k1 = computeCacheKey('slug', 'tok', { ...base, askDepthUsd: 500 });
      const k2 = computeCacheKey('slug', 'tok', { ...base, askDepthUsd: 5000 });
      expect(k1).not.toBe(k2);
    });

    it('treats null spread distinctly from 0% spread', () => {
      const k1 = computeCacheKey('slug', 'tok', { ...base, spreadPct: null });
      const k2 = computeCacheKey('slug', 'tok', { ...base, spreadPct: 0 });
      expect(k1).not.toBe(k2);
    });

    it('differs when the market question is reworded (reused slug, new prompt)', () => {
      const k1 = computeCacheKey('slug', 'tok', { ...base, question: 'Will X happen?' });
      const k2 = computeCacheKey('slug', 'tok', { ...base, question: 'Will X happen by 2027?' });
      expect(k1).not.toBe(k2);
    });

    it('differs when the market category changes', () => {
      const k1 = computeCacheKey('slug', 'tok', { ...base, category: 'politics' });
      const k2 = computeCacheKey('slug', 'tok', { ...base, category: 'sports' });
      expect(k1).not.toBe(k2);
    });

    it('differs when endDate moves to a new day bucket', () => {
      const k1 = computeCacheKey('slug', 'tok', { ...base, endDateSec: 1_700_000_000 });
      const k2 = computeCacheKey('slug', 'tok', { ...base, endDateSec: 1_700_000_000 + 2 * 86400 });
      expect(k1).not.toBe(k2);
    });
  });

  describe('extractJson', () => {
    it('extracts from a ```json fenced block', () => {
      const text = 'prose\n```json\n{"probability": 0.42, "confidence": "high"}\n```\nmore prose';
      expect(extractJson(text)).toBe('{"probability": 0.42, "confidence": "high"}');
    });

    it('extracts from a plain ``` fenced block', () => {
      const text = '```\n{"probability": 0.42}\n```';
      expect(extractJson(text)).toBe('{"probability": 0.42}');
    });

    it('extracts a bare {...} object from mixed prose', () => {
      const text = 'Here is my answer: {"probability": 0.42, "confidence": "low"} — hope that helps!';
      const out = extractJson(text);
      expect(JSON.parse(out)).toEqual({ probability: 0.42, confidence: 'low' });
    });

    it('preserves nested objects inside a fenced block (greedy match)', () => {
      const text = '```json\n{"probability": 0.5, "meta": {"nested": {"deep": true}}}\n```';
      const out = extractJson(text);
      // The critical bug: a lazy regex would stop at the first `}` after `"deep": true`
      // and return a truncated object. Greedy match preserves the full structure.
      expect(() => JSON.parse(out)).not.toThrow();
      const parsed = JSON.parse(out) as { meta: { nested: { deep: boolean } } };
      expect(parsed.meta.nested.deep).toBe(true);
    });

    it('returns raw text unchanged when no JSON is found', () => {
      const text = 'Sorry, I cannot answer that question.';
      expect(extractJson(text)).toBe(text);
    });
  });
});
