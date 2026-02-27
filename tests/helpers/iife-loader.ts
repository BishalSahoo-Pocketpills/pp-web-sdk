import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const cacheDir = path.resolve(rootDir, '.cache');

/**
 * Load an IIFE module by executing its pre-compiled source in the current global context.
 *
 * Reads output from .cache/ (built by globalSetup prebuild.js using
 * esbuild.buildSync with inline sourcemap for v8 coverage).
 *
 * @param {string} moduleName - e.g. 'common', 'analytics', 'ecommerce'
 */
export function loadModule(moduleName) {
  const cachedPath = path.resolve(cacheDir, moduleName + '.js');
  const tsPath = path.resolve(__dirname, '../../src', moduleName, 'index.ts');

  const code = readFileSync(cachedPath, 'utf-8');
  vm.runInThisContext(code, { filename: tsPath });
}

/**
 * Load common first, then the specified child module.
 */
export function loadWithCommon(moduleName) {
  loadModule('common');
  loadModule(moduleName);
}
