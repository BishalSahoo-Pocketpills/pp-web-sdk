const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

const isWatch = process.argv.includes('--watch');

async function build() {
  for (const file of files) {
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

  console.log('\nAll modules built successfully.');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
