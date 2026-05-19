/**
 * Create a full mock mixpanel object matching the SDK interface.
 */
export function createMockMixpanel() {
  const properties = {};
  return {
    __SV: 1.2,
    _i: [],
    track: vi.fn(),
    register: vi.fn((props) => Object.assign(properties, props)),
    register_once: vi.fn((props) => {
      for (const k in props) {
        if (!(k in properties)) properties[k] = props[k];
      }
    }),
    init: vi.fn(),
    get_property: vi.fn((key) => properties[key]),
    opt_in_tracking: vi.fn(),
    opt_out_tracking: vi.fn(),
    identify: vi.fn(),
    people: {
      set: vi.fn(),
      set_once: vi.fn(),
      increment: vi.fn(),
      append: vi.fn(),
      delete_user: vi.fn()
    },
    _properties: properties
  };
}
