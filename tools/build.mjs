// Build script.
//   node tools/build.mjs --engine-only   compile the engine to build/engine (used by the tests)
//   node tools/build.mjs                 also build the web application into docs/, the folder GitHub Pages serves
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = name => join(root, 'node_modules', '.bin', name);

execFileSync(bin('tsc'), ['-p', root], { stdio: 'inherit' });
if (process.argv.includes('--engine-only')) process.exit(0);

const { build } = await import('esbuild');
const site = join(root, 'docs');
rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
// GitHub Pages publishes the folder as it is when this file is present.
writeFileSync(join(site, '.nojekyll'), '');

await build({
  entryPoints: [join(root, 'app', 'main.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(site, 'app.js'),
  logLevel: 'warning'
});
cpSync(join(root, 'app', 'styles.css'), join(site, 'styles.css'));
cpSync(join(root, 'app', 'index.html'), join(site, 'index.html'));
if (existsSync(join(root, 'app', 'examples'))) cpSync(join(root, 'app', 'examples'), join(site, 'examples'), { recursive: true });

// A single self-contained page as well, for opening straight from disk.
const examples = {};
const examplesDir = join(root, 'app', 'examples');
if (existsSync(examplesDir)) {
  readdirSync(examplesDir).filter(name => name.endsWith('.json')).forEach(name => {
    examples[name] = JSON.parse(readFileSync(join(examplesDir, name), 'utf8'));
  });
}
const html = readFileSync(join(root, 'app', 'index.html'), 'utf8');
const css = readFileSync(join(site, 'styles.css'), 'utf8');
const js = readFileSync(join(site, 'app.js'), 'utf8').replace(/<\/script/g, '<\\/script');
const single = html
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="app.js"></script>', () =>
    `<script>window.ACWAVERSE_EXAMPLES = ${JSON.stringify(examples).replace(/</g, '\\u003c')};</script>\n<script type="module">\n${js}\n</script>`);
writeFileSync(join(site, 'acwaverse.html'), single);
console.log('Built docs/ (index.html, app.js, styles.css, examples/, acwaverse.html)');
