/**
 * Pre-build TypeScript IIFE modules for testing.
 *
 * Runs as a vitest globalSetup script in the main Node.js process (no jsdom),
 * so esbuild's TextEncoder invariant check passes. Writes compiled output
 * to a .cache directory that iife-loader.js reads at test time.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const cacheDir = path.resolve(rootDir, '.cache');
const srcDir = path.resolve(rootDir, 'src');

const require = createRequire(import.meta.url);

const MODULES: string[] = require(path.resolve(rootDir, 'modules'));
const PKG_VERSION: string = require(path.resolve(rootDir, 'package.json')).version;

export function setup() {
  const esbuild = require('esbuild');

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  function buildOne(entryPath: string, outName: string): void {
    const result = esbuild.buildSync({
      entryPoints: [entryPath],
      bundle: true,
      format: 'iife',
      write: false,
      sourcemap: 'inline',
      target: ['es2018'],
      charset: 'utf8',
      legalComments: 'inline',
      define: { '__PP_SDK_VERSION__': JSON.stringify(PKG_VERSION) },
    });
    writeFileSync(path.resolve(cacheDir, outName + '.js'), result.outputFiles[0].text);
  }

  for (const moduleName of MODULES) {
    const tsPath = path.resolve(srcDir, moduleName, 'index.ts');
    if (!existsSync(tsPath)) continue;
    buildOne(tsPath, moduleName);
  }

  // Standalone top-level scripts (no module directory, embedded directly as
  // <script> tags rather than wired into ppLib). Listed explicitly so the
  // build stays explicit about its surface.
  const STANDALONE: Array<{ src: string; out: string }> = [
    { src: 'febpt-variant.ts', out: 'febpt-variant' }
  ];
  for (const entry of STANDALONE) {
    const tsPath = path.resolve(srcDir, entry.src);
    if (existsSync(tsPath)) buildOne(tsPath, entry.out);
  }
}
