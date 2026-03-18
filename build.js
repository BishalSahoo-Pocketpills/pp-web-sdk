const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

const MODULES = require('./modules');
const PKG_VERSION = require('./package.json').version;
const isDev = process.argv.includes('--dev');

function findFiles(dir, ext) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

const cssFiles = findFiles(srcDir, '.css');

async function build() {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  for (const moduleName of MODULES) {
    const entryPoint = path.join(srcDir, moduleName, 'index.ts');

    await esbuild.build({
      entryPoints: [entryPoint],
      outfile: path.join(distDir, moduleName + '.min.js'),
      bundle: true,
      format: 'iife',
      minify: !isDev,
      sourcemap: isDev ? 'linked' : false,
      target: ['es2018'],
      charset: 'utf8',
      define: { '__PP_SDK_VERSION__': JSON.stringify(PKG_VERSION) },
    });

    console.log('Built: dist/' + moduleName + '.min.js');
  }

  for (const file of cssFiles) {
    const name = path.basename(path.dirname(file));

    await esbuild.build({
      entryPoints: [file],
      outfile: path.join(distDir, name + '.min.css'),
      bundle: false,
      minify: true,
    });

    console.log('Built: dist/' + name + '.min.css');
  }

  // Copy _headers file for Cloudflare Pages (if exists)
  const headersFile = path.join(__dirname, '_headers');
  if (fs.existsSync(headersFile)) {
    fs.copyFileSync(headersFile, path.join(distDir, '_headers'));
    console.log('Copied: _headers');
  }

  console.log('\nAll modules built successfully.');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
