// Builds index.html: one HTML file that holds Veil's trace display, React,
// and the small page around them (src/standalone.tsx, src/template.html).
//
//   git submodule update --init      (once: Veil's sources, in ./veil)
//   npm install                      (once)
//   node build.mjs
//
// It bundles Veil's widget sources as Veil's VS Code extension does
// (editors/vscode/esbuild.mjs in the Veil repository). Environment:
//   VEIL_DIR  another Veil checkout than the submodule ./veil, for example
//             .lake/packages/veil of a Lake project that uses Veil
//   OUT       the file to write  (default: ./index.html)
import * as esbuild from 'esbuild';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const veil = path.resolve(process.env.VEIL_DIR ?? path.join(here, 'veil'));
const out = path.resolve(process.env.OUT ?? path.join(here, 'index.html'));
const widgetSources = path.join(veil, 'widget/src');
const htmlStub = path.join(veil, 'editors/vscode/webview/htmlDisplayStub.tsx');
for (const needed of [path.join(widgetSources, 'traceDisplay.tsx'), htmlStub]) {
  if (!existsSync(needed)) {
    console.error(`${needed} does not exist.\nRun "git submodule update --init", or set VEIL_DIR to a Veil checkout.`);
    process.exit(1);
  }
}

/** The same three rules as the plugin of Veil's extension: its widgets by name, Veil's stub for
 * the part that needs a Lean server, and one copy of React. */
const widgets = {
  name: 'veil-widgets',
  setup(build) {
    build.onResolve({ filter: /^@veil\/widget\// }, args =>
      ({ path: path.join(widgetSources, `${args.path.slice('@veil/widget/'.length)}.tsx`) }));
    build.onResolve({ filter: /^\.\/htmlDisplay$/ }, args =>
      args.importer.startsWith(widgetSources) ? { path: htmlStub } : undefined);
    build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, args => ({ path: require.resolve(args.path) }));
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(here, 'src/standalone.tsx')],
  bundle: true,
  write: false,
  minify: true,
  legalComments: 'none',
  jsx: 'automatic',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [widgets],
  logLevel: 'info',
});

let revision = 'unknown';
try {
  revision = execFileSync('git', ['-C', veil, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // Not a git checkout
}

// "</script" inside the bundle would end the script element.
const bundle = `/* Veil ${revision} */\n${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}`;
const template = readFileSync(path.join(here, 'src/template.html'), 'utf8');
for (const mark of ['/*__BUNDLE__*/', "'__SCRIPT_HASH__'"]) {
  if (template.split(mark).length !== 2) throw new Error(`template.html must have ${mark} one time`);
}
// The security policy of the page permits only this script, by its hash. The hash is of the
// text between the script tags, so the template must not add a character there.
const hash = createHash('sha256').update(bundle, 'utf8').digest('base64');
writeFileSync(out, template
  .replace("'__SCRIPT_HASH__'", () => `'sha256-${hash}'`)
  .replace('/*__BUNDLE__*/', () => bundle));
console.log(`Wrote ${out} (${Math.round(bundle.length / 1024)} kB of script, Veil ${revision})`);
