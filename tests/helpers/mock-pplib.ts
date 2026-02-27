/**
 * Create a minimal ppLib mock for testing child modules without loading common.js.
 */
export function createMockPpLib(overrides = {}) {
  const ppLib = {
    version: '1.0.0',
    _isReady: true,
    config: {
      debug: false,
      verbose: false,
      namespace: 'pp_attr',
      security: {
        maxParamLength: 500,
        maxStorageSize: 4096,
        maxUrlLength: 2048,
        enableSanitization: true,
        strictMode: false
      }
    },
    SafeUtils: {
      get: (obj, path, def) => {
        if (!obj || typeof obj !== 'object') return def;
        const keys = path.split('.');
        let result = obj;
        for (let i = 0; i < keys.length; i++) {
          if (result === null || result === undefined || typeof result !== 'object') return def;
          result = result[keys[i]];
        }
        return result !== undefined ? result : def;
      },
      set: vi.fn((obj, path, value) => {
        if (!obj || typeof obj !== 'object') return false;
        const keys = path.split('.');
        let target = obj;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!target[keys[i]] || typeof target[keys[i]] !== 'object') target[keys[i]] = {};
          target = target[keys[i]];
        }
        target[keys[keys.length - 1]] = value;
        return true;
      }),
      toString: vi.fn(v => (v == null ? '' : String(v))),
      exists: vi.fn(v => v !== null && v !== undefined && v !== ''),
      toArray: vi.fn(v => {
        if (Array.isArray(v)) return v;
        if (!v) return [];
        return [v];
      }),
      forEach: vi.fn((arr, cb) => {
        if (Array.isArray(arr) && typeof cb === 'function') {
          for (let i = 0; i < arr.length; i++) cb(arr[i], i, arr);
        }
      })
    },
    Security: {
      sanitize: vi.fn(v => (v ? String(v) : '')),
      isValidUrl: vi.fn(() => true),
      json: {
        parse: vi.fn((str, fb) => { try { return JSON.parse(str); } catch (e) { return fb || null; } }),
        stringify: vi.fn(obj => { try { return JSON.stringify(obj); } catch (e) { return null; } })
      },
      validateData: vi.fn(() => true)
    },
    Storage: {
      get: vi.fn(() => null),
      set: vi.fn(() => true),
      remove: vi.fn(),
      clear: vi.fn(),
      isAvailable: vi.fn(() => true),
      getKey: vi.fn(k => 'pp_attr_' + k)
    },
    getCookie: vi.fn(() => null),
    deleteCookie: vi.fn(),
    getQueryParam: vi.fn(() => ''),
    log: vi.fn(),
    extend: vi.fn((t, s) => Object.assign(t || {}, s || {})),
    ready: vi.fn(cb => cb(ppLib)),
    ...overrides
  };
  return ppLib;
}
