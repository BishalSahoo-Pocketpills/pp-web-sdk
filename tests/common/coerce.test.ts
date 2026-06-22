import { describe, it, expect } from 'vitest';
import { toFloat, toInt } from '@src/common/coerce';

describe('coerce', () => {
  describe('toFloat', () => {
    it('parses numeric strings and rounds to 2 decimals', () => {
      expect(toFloat('29.99')).toBe(29.99);
      expect(toFloat('29.999')).toBe(30);
      expect(toFloat('10')).toBe(10);
    });

    it('passes through number inputs (rounded)', () => {
      expect(toFloat(12.345)).toBe(12.35);
      expect(toFloat(0)).toBe(0);
    });

    it('falls back to 0 for non-numeric / missing', () => {
      expect(toFloat('abc')).toBe(0);
      expect(toFloat(null)).toBe(0);
      expect(toFloat(undefined)).toBe(0);
    });
  });

  describe('toInt', () => {
    it('preserves an explicit 0 (not clobbered to the fallback)', () => {
      expect(toInt('0', 1)).toBe(0);
      expect(toInt(0, 1)).toBe(0);
    });

    it('parses positive numeric strings', () => {
      expect(toInt('3', 1)).toBe(3);
    });

    it('passes through positive number inputs', () => {
      expect(toInt(5, 1)).toBe(5);
    });

    it('truncates floats identically whether number or string', () => {
      expect(toInt(2.7, 1)).toBe(2);
      expect(toInt('2.7', 1)).toBe(2);
    });

    it('clamps negatives to 0 (no negative revenue) for both number and string', () => {
      expect(toInt(-3, 1)).toBe(0);
      expect(toInt('-3', 1)).toBe(0);
    });

    it('falls back for non-numeric, missing, or non-finite inputs', () => {
      expect(toInt('abc', 1)).toBe(1);
      expect(toInt(null, 1)).toBe(1);
      expect(toInt(undefined, 7)).toBe(7);
      expect(toInt(NaN, 1)).toBe(1);
      expect(toInt(Infinity, 1)).toBe(1);
    });

    it('lenient prefix-parse mirrors parseInt semantics', () => {
      expect(toInt('5abc', 1)).toBe(5);
    });
  });
});
