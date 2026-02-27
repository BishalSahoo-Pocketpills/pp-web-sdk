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

export function setup() {
  const esbuild = require('esbuild');

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  for (const moduleName of MODULES) {
    const tsPath = path.resolve(srcDir, moduleName, 'index.ts');
    if (!existsSync(tsPath)) continue;

    const result = esbuild.buildSync({
      entryPoints: [tsPath],
      bundle: true,
      format: 'iife',
      write: false,
      sourcemap: 'inline',
      target: ['es2018'],
      charset: 'utf8',
      legalComments: 'inline',
    });

    writeFileSync(path.resolve(cacheDir, moduleName + '.js'), result.outputFiles[0].text);
  }
}
