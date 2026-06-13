/**
 * Regression for the ORGANIC_SEARCH_DOMAINS / SEARCH_ENGINE_PATTERNS drift:
 * the referrer-based platform classifier had a separate hand-maintained list
 * that fell behind the UTM resolver's engine list (missing ecosia / brave), so
 * those engines were misclassified as 'referral'. ORGANIC_SEARCH_DOMAINS is now
 * derived from SEARCH_ENGINE_PATTERNS so the two cannot diverge.
 */
import { describe, it, expect } from 'vitest';
import {
  detectPlatform,
  ORGANIC_SEARCH_DOMAINS,
  SEARCH_ENGINE_PATTERNS,
} from '../../src/common/attribution';

describe('detectPlatform — organic search classification', () => {
  it('classifies every curated search engine referrer as organic_search', () => {
    for (const { token } of SEARCH_ENGINE_PATTERNS) {
      const referrer = `https://www.${token}.com/search?q=pills`;
      expect(detectPlatform({}, referrer)).toBe('organic_search');
    }
  });

  it('classifies the previously-missed ecosia / brave referrers as organic_search', () => {
    expect(detectPlatform({}, 'https://www.ecosia.org/search?q=x')).toBe('organic_search');
    expect(detectPlatform({}, 'https://search.brave.com/search?q=x')).toBe('organic_search');
  });

  it('still classifies a non-search referrer as referral', () => {
    expect(detectPlatform({}, 'https://news.ycombinator.com/')).toBe('referral');
  });

  it('keeps ORGANIC_SEARCH_DOMAINS in lock-step with SEARCH_ENGINE_PATTERNS (no drift)', () => {
    expect(ORGANIC_SEARCH_DOMAINS).toEqual(SEARCH_ENGINE_PATTERNS.map((p) => p.token + '.'));
  });
});
