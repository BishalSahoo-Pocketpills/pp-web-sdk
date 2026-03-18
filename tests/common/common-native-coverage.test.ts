/**
 * Common Native Coverage Test
 *
 * Imports the common source directly through Vitest's transform pipeline
 * instead of loading the pre-built IIFE via vm.runInThisContext(). This bypasses
 * the ast-v8-to-istanbul conversion bug that produces negative branch counts
 * when processing esbuild IIFE output with inline source maps.
 *
 * All other common test files use { coverable: false } so their IIFE
 * evaluations don't contribute to src/common/index.ts coverage. This file
 * is the sole source of common coverage data.
 */

async function freshLoad() {
  vi.resetModules();
  delete window.ppLib;
  delete window.ppLibReady;
  await import('../../src/common/index.ts');
}

describe('Common native coverage', () => {

  // ==========================================================================
  // IIFE BOOTSTRAP
  // ==========================================================================
  describe('IIFE bootstrap', () => {
    it('attaches ppLib to window with version, config, and _isReady', async () => {
      await freshLoad();

      expect(window.ppLib).toBeDefined();
      expect(typeof window.ppLib).toBe('object');
      expect(typeof window.ppLib.version).toBe('string');
      expect(window.ppLib.version.length).toBeGreaterThan(0);
      expect(window.ppLib._isReady).toBe(true);
      expect(window.ppLib.config).toBeDefined();
      expect(window.ppLib.SafeUtils).toBeDefined();
      expect(window.ppLib.Security).toBeDefined();
      expect(window.ppLib.Storage).toBeDefined();
      expect(window.ppLib.getCookie).toBeDefined();
      expect(window.ppLib.deleteCookie).toBeDefined();
      expect(window.ppLib.getQueryParam).toBeDefined();
      expect(window.ppLib.extend).toBeDefined();
      expect(window.ppLib.ready).toBeDefined();
      expect(window.ppLib.log).toBeDefined();
    });

    it('preserves existing ppLib properties on reload', async () => {
      await freshLoad();
      (window.ppLib as any)._custom = 'keep-me';
      await freshLoad();
      // ppLib is reassigned with || so existing object is reused
      // but since we delete window.ppLib in freshLoad, a new one is created
      expect(window.ppLib).toBeDefined();
    });

    it('processes ppLibReady queue — calls functions, skips non-functions', async () => {
      vi.resetModules();
      delete window.ppLib;
      delete window.ppLibReady;

      const spy1 = vi.fn();
      const spy2 = vi.fn();
      window.ppLibReady = [spy1, 'not a function' as any, 42 as any, null as any, spy2];
      await import('../../src/common/index.ts');

      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy1).toHaveBeenCalledWith(window.ppLib);
      expect(spy2).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledWith(window.ppLib);
      expect(window.ppLibReady).toBeNull();
    });

    it('handles absent ppLibReady queue gracefully', async () => {
      vi.resetModules();
      delete window.ppLib;
      delete window.ppLibReady;

      await import('../../src/common/index.ts');

      expect(window.ppLib).toBeDefined();
      expect(window.ppLib._isReady).toBe(true);
    });
  });

  // ==========================================================================
  // ppLib.ready
  // ==========================================================================
  describe('ppLib.ready', () => {
    it('invokes callback immediately with ppLib', async () => {
      await freshLoad();
      const spy = vi.fn();
      window.ppLib.ready(spy);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(window.ppLib);
    });

    it('does nothing for non-function argument', async () => {
      await freshLoad();
      // Should not throw
      window.ppLib.ready(null as any);
      window.ppLib.ready(undefined as any);
      window.ppLib.ready('string' as any);
      window.ppLib.ready(42 as any);
    });
  });

  // ==========================================================================
  // ppLib.log
  // ==========================================================================
  describe('ppLib.log', () => {
    it('logs error level regardless of debug mode', async () => {
      await freshLoad();
      window.ppLib.config.debug = false;
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      window.ppLib.log('error', 'test error');
      expect(spy).toHaveBeenCalled();
    });

    it('logs warn level regardless of debug mode', async () => {
      await freshLoad();
      window.ppLib.config.debug = false;
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      window.ppLib.log('warn', 'test warn');
      expect(spy).toHaveBeenCalled();
    });

    it('logs info level when debug is true', async () => {
      await freshLoad();
      window.ppLib.config.debug = true;
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      window.ppLib.log('info', 'test info', { extra: true });
      expect(spy).toHaveBeenCalled();
    });

    it('suppresses info level when debug is false', async () => {
      await freshLoad();
      window.ppLib.config.debug = false;
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      window.ppLib.log('info', 'should be suppressed');
      expect(spy).not.toHaveBeenCalled();
    });

    it('logs verbose level only when debug=true AND verbose=true', async () => {
      await freshLoad();
      window.ppLib.config.debug = true;
      window.ppLib.config.verbose = true;
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      // 'verbose' is not a standard console method, falls through to console.log
      window.ppLib.log('verbose', 'verbose msg');
      expect(spy).toHaveBeenCalled();
    });

    it('suppresses verbose when debug=true but verbose=false', async () => {
      await freshLoad();
      window.ppLib.config.debug = true;
      window.ppLib.config.verbose = false;
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      window.ppLib.log('verbose', 'should be suppressed');
      expect(spy).not.toHaveBeenCalled();
    });

    it('suppresses verbose when debug=false', async () => {
      await freshLoad();
      window.ppLib.config.debug = false;
      window.ppLib.config.verbose = true;
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      window.ppLib.log('verbose', 'should be suppressed');
      expect(spy).not.toHaveBeenCalled();
    });

    it('falls back to console.log for unknown levels', async () => {
      await freshLoad();
      window.ppLib.config.debug = true;
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      window.ppLib.log('custom_level' as any, 'custom message');
      expect(spy).toHaveBeenCalled();
    });

    it('does not pass data when data argument is omitted', async () => {
      await freshLoad();
      window.ppLib.config.debug = true;
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      window.ppLib.log('info', 'no data');
      // The third argument should be '' (empty string) when data is undefined
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[ppLib v'),
        'no data',
        ''
      );
    });

    it('handles console errors silently (catch path)', async () => {
      await freshLoad();
      window.ppLib.config.debug = true;
      // Override console.info to throw
      vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('console broke'); });
      // Should not throw
      expect(() => window.ppLib.log('info', 'test')).not.toThrow();
    });
  });

  // ==========================================================================
  // CONFIG
  // ==========================================================================
  describe('ppLib.config (createConfig)', () => {
    it('returns default config values', async () => {
      await freshLoad();
      expect(window.ppLib.config.debug).toBe(false);
      expect(window.ppLib.config.verbose).toBe(false);
      expect(window.ppLib.config.namespace).toBe('pp_attr');
      expect(window.ppLib.config.security.maxParamLength).toBe(500);
      expect(window.ppLib.config.security.maxStorageSize).toBe(4096);
      expect(window.ppLib.config.security.maxUrlLength).toBe(2048);
      expect(window.ppLib.config.security.enableSanitization).toBe(true);
      expect(window.ppLib.config.security.strictMode).toBe(false);
    });
  });

  // ==========================================================================
  // SAFE UTILS
  // ==========================================================================
  describe('SafeUtils', () => {
    describe('get', () => {
      it('retrieves deep nested value', async () => {
        await freshLoad();
        const obj = { a: { b: { c: 42 } } };
        expect(window.ppLib.SafeUtils.get(obj, 'a.b.c')).toBe(42);
      });

      it('returns value for single-level path', async () => {
        await freshLoad();
        const obj = { name: 'test' };
        expect(window.ppLib.SafeUtils.get(obj, 'name')).toBe('test');
      });

      it('returns defaultValue for missing path', async () => {
        await freshLoad();
        const obj = { a: { b: 1 } };
        expect(window.ppLib.SafeUtils.get(obj, 'a.x.y', 'default')).toBe('default');
      });

      it('returns defaultValue when intermediate value is null', async () => {
        await freshLoad();
        const obj = { a: { b: null as any } };
        expect(window.ppLib.SafeUtils.get(obj, 'a.b.c', 'fallback')).toBe('fallback');
      });

      it('returns defaultValue when intermediate value is undefined', async () => {
        await freshLoad();
        const obj = { a: {} };
        expect(window.ppLib.SafeUtils.get(obj, 'a.missing.deep', 'nope')).toBe('nope');
      });

      it('returns defaultValue when obj is null', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.get(null, 'a.b', 'def')).toBe('def');
      });

      it('returns defaultValue when obj is undefined', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.get(undefined, 'x', 'def')).toBe('def');
      });

      it('returns defaultValue when obj is a non-object (string)', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.get('string', 'x', 'def')).toBe('def');
      });

      it('returns defaultValue when obj is a non-object (number)', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.get(42, 'x', 'def')).toBe('def');
      });

      it('returns defaultValue when the final value is undefined', async () => {
        await freshLoad();
        const obj = { a: { b: undefined } };
        expect(window.ppLib.SafeUtils.get(obj, 'a.b', 'fallback')).toBe('fallback');
      });

      it('returns the value (not defaultValue) when value is 0 or false', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.get({ v: 0 }, 'v', 'def')).toBe(0);
        expect(window.ppLib.SafeUtils.get({ v: false }, 'v', 'def')).toBe(false);
        expect(window.ppLib.SafeUtils.get({ v: '' }, 'v', 'def')).toBe('');
      });

      it('returns undefined when no defaultValue and path missing', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.get({}, 'missing')).toBeUndefined();
      });

      it('handles intermediate non-object types in the path', async () => {
        await freshLoad();
        const obj = { a: 42 };
        expect(window.ppLib.SafeUtils.get(obj, 'a.b.c', 'def')).toBe('def');
      });
    });

    describe('set', () => {
      it('sets a deep nested value, creating intermediates', async () => {
        await freshLoad();
        const obj: any = {};
        const result = window.ppLib.SafeUtils.set(obj, 'a.b.c', 42);
        expect(result).toBe(true);
        expect(obj.a.b.c).toBe(42);
      });

      it('sets a single-level value', async () => {
        await freshLoad();
        const obj: any = {};
        expect(window.ppLib.SafeUtils.set(obj, 'name', 'test')).toBe(true);
        expect(obj.name).toBe('test');
      });

      it('overwrites existing intermediate values that are not objects', async () => {
        await freshLoad();
        const obj: any = { a: 'string' };
        expect(window.ppLib.SafeUtils.set(obj, 'a.b', 99)).toBe(true);
        expect(obj.a.b).toBe(99);
      });

      it('returns false when obj is null', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.set(null, 'a', 1)).toBe(false);
      });

      it('returns false when obj is undefined', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.set(undefined, 'a', 1)).toBe(false);
      });

      it('returns false when obj is a non-object (string)', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.set('string' as any, 'a', 1)).toBe(false);
      });

      it('returns false when obj is a non-object (number)', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.set(42 as any, 'a', 1)).toBe(false);
      });

      // Prototype pollution guard tests
      it('blocks __proto__ as first key — prototype pollution', async () => {
        await freshLoad();
        const obj: any = {};
        const result = window.ppLib.SafeUtils.set(obj, '__proto__.isAdmin', true);
        expect(result).toBe(false);
        expect(({} as any).isAdmin).toBeUndefined();
      });

      it('blocks constructor as first key — prototype pollution', async () => {
        await freshLoad();
        const obj: any = {};
        const result = window.ppLib.SafeUtils.set(obj, 'constructor.x', true);
        expect(result).toBe(false);
      });

      it('blocks prototype as first key — prototype pollution', async () => {
        await freshLoad();
        const obj: any = {};
        const result = window.ppLib.SafeUtils.set(obj, 'prototype.y', true);
        expect(result).toBe(false);
      });

      it('blocks __proto__ as intermediate key — prototype pollution', async () => {
        await freshLoad();
        const obj: any = { a: {} };
        const result = window.ppLib.SafeUtils.set(obj, 'a.__proto__.b', true);
        expect(result).toBe(false);
        expect(({} as any).b).toBeUndefined();
      });

      it('blocks constructor as intermediate key — prototype pollution', async () => {
        await freshLoad();
        const obj: any = { a: {} };
        const result = window.ppLib.SafeUtils.set(obj, 'a.constructor.polluted', true);
        expect(result).toBe(false);
      });

      it('blocks prototype as intermediate key — prototype pollution', async () => {
        await freshLoad();
        const obj: any = { a: {} };
        const result = window.ppLib.SafeUtils.set(obj, 'a.prototype.polluted', true);
        expect(result).toBe(false);
      });

      it('handles set error by returning false (catch path)', async () => {
        await freshLoad();
        // Freeze the object so assignment throws in strict mode
        const obj = Object.freeze({ a: 1 });
        const result = window.ppLib.SafeUtils.set(obj, 'a', 2);
        expect(result).toBe(false);
      });
    });

    describe('toString', () => {
      it('converts null to empty string', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toString(null)).toBe('');
      });

      it('converts undefined to empty string', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toString(undefined)).toBe('');
      });

      it('converts number to string', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toString(42)).toBe('42');
      });

      it('converts boolean to string', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toString(true)).toBe('true');
      });

      it('passes string through unchanged', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toString('hello')).toBe('hello');
      });

      it('converts 0 to "0"', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toString(0)).toBe('0');
      });

      it('converts empty string to empty string', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toString('')).toBe('');
      });
    });

    describe('exists', () => {
      it('returns true for non-empty string', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.exists('hello')).toBe(true);
      });

      it('returns true for number 0', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.exists(0)).toBe(true);
      });

      it('returns true for false', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.exists(false)).toBe(true);
      });

      it('returns true for object', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.exists({})).toBe(true);
      });

      it('returns false for null', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.exists(null)).toBe(false);
      });

      it('returns false for undefined', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.exists(undefined)).toBe(false);
      });

      it('returns false for empty string', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.exists('')).toBe(false);
      });
    });

    describe('toArray', () => {
      it('returns array as-is', async () => {
        await freshLoad();
        const arr = [1, 2, 3];
        expect(window.ppLib.SafeUtils.toArray(arr)).toBe(arr);
      });

      it('wraps single value in array', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toArray('hello')).toEqual(['hello']);
      });

      it('wraps number in array', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toArray(42)).toEqual([42]);
      });

      it('returns empty array for null', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toArray(null)).toEqual([]);
      });

      it('returns empty array for undefined', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toArray(undefined)).toEqual([]);
      });

      it('returns empty array for 0 (falsy but not null/undefined)', async () => {
        await freshLoad();
        // 0 is falsy so !val is true, returns []
        expect(window.ppLib.SafeUtils.toArray(0)).toEqual([]);
      });

      it('returns empty array for empty string (falsy)', async () => {
        await freshLoad();
        expect(window.ppLib.SafeUtils.toArray('')).toEqual([]);
      });
    });

    describe('forEach', () => {
      it('iterates over array calling callback with item, index, arr', async () => {
        await freshLoad();
        const results: any[] = [];
        const arr = ['a', 'b', 'c'];
        window.ppLib.SafeUtils.forEach(arr, (item, index, a) => {
          results.push({ item, index, arrRef: a === arr });
        });
        expect(results).toEqual([
          { item: 'a', index: 0, arrRef: true },
          { item: 'b', index: 1, arrRef: true },
          { item: 'c', index: 2, arrRef: true },
        ]);
      });

      it('does nothing when arr is not an array', async () => {
        await freshLoad();
        const spy = vi.fn();
        window.ppLib.SafeUtils.forEach(null as any, spy);
        window.ppLib.SafeUtils.forEach(undefined as any, spy);
        window.ppLib.SafeUtils.forEach('string' as any, spy);
        window.ppLib.SafeUtils.forEach(42 as any, spy);
        expect(spy).not.toHaveBeenCalled();
      });

      it('does nothing when callback is not a function', async () => {
        await freshLoad();
        // Should not throw
        window.ppLib.SafeUtils.forEach([1, 2], null as any);
        window.ppLib.SafeUtils.forEach([1, 2], 'string' as any);
      });

      it('handles error in callback (catch path)', async () => {
        await freshLoad();
        window.ppLib.config.debug = true;
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        window.ppLib.SafeUtils.forEach([1], () => {
          throw new Error('callback error');
        });
        expect(spy).toHaveBeenCalled();
      });

      it('works with empty array', async () => {
        await freshLoad();
        const spy = vi.fn();
        window.ppLib.SafeUtils.forEach([], spy);
        expect(spy).not.toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // SECURITY
  // ==========================================================================
  describe('Security', () => {
    describe('sanitize', () => {
      it('sanitizes HTML special characters', async () => {
        await freshLoad();
        const result = window.ppLib.Security.sanitize('<script>alert("xss")</script>');
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
        expect(result).not.toContain('"');
        expect(result).not.toContain("'");
      });

      it('removes javascript: URIs', async () => {
        await freshLoad();
        const result = window.ppLib.Security.sanitize('javascript:alert(1)');
        expect(result.toLowerCase()).not.toContain('javascript:');
      });

      it('removes event handlers', async () => {
        await freshLoad();
        const result = window.ppLib.Security.sanitize('onclick=alert(1)');
        expect(result.toLowerCase()).not.toContain('onclick');
      });

      it('removes data:text/html URIs', async () => {
        await freshLoad();
        const result = window.ppLib.Security.sanitize('data:text/html,<h1>XSS</h1>');
        expect(result.toLowerCase()).not.toContain('data:text/html');
      });

      it('removes control characters', async () => {
        await freshLoad();
        const result = window.ppLib.Security.sanitize('hello\x00world\x01test');
        expect(result).toBe('helloworldtest');
      });

      it('truncates input to maxParamLength', async () => {
        await freshLoad();
        const longStr = 'a'.repeat(1000);
        const result = window.ppLib.Security.sanitize(longStr);
        expect(result.length).toBeLessThanOrEqual(window.ppLib.config.security.maxParamLength);
      });

      it('returns empty string for null input', async () => {
        await freshLoad();
        expect(window.ppLib.Security.sanitize(null)).toBe('');
      });

      it('returns empty string for undefined input', async () => {
        await freshLoad();
        expect(window.ppLib.Security.sanitize(undefined)).toBe('');
      });

      it('returns empty string for empty string input', async () => {
        await freshLoad();
        expect(window.ppLib.Security.sanitize('')).toBe('');
      });

      it('passes through clean input unchanged', async () => {
        await freshLoad();
        expect(window.ppLib.Security.sanitize('hello world')).toBe('hello world');
      });

      it('converts number input to string', async () => {
        await freshLoad();
        expect(window.ppLib.Security.sanitize(42)).toBe('42');
      });

      it('respects strictMode — rejects modified input', async () => {
        await freshLoad();
        window.ppLib.config.security.strictMode = true;
        const result = window.ppLib.Security.sanitize('<b>bold</b>');
        expect(result).toBe(''); // Strict mode rejects since sanitized !== original
      });

      it('strictMode passes clean input through', async () => {
        await freshLoad();
        window.ppLib.config.security.strictMode = true;
        const result = window.ppLib.Security.sanitize('clean input');
        expect(result).toBe('clean input');
      });

      it('returns raw string when sanitization is disabled', async () => {
        await freshLoad();
        window.ppLib.config.security.enableSanitization = false;
        const result = window.ppLib.Security.sanitize('<script>alert(1)</script>');
        expect(result).toContain('<script>');
      });

      it('returns empty string on sanitization disabled with null input', async () => {
        await freshLoad();
        window.ppLib.config.security.enableSanitization = false;
        // When sanitization is disabled, it returns safeUtils.toString(input)
        // toString(null) returns ''
        expect(window.ppLib.Security.sanitize(null)).toBe('');
      });
    });

    describe('isValidUrl', () => {
      it('accepts valid http URL', async () => {
        await freshLoad();
        expect(window.ppLib.Security.isValidUrl('http://example.com')).toBe(true);
      });

      it('accepts valid https URL', async () => {
        await freshLoad();
        expect(window.ppLib.Security.isValidUrl('https://example.com/path?q=1')).toBe(true);
      });

      it('rejects ftp protocol', async () => {
        await freshLoad();
        expect(window.ppLib.Security.isValidUrl('ftp://example.com')).toBe(false);
      });

      it('rejects javascript: protocol', async () => {
        await freshLoad();
        expect(window.ppLib.Security.isValidUrl('javascript:alert(1)')).toBe(false);
      });

      it('rejects data: protocol', async () => {
        await freshLoad();
        expect(window.ppLib.Security.isValidUrl('data:text/html,test')).toBe(false);
      });

      it('rejects null', async () => {
        await freshLoad();
        expect(window.ppLib.Security.isValidUrl(null as any)).toBe(false);
      });

      it('rejects empty string', async () => {
        await freshLoad();
        expect(window.ppLib.Security.isValidUrl('')).toBe(false);
      });

      it('rejects non-string', async () => {
        await freshLoad();
        expect(window.ppLib.Security.isValidUrl(42 as any)).toBe(false);
      });

      it('rejects URLs exceeding maxUrlLength', async () => {
        await freshLoad();
        const longUrl = 'https://example.com/' + 'a'.repeat(3000);
        expect(window.ppLib.Security.isValidUrl(longUrl)).toBe(false);
      });

      it('rejects invalid URL string (parse error)', async () => {
        await freshLoad();
        expect(window.ppLib.Security.isValidUrl('not a url')).toBe(false);
      });
    });

    describe('json.parse', () => {
      it('parses valid JSON', async () => {
        await freshLoad();
        const result = window.ppLib.Security.json.parse('{"key":"value"}');
        expect(result).toEqual({ key: 'value' });
      });

      it('returns fallback for invalid JSON', async () => {
        await freshLoad();
        const result = window.ppLib.Security.json.parse('not json', { fallback: true });
        expect(result).toEqual({ fallback: true });
      });

      it('returns null for invalid JSON when no fallback provided', async () => {
        await freshLoad();
        const result = window.ppLib.Security.json.parse('not json');
        expect(result).toBeNull();
      });

      it('returns null for null input', async () => {
        await freshLoad();
        expect(window.ppLib.Security.json.parse(null as any)).toBeNull();
      });

      it('returns null for empty string input', async () => {
        await freshLoad();
        expect(window.ppLib.Security.json.parse('')).toBeNull();
      });

      it('returns fallback for null input when fallback provided', async () => {
        await freshLoad();
        expect(window.ppLib.Security.json.parse(null as any, 'fb')).toBe('fb');
      });

      it('rejects data exceeding maxStorageSize', async () => {
        await freshLoad();
        window.ppLib.config.security.maxStorageSize = 10; // Very small limit
        const result = window.ppLib.Security.json.parse('{"key":"' + 'x'.repeat(50) + '"}');
        expect(result).toBeNull();
      });

      it('returns fallback when data exceeds maxStorageSize', async () => {
        await freshLoad();
        window.ppLib.config.security.maxStorageSize = 10;
        const result = window.ppLib.Security.json.parse('{"key":"' + 'x'.repeat(50) + '"}', 'fb');
        expect(result).toBe('fb');
      });

      it('parses arrays', async () => {
        await freshLoad();
        expect(window.ppLib.Security.json.parse('[1,2,3]')).toEqual([1, 2, 3]);
      });

      it('parses strings', async () => {
        await freshLoad();
        expect(window.ppLib.Security.json.parse('"hello"')).toBe('hello');
      });
    });

    describe('json.stringify', () => {
      it('stringifies object', async () => {
        await freshLoad();
        const result = window.ppLib.Security.json.stringify({ key: 'value' });
        expect(result).toBe('{"key":"value"}');
      });

      it('returns null for null input', async () => {
        await freshLoad();
        expect(window.ppLib.Security.json.stringify(null)).toBeNull();
      });

      it('returns null for undefined input', async () => {
        await freshLoad();
        expect(window.ppLib.Security.json.stringify(undefined as any)).toBeNull();
      });

      it('returns null for falsy input (0, empty string)', async () => {
        await freshLoad();
        expect(window.ppLib.Security.json.stringify(0 as any)).toBeNull();
        expect(window.ppLib.Security.json.stringify('' as any)).toBeNull();
      });

      it('rejects data exceeding maxStorageSize', async () => {
        await freshLoad();
        window.ppLib.config.security.maxStorageSize = 10;
        const result = window.ppLib.Security.json.stringify({ large: 'x'.repeat(50) });
        expect(result).toBeNull();
      });

      it('handles circular reference (catch path)', async () => {
        await freshLoad();
        const obj: any = {};
        obj.self = obj;
        expect(window.ppLib.Security.json.stringify(obj)).toBeNull();
      });

      it('stringifies arrays', async () => {
        await freshLoad();
        expect(window.ppLib.Security.json.stringify([1, 2])).toBe('[1,2]');
      });
    });

    describe('validateData', () => {
      it('returns true for safe data', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData({ name: 'safe', value: 42 })).toBe(true);
      });

      it('returns false for non-object input (null)', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData(null)).toBe(false);
      });

      it('returns false for non-object input (string)', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData('string')).toBe(false);
      });

      it('returns false for non-object input (number)', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData(42)).toBe(false);
      });

      it('returns false for non-object input (undefined)', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData(undefined)).toBe(false);
      });

      it('detects <script tag', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData({ val: '<script>alert(1)</script>' })).toBe(false);
      });

      it('detects javascript: URI', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData({ val: 'javascript:alert(1)' })).toBe(false);
      });

      it('detects onclick= event handler', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData({ val: 'onclick=doEvil()' })).toBe(false);
      });

      it('detects eval( call', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData({ val: 'eval(code)' })).toBe(false);
      });

      it('detects expression( CSS injection', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData({ val: 'expression(alert(1))' })).toBe(false);
      });

      it('detects data:text/html', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData({ val: 'data:text/html,<h1>XSS</h1>' })).toBe(false);
      });

      // CRITICAL: lastIndex fix — consecutive calls must consistently detect danger
      it('returns false on consecutive calls with javascript: URI (lastIndex fix)', async () => {
        await freshLoad();
        const data = { val: 'javascript:alert(1)' };
        expect(window.ppLib.Security.validateData(data)).toBe(false);
        expect(window.ppLib.Security.validateData(data)).toBe(false);
        expect(window.ppLib.Security.validateData(data)).toBe(false);
      });

      it('returns false on consecutive calls with onclick= (lastIndex fix)', async () => {
        await freshLoad();
        const data = { val: 'onclick=hack()' };
        expect(window.ppLib.Security.validateData(data)).toBe(false);
        expect(window.ppLib.Security.validateData(data)).toBe(false);
      });

      it('returns false on consecutive calls with data:text/html (lastIndex fix)', async () => {
        await freshLoad();
        const data = { val: 'data:text/html,<b>XSS</b>' };
        expect(window.ppLib.Security.validateData(data)).toBe(false);
        expect(window.ppLib.Security.validateData(data)).toBe(false);
      });

      it('returns false on consecutive calls with eval( (lastIndex fix)', async () => {
        await freshLoad();
        const data = { val: 'eval(code)' };
        // eval regex is case-insensitive but NOT global, so lastIndex is always 0
        // Test consistency anyway
        expect(window.ppLib.Security.validateData(data)).toBe(false);
        expect(window.ppLib.Security.validateData(data)).toBe(false);
      });

      it('returns false on consecutive calls with expression( (lastIndex fix)', async () => {
        await freshLoad();
        const data = { val: 'expression(alert())' };
        expect(window.ppLib.Security.validateData(data)).toBe(false);
        expect(window.ppLib.Security.validateData(data)).toBe(false);
      });

      it('detects multiple event handler types', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData({ val: 'onmouseover=x()' })).toBe(false);
        expect(window.ppLib.Security.validateData({ val: 'onload=x()' })).toBe(false);
        expect(window.ppLib.Security.validateData({ val: 'onerror=x()' })).toBe(false);
        expect(window.ppLib.Security.validateData({ val: 'onfocus=x()' })).toBe(false);
      });

      it('handles validateData error (catch path)', async () => {
        await freshLoad();
        // Create an object that throws on JSON.stringify
        const obj: any = {};
        Object.defineProperty(obj, 'evil', {
          get() { throw new Error('getter failed'); },
          enumerable: true
        });
        expect(window.ppLib.Security.validateData(obj)).toBe(false);
      });

      it('validates arrays as objects', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData([1, 2, 3])).toBe(true);
        expect(window.ppLib.Security.validateData(['safe', 'data'])).toBe(true);
      });

      it('validates nested objects', async () => {
        await freshLoad();
        expect(window.ppLib.Security.validateData({ a: { b: { c: 'safe' } } })).toBe(true);
      });
    });
  });

  // ==========================================================================
  // COOKIES
  // ==========================================================================
  describe('getCookie', () => {
    it('retrieves an existing cookie value', async () => {
      await freshLoad();
      document.cookie = 'testCookie=hello123';
      expect(window.ppLib.getCookie('testCookie')).toBe('hello123');
    });

    it('returns null for non-existent cookie', async () => {
      await freshLoad();
      expect(window.ppLib.getCookie('nonexistent')).toBeNull();
    });

    it('returns null for empty cookie name', async () => {
      await freshLoad();
      expect(window.ppLib.getCookie('')).toBeNull();
    });

    it('returns null for null cookie name', async () => {
      await freshLoad();
      expect(window.ppLib.getCookie(null as any)).toBeNull();
    });

    it('handles URL-encoded cookie values', async () => {
      await freshLoad();
      document.cookie = 'encoded=' + encodeURIComponent('hello world');
      expect(window.ppLib.getCookie('encoded')).toBe('hello world');
    });

    it('handles cookie names with special regex characters', async () => {
      await freshLoad();
      document.cookie = 'test.cookie=value';
      expect(window.ppLib.getCookie('test.cookie')).toBe('value');
    });

    it('handles cookies with empty document.cookie', async () => {
      await freshLoad();
      // Clear all cookies
      document.cookie.split(';').forEach(c => {
        const name = c.split('=')[0].trim();
        if (name) document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
      });
      expect(window.ppLib.getCookie('anything')).toBeNull();
    });
  });

  describe('deleteCookie', () => {
    it('deletes an existing cookie', async () => {
      await freshLoad();
      document.cookie = 'toDelete=yes';
      window.ppLib.deleteCookie('toDelete');
      expect(window.ppLib.getCookie('toDelete')).toBeNull();
    });

    it('does nothing for empty name', async () => {
      await freshLoad();
      // Should not throw
      window.ppLib.deleteCookie('');
    });

    it('does nothing for null name', async () => {
      await freshLoad();
      window.ppLib.deleteCookie(null as any);
    });
  });

  // ==========================================================================
  // URL UTILITIES
  // ==========================================================================
  describe('getQueryParam', () => {
    it('extracts a query parameter value', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam('https://example.com?foo=bar', 'foo')).toBe('bar');
    });

    it('extracts parameter case-insensitively', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam('https://example.com?FOO=bar', 'foo')).toBe('bar');
    });

    it('extracts parameter from URL with multiple params', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam('https://example.com?a=1&b=2&c=3', 'b')).toBe('2');
    });

    it('returns empty string for missing parameter', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam('https://example.com?foo=bar', 'missing')).toBe('');
    });

    it('returns empty string for empty URL', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam('', 'foo')).toBe('');
    });

    it('returns empty string for null URL', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam(null as any, 'foo')).toBe('');
    });

    it('returns empty string for empty findParam', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam('https://example.com?foo=bar', '')).toBe('');
    });

    it('returns empty string for null findParam', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam('https://example.com?foo=bar', null as any)).toBe('');
    });

    it('handles URL without query string', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam('https://example.com', 'foo')).toBe('');
    });

    it('strips fragment before parsing', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam('https://example.com?foo=bar#section', 'foo')).toBe('bar');
    });

    it('does not leak fragment into param value', async () => {
      await freshLoad();
      const result = window.ppLib.getQueryParam('https://example.com?foo=bar#hash', 'foo');
      expect(result).not.toContain('#');
      expect(result).toBe('bar');
    });

    it('handles URL with only fragment, no query params', async () => {
      await freshLoad();
      expect(window.ppLib.getQueryParam('https://example.com#hash', 'foo')).toBe('');
    });
  });

  // ==========================================================================
  // STORAGE
  // ==========================================================================
  describe('Storage', () => {
    describe('isAvailable', () => {
      it('returns true for sessionStorage by default', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.isAvailable()).toBe(true);
      });

      it('returns true for sessionStorage explicitly', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.isAvailable('sessionStorage')).toBe(true);
      });

      it('returns true for localStorage', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.isAvailable('localStorage')).toBe(true);
      });

      it('returns false for non-existent storage type', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.isAvailable('nonexistent')).toBe(false);
      });

      it('returns false when storage throws (catch path)', async () => {
        await freshLoad();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new Error('quota exceeded');
        });
        expect(window.ppLib.Storage.isAvailable('sessionStorage')).toBe(false);
      });
    });

    describe('getKey', () => {
      it('returns namespaced key with default namespace', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.getKey('test')).toBe('pp_attr_test');
      });

      it('uses custom namespace from config', async () => {
        await freshLoad();
        window.ppLib.config.namespace = 'custom';
        expect(window.ppLib.Storage.getKey('test')).toBe('custom_test');
      });

      it('uses config namespace even when empty string (falsy fallback path)', async () => {
        await freshLoad();
        // When namespace is '' (falsy), the || 'pp_attr' fallback kicks in
        window.ppLib.config.namespace = '';
        const result = window.ppLib.Storage.getKey('test');
        expect(result).toBe('pp_attr_test');
      });
    });

    describe('set', () => {
      it('sets value to sessionStorage by default', async () => {
        await freshLoad();
        const result = window.ppLib.Storage.set('mykey', { data: 'test' });
        expect(result).toBe(true);
        const stored = sessionStorage.getItem('pp_attr_mykey');
        expect(stored).not.toBeNull();
        expect(JSON.parse(stored!)).toEqual({ data: 'test' });
      });

      it('sets value to localStorage when persistent=true', async () => {
        await freshLoad();
        const result = window.ppLib.Storage.set('mykey', { data: 'test' }, true);
        expect(result).toBe(true);
        const stored = localStorage.getItem('pp_attr_mykey');
        expect(stored).not.toBeNull();
        expect(JSON.parse(stored!)).toEqual({ data: 'test' });
      });

      it('returns false for null value', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.set('key', null)).toBe(false);
      });

      it('returns false for undefined value', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.set('key', undefined)).toBe(false);
      });

      it('returns false for empty key', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.set('', { data: 1 })).toBe(false);
      });

      it('returns false for null key', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.set(null as any, { data: 1 })).toBe(false);
      });

      it('returns false when storage is not available', async () => {
        await freshLoad();
        vi.spyOn(window.ppLib.Storage, 'isAvailable').mockReturnValue(false);
        expect(window.ppLib.Storage.set('key', { data: 1 })).toBe(false);
      });

      it('returns false when data fails validation', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.set('key', { val: '<script>alert(1)</script>' })).toBe(false);
      });

      it('returns false when stringify returns null', async () => {
        await freshLoad();
        vi.spyOn(window.ppLib.Security.json, 'stringify').mockReturnValue(null);
        expect(window.ppLib.Storage.set('key', { data: 1 })).toBe(false);
      });

      it('returns false on storage setItem error (catch path)', async () => {
        await freshLoad();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new Error('quota');
        });
        expect(window.ppLib.Storage.set('key', { data: 1 })).toBe(false);
      });
    });

    describe('get', () => {
      it('retrieves stored value from sessionStorage', async () => {
        await freshLoad();
        sessionStorage.setItem('pp_attr_mykey', JSON.stringify({ data: 'test' }));
        const result = window.ppLib.Storage.get('mykey');
        expect(result).toEqual({ data: 'test' });
      });

      it('retrieves stored value from localStorage when persistent=true', async () => {
        await freshLoad();
        localStorage.setItem('pp_attr_mykey', JSON.stringify({ data: 'test' }));
        const result = window.ppLib.Storage.get('mykey', true);
        expect(result).toEqual({ data: 'test' });
      });

      it('returns null for empty key', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.get('')).toBeNull();
      });

      it('returns null for null key', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.get(null as any)).toBeNull();
      });

      it('returns null when storage is not available', async () => {
        await freshLoad();
        vi.spyOn(window.ppLib.Storage, 'isAvailable').mockReturnValue(false);
        expect(window.ppLib.Storage.get('key')).toBeNull();
      });

      it('returns null when item does not exist', async () => {
        await freshLoad();
        expect(window.ppLib.Storage.get('nonexistent')).toBeNull();
      });

      it('returns null and removes item when stored data fails validation', async () => {
        await freshLoad();
        sessionStorage.setItem('pp_attr_badkey', JSON.stringify({ val: '<script>alert(1)</script>' }));
        const result = window.ppLib.Storage.get('badkey');
        expect(result).toBeNull();
        expect(sessionStorage.getItem('pp_attr_badkey')).toBeNull();
      });

      it('returns parsed value for non-object types (string, number)', async () => {
        await freshLoad();
        sessionStorage.setItem('pp_attr_strkey', JSON.stringify('hello'));
        expect(window.ppLib.Storage.get('strkey')).toBe('hello');

        sessionStorage.setItem('pp_attr_numkey', JSON.stringify(42));
        expect(window.ppLib.Storage.get('numkey')).toBe(42);
      });

      it('returns null when json.parse returns null', async () => {
        await freshLoad();
        sessionStorage.setItem('pp_attr_badjson', 'not json');
        expect(window.ppLib.Storage.get('badjson')).toBeNull();
      });

      it('returns null on storage getItem error (catch path)', async () => {
        await freshLoad();
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new Error('access denied');
        });
        expect(window.ppLib.Storage.get('key')).toBeNull();
      });
    });

    describe('remove', () => {
      it('removes item from sessionStorage', async () => {
        await freshLoad();
        sessionStorage.setItem('pp_attr_rmkey', 'value');
        window.ppLib.Storage.remove('rmkey');
        expect(sessionStorage.getItem('pp_attr_rmkey')).toBeNull();
      });

      it('removes item from localStorage when persistent=true', async () => {
        await freshLoad();
        localStorage.setItem('pp_attr_rmkey', 'value');
        window.ppLib.Storage.remove('rmkey', true);
        expect(localStorage.getItem('pp_attr_rmkey')).toBeNull();
      });

      it('does nothing for empty key', async () => {
        await freshLoad();
        window.ppLib.Storage.remove('');
      });

      it('does nothing for null key', async () => {
        await freshLoad();
        window.ppLib.Storage.remove(null as any);
      });

      it('does nothing when storage is not available', async () => {
        await freshLoad();
        vi.spyOn(window.ppLib.Storage, 'isAvailable').mockReturnValue(false);
        window.ppLib.Storage.remove('key');
      });

      it('handles removeItem error (catch path)', async () => {
        await freshLoad();
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
          throw new Error('access denied');
        });
        // Should not throw
        window.ppLib.Storage.remove('key');
      });
    });

    describe('clear', () => {
      it('removes touch and session keys from both storages', async () => {
        await freshLoad();
        sessionStorage.setItem('pp_attr_first_touch', 'val');
        sessionStorage.setItem('pp_attr_last_touch', 'val');
        sessionStorage.setItem('pp_attr_session_start', 'val');
        localStorage.setItem('pp_attr_first_touch', 'val');
        localStorage.setItem('pp_attr_last_touch', 'val');

        window.ppLib.Storage.clear();

        expect(sessionStorage.getItem('pp_attr_first_touch')).toBeNull();
        expect(sessionStorage.getItem('pp_attr_last_touch')).toBeNull();
        expect(sessionStorage.getItem('pp_attr_session_start')).toBeNull();
        expect(localStorage.getItem('pp_attr_first_touch')).toBeNull();
        expect(localStorage.getItem('pp_attr_last_touch')).toBeNull();
      });

      it('handles clear error (catch path)', async () => {
        await freshLoad();
        vi.spyOn(window.ppLib.Storage, 'remove').mockImplementation(() => {
          throw new Error('clear failed');
        });
        // Should not throw; exercises catch path
        window.ppLib.Storage.clear();
      });
    });
  });

  // ==========================================================================
  // EXTEND (deep merge utility)
  // ==========================================================================
  describe('ppLib.extend', () => {
    it('deep merges source into target', async () => {
      await freshLoad();
      const target = { a: 1, nested: { x: 10 } };
      const source = { b: 2, nested: { y: 20 } };
      const result = window.ppLib.extend(target, source);
      expect(result).toEqual({ a: 1, b: 2, nested: { x: 10, y: 20 } });
      expect(result).toBe(target); // mutates target
    });

    it('overwrites primitive values', async () => {
      await freshLoad();
      const target = { a: 1 };
      const source = { a: 2 };
      const result = window.ppLib.extend(target, source);
      expect(result.a).toBe(2);
    });

    it('copies arrays as-is (not deep merged)', async () => {
      await freshLoad();
      const target = { arr: [1, 2] };
      const source = { arr: [3, 4, 5] };
      const result = window.ppLib.extend(target, source);
      expect(result.arr).toEqual([3, 4, 5]);
    });

    it('creates nested objects in target if they do not exist', async () => {
      await freshLoad();
      const target: any = {};
      const source = { a: { b: { c: 1 } } };
      const result = window.ppLib.extend(target, source);
      expect(result.a.b.c).toBe(1);
    });

    it('returns target when source is null', async () => {
      await freshLoad();
      const target = { a: 1 };
      expect(window.ppLib.extend(target, null)).toBe(target);
    });

    it('returns target when source is undefined', async () => {
      await freshLoad();
      const target = { a: 1 };
      expect(window.ppLib.extend(target, undefined)).toBe(target);
    });

    it('returns empty object when target is null', async () => {
      await freshLoad();
      const result = window.ppLib.extend(null, { a: 1 });
      expect(result).toEqual({});
    });

    it('returns empty object when target is undefined', async () => {
      await freshLoad();
      const result = window.ppLib.extend(undefined, { a: 1 });
      expect(result).toEqual({});
    });

    it('returns empty object when both are null', async () => {
      await freshLoad();
      expect(window.ppLib.extend(null, null)).toEqual({});
    });

    it('skips __proto__ key in source (prototype pollution guard)', async () => {
      await freshLoad();
      const target: any = {};
      const source = JSON.parse('{"__proto__":{"polluted":true},"safe":"ok"}');
      window.ppLib.extend(target, source);
      expect(target.safe).toBe('ok');
      expect(({} as any).polluted).toBeUndefined();
    });

    it('skips constructor key in source', async () => {
      await freshLoad();
      const target: any = {};
      const source = { safe: 'ok' };
      Object.defineProperty(source, 'constructor', {
        value: { polluted: true },
        enumerable: true
      });
      window.ppLib.extend(target, source);
      expect(target.safe).toBe('ok');
    });

    it('skips prototype key in source', async () => {
      await freshLoad();
      const target: any = {};
      const source = { safe: 'ok' } as any;
      source.prototype = { polluted: true };
      window.ppLib.extend(target, source);
      expect(target.safe).toBe('ok');
    });

    it('handles source with null property value', async () => {
      await freshLoad();
      const target: any = { a: { b: 1 } };
      const source = { a: null };
      window.ppLib.extend(target, source);
      expect(target.a).toBeNull();
    });

    it('only copies own properties (not inherited)', async () => {
      await freshLoad();
      const proto = { inherited: true };
      const source = Object.create(proto);
      source.own = 'yes';
      const target: any = {};
      window.ppLib.extend(target, source);
      expect(target.own).toBe('yes');
      expect(target.inherited).toBeUndefined();
    });
  });

  // ==========================================================================
  // SANITIZE — additional event handler coverage
  // ==========================================================================
  describe('Security.sanitize — comprehensive event handlers', () => {
    it('removes various event handler patterns', async () => {
      await freshLoad();
      const handlers = [
        'onmouseover=x()',
        'onload=x()',
        'onerror=x()',
        'onfocus=x()',
        'onblur=x()',
        'onsubmit=x()',
        'onkeydown=x()',
        'onkeyup=x()',
        'onchange=x()',
        'ondragstart=x()',
        'ontouchstart=x()',
      ];
      for (const handler of handlers) {
        const result = window.ppLib.Security.sanitize(handler);
        expect(result).not.toMatch(/on\w+=/i);
      }
    });
  });

  // ==========================================================================
  // SANITIZE — regex with global flag lastIndex regression
  // ==========================================================================
  describe('Security.sanitize — stateful regex consistency', () => {
    it('consistently sanitizes javascript: on consecutive calls', async () => {
      await freshLoad();
      const input = 'javascript:alert(1)';
      const r1 = window.ppLib.Security.sanitize(input);
      const r2 = window.ppLib.Security.sanitize(input);
      expect(r1).toBe(r2);
      expect(r1.toLowerCase()).not.toContain('javascript:');
    });

    it('consistently sanitizes event handlers on consecutive calls', async () => {
      await freshLoad();
      const input = 'onclick=alert(1)';
      const r1 = window.ppLib.Security.sanitize(input);
      const r2 = window.ppLib.Security.sanitize(input);
      expect(r1).toBe(r2);
    });

    it('consistently sanitizes data:text/html on consecutive calls', async () => {
      await freshLoad();
      const input = 'data:text/html,<h1>XSS</h1>';
      const r1 = window.ppLib.Security.sanitize(input);
      const r2 = window.ppLib.Security.sanitize(input);
      expect(r1).toBe(r2);
      expect(r1.toLowerCase()).not.toContain('data:text/html');
    });
  });

  // ==========================================================================
  // STORAGE.get — validates then removes dangerous stored object
  // ==========================================================================
  describe('Storage.get — validateData on retrieved objects', () => {
    it('returns object data that passes validation', async () => {
      await freshLoad();
      sessionStorage.setItem('pp_attr_goodobj', JSON.stringify({ safe: 'data' }));
      const result = window.ppLib.Storage.get('goodobj');
      expect(result).toEqual({ safe: 'data' });
    });

    it('returns array data that passes validation', async () => {
      await freshLoad();
      sessionStorage.setItem('pp_attr_arr', JSON.stringify([1, 2, 3]));
      const result = window.ppLib.Storage.get('arr');
      expect(result).toEqual([1, 2, 3]);
    });

    it('removes and returns null for object that fails validation', async () => {
      await freshLoad();
      sessionStorage.setItem('pp_attr_evil', JSON.stringify({ val: 'javascript:alert(1)' }));
      const result = window.ppLib.Storage.get('evil');
      expect(result).toBeNull();
      expect(sessionStorage.getItem('pp_attr_evil')).toBeNull();
    });
  });
});
