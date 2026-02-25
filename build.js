const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

const jsFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));
const cssFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.css'));

const isWatch = process.argv.includes('--watch');

async function build() {
  // Ensure dist/ exists
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  for (const file of jsFiles) {
    const name = path.basename(file, '.js');

    await esbuild.build({
      entryPoints: [path.join(srcDir, file)],
      outfile: path.join(distDir, name + '.min.js'),
      bundle: false,
      minify: true,
      target: ['es2018'],
      charset: 'utf8',
    });

    console.log('Built: dist/' + name + '.min.js');
  }

  for (const file of cssFiles) {
    const name = path.basename(file, '.css');

    await esbuild.build({
      entryPoints: [path.join(srcDir, file)],
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
