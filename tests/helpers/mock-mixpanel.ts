/**
 * Mock Mixpanel SDK matching the surface the SDK code calls into.
 *
 * Two factories:
 *   - `createMockMixpanel()` — single instance (legacy single-instance tests).
 *   - `createDualMockMixpanel()` — primary + secondary as named instances,
 *     mirroring the real SDK shape where `window.mixpanel.secondary` is
 *     itself a full MixpanelGlobal. Use this for dual-instance tests.
 */

interface MockMpOptions {
  /** Optional name for nested-named-instance debugging. */
  name?: string;
  /** Pre-populate super-properties (read back via get_property). */
  initialProperties?: Record<string, unknown>;
}

export function createMockMixpanel(options: MockMpOptions = {}) {
  const properties: Record<string, unknown> = { ...(options.initialProperties || {}) };
  let distinctId: string = '$device:' + Math.random().toString(36).slice(2, 10);

  return {
    __SV: 1.2,
    _i: [] as unknown[],
    _name: options.name || 'primary',
    track: vi.fn(),
    register: vi.fn((props: Record<string, unknown>) => Object.assign(properties, props)),
    register_once: vi.fn((props: Record<string, unknown>) => {
      for (const k in props) {
        if (!(k in properties)) properties[k] = props[k];
      }
    }),
    unregister: vi.fn((prop: string) => { delete properties[prop]; }),
    init: vi.fn(),
    get_property: vi.fn((key: string) => properties[key]),
    get_distinct_id: vi.fn(() => distinctId),
    identify: vi.fn((id: string) => { distinctId = id; }),
    alias: vi.fn(),
    reset: vi.fn(() => {
      distinctId = '$device:' + Math.random().toString(36).slice(2, 10);
      for (const k in properties) delete properties[k];
    }),
    set_config: vi.fn(),
    opt_in_tracking: vi.fn(),
    opt_out_tracking: vi.fn(),
    people: {
      set: vi.fn(),
      set_once: vi.fn(),
      increment: vi.fn(),
      append: vi.fn(),
      union: vi.fn(),
      unset: vi.fn(),
      track_charge: vi.fn(),
      delete_user: vi.fn(),
    },
    _properties: properties,
  };
}

export type MockMixpanel = ReturnType<typeof createMockMixpanel>;

/**
 * Build a dual-instance mock. Returns the root (primary) with a `.secondary`
 * child, mirroring the real Mixpanel SDK shape:
 *   - `window.mixpanel` IS the primary instance.
 *   - `window.mixpanel.secondary` IS the secondary instance.
 *
 * Both are independent — each has its own super-props, distinct_id, and
 * jest.fn() spies. Assertions against `primary.track.mock.calls` and
 * `secondary.track.mock.calls` are independent.
 */
export function createDualMockMixpanel(): {
  root: MockMixpanel;
  primary: MockMixpanel;
  secondary: MockMixpanel;
} {
  const primary = createMockMixpanel({ name: 'primary' });
  const secondary = createMockMixpanel({ name: 'secondary' });
  // Real Mixpanel SDK installs named instance under the root.
  (primary as MockMixpanel & { secondary?: MockMixpanel }).secondary = secondary;
  return { root: primary, primary, secondary };
}
