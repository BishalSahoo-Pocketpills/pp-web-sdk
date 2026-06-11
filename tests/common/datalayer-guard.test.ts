import { describe, it, expect } from 'vitest';
import { ensureDataLayer, pushToDataLayer, DATALAYER_CAP } from '@src/common/datalayer-guard';

function makeWin(): Window & typeof globalThis {
  return {} as Window & typeof globalThis;
}

describe('datalayer-guard', () => {
  it('ensureDataLayer creates window.dataLayer once and returns the same array', () => {
    const win = makeWin();
    const dl = ensureDataLayer(win);
    expect(Array.isArray(dl)).toBe(true);
    dl.push('x');
    // Idempotent — returns the existing array, not a fresh one.
    expect(ensureDataLayer(win)).toBe(dl);
    expect((win as unknown as { dataLayer: unknown[] }).dataLayer.length).toBe(1);
  });

  it('pushToDataLayer pushes without trimming while under the cap', () => {
    const win = makeWin();
    pushToDataLayer(win, { event: 'a' });
    pushToDataLayer(win, { event: 'b' });
    const dl = (win as unknown as { dataLayer: unknown[] }).dataLayer;
    expect(dl.length).toBe(2);
    expect(dl[1]).toEqual({ event: 'b' });
  });

  it('pushToDataLayer front-trims (drops oldest) once the array reaches the cap', () => {
    const win = makeWin();
    // Explicit small cap so the trim branch engages deterministically.
    pushToDataLayer(win, 1, 2);
    pushToDataLayer(win, 2, 2); // [1, 2]
    pushToDataLayer(win, 3, 2); // length 2 >= cap 2 → splice oldest → [2] → push → [2, 3]
    const dl = (win as unknown as { dataLayer: unknown[] }).dataLayer;
    expect(dl).toEqual([2, 3]);
  });

  it('uses DATALAYER_CAP (1000) as the default cap', () => {
    expect(DATALAYER_CAP).toBe(1000);
    const win = makeWin();
    const dl = ensureDataLayer(win) as unknown[];
    for (let i = 0; i < DATALAYER_CAP + 5; i++) dl.push({ event: 'filler_' + i });
    pushToDataLayer(win, { event: 'newest' });
    expect(dl.length).toBe(DATALAYER_CAP);
    expect(dl[DATALAYER_CAP - 1]).toEqual({ event: 'newest' });
    expect(dl[0]).not.toEqual({ event: 'filler_0' }); // oldest trimmed
  });
});
