import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const cacheDir = path.resolve(rootDir, '.cache');

/**
 * Cache vm.Script objects per module. Reusing the same Script lets V8
 * accumulate coverage counters across multiple runInThisContext() calls
 * within a single test-file fork, ensuring branch coverage merges correctly.
 */
const scriptCache = new Map<string, vm.Script>();

/**
 * Modules that have dedicated native-import coverage tests.
 * IIFE loads for these modules default to coverable: false to prevent
 * ast-v8-to-istanbul merge corruption between IIFE and native coverage data.
 */
const NATIVE_COVERAGE_MODULES = new Set(['analytics', 'common', 'mixpanel']);

/**
 * Load an IIFE module by executing its pre-compiled source in the current global context.
 *
 * Reads output from .cache/ (built by globalSetup prebuild.js using
 * esbuild.buildSync with inline sourcemap for v8 coverage).
 *
 * @param moduleName - e.g. 'common', 'analytics', 'ecommerce'
 * @param options.coverable - When true, V8 coverage maps to the
 *   original TypeScript source. Set to false to use the cache path as filename,
 *   excluding this evaluation from source-level coverage. Defaults to false for
 *   modules in NATIVE_COVERAGE_MODULES, true for all others.
 */
export function loadModule(moduleName, { coverable }: { coverable?: boolean } = {}) {
  const effectiveCoverable = coverable !== undefined ? coverable : !NATIVE_COVERAGE_MODULES.has(moduleName);
  const cacheKey = `${moduleName}:${effectiveCoverable}`;
  if (!scriptCache.has(cacheKey)) {
    const cachedPath = path.resolve(cacheDir, moduleName + '.js');
    const tsPath = path.resolve(__dirname, '../../src', moduleName, 'index.ts');
    const code = readFileSync(cachedPath, 'utf-8');
    scriptCache.set(cacheKey, new vm.Script(code, { filename: effectiveCoverable ? tsPath : cachedPath }));
  }
  scriptCache.get(cacheKey)!.runInThisContext();
}

/**
 * Load common first, then the specified child module.
 * The coverable option applies only to the child module, not common.
 */
export function loadWithCommon(moduleName, opts?: { coverable?: boolean }) {
  loadModule('common');
  loadModule(moduleName, opts);
}
