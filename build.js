const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

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

const jsFiles = findFiles(srcDir, '.js');
const cssFiles = findFiles(srcDir, '.css');

const isWatch = process.argv.includes('--watch');

async function build() {
  // Ensure dist/ exists
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  for (const file of jsFiles) {
    const name = path.basename(path.dirname(file));

    await esbuild.build({
      entryPoints: [file],
      outfile: path.join(distDir, name + '.min.js'),
      bundle: false,
      minify: true,
      target: ['es2018'],
      charset: 'utf8',
    });

    console.log('Built: dist/' + name + '.min.js');
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
