import { describe, it, expect } from 'vitest';
import { computeCacheKey, computeEdgePct, extractJson } from './ai-probability.js';

describe('ai-probability helpers', () => {
  describe('computeEdgePct', () => {
    it('computes edge in percentage points', () => {
      expect(computeEdgePct(0.58, 0.42)).toBeCloseTo(16, 5);
    });
  });

  describe('computeCacheKey', () => {
    it('is stable for inputs that round to the same quantization bucket', () => {
      // ask: 0.421 → 42, 0.419 → 42 (both round to 42% bucket)
      // volume: 12300 → 12, 12400 → 12 (both round to $12k bucket)
      const k1 = computeCacheKey('slug', 'tok', { ask: 0.421, volume: 12300 });
      const k2 = computeCacheKey('slug', 'tok', { ask: 0.419, volume: 12400 });
      expect(k1).toBe(k2);
    });

    it('differs when token_id changes (cache is per-token)', () => {
      const k1 = computeCacheKey('slug', 'tokA', { ask: 0.5, volume: 10000 });
      const k2 = computeCacheKey('slug', 'tokB', { ask: 0.5, volume: 10000 });
      expect(k1).not.toBe(k2);
    });

    it('differs when ask rounds to a different 1% bucket', () => {
      // 0.42 → 42, 0.43 → 43 — different buckets.
      const k1 = computeCacheKey('slug', 'tok', { ask: 0.42, volume: 10000 });
      const k2 = computeCacheKey('slug', 'tok', { ask: 0.43, volume: 10000 });
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
