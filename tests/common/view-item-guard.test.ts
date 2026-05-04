import { createEventGuard } from '../../src/common/event-guard';
import type { PPLib } from '../../src/types/common.types';

describe('createEventGuard', () => {
  function makePPLib(): PPLib {
    return {} as any;
  }

  it('claim() returns true on first call for an event', () => {
    const guard = createEventGuard(makePPLib());
    expect(guard.claim('view_item')).toBe(true);
  });

  it('claim() returns false on second call for same event', () => {
    const guard = createEventGuard(makePPLib());
    guard.claim('view_item');
    expect(guard.claim('view_item')).toBe(false);
  });

  it('claim() allows different event names independently', () => {
    const guard = createEventGuard(makePPLib());
    expect(guard.claim('view_item')).toBe(true);
    expect(guard.claim('add_to_cart')).toBe(true);
    expect(guard.claim('view_item')).toBe(false);
    expect(guard.claim('add_to_cart')).toBe(false);
  });

  it('hasFired() reflects claim state', () => {
    const guard = createEventGuard(makePPLib());
    expect(guard.hasFired('view_item')).toBe(false);
    guard.claim('view_item');
    expect(guard.hasFired('view_item')).toBe(true);
    expect(guard.hasFired('add_to_cart')).toBe(false);
  });

  it('two guards sharing same ppLib see each other\'s claims', () => {
    const ppLib = makePPLib();
    const guard1 = createEventGuard(ppLib);
    const guard2 = createEventGuard(ppLib);

    expect(guard1.claim('view_item')).toBe(true);
    expect(guard2.claim('view_item')).toBe(false);
    expect(guard2.hasFired('view_item')).toBe(true);
  });

  it('guards on separate ppLib instances are independent', () => {
    const guard1 = createEventGuard(makePPLib());
    const guard2 = createEventGuard(makePPLib());

    expect(guard1.claim('view_item')).toBe(true);
    expect(guard2.claim('view_item')).toBe(true);
  });
});
