import { describe, it, expect, vi } from 'vitest';
import { addInteractionListener } from '@src/common/dom-events';

describe('addInteractionListener', () => {
  it('binds both click and touchend with passive=true by default', () => {
    const target = document.createElement('div');
    const handler = vi.fn();
    addInteractionListener(target, handler);

    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    target.dispatchEvent(new Event('touchend', { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('passive=false is respected (handler can preventDefault)', () => {
    const target = document.createElement('a');
    const handler = vi.fn((e: Event) => e.preventDefault());
    addInteractionListener(target, handler, { passive: false });

    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('remove() detaches both listeners', () => {
    const target = document.createElement('div');
    const handler = vi.fn();
    const handle = addInteractionListener(target, handler);
    handle.remove();

    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    target.dispatchEvent(new Event('touchend', { bubbles: true }));

    expect(handler).not.toHaveBeenCalled();
  });
});
