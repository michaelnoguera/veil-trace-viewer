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
  metafile: true,
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
for (const mark of ['/*__BUNDLE__*/', "'__SCRIPT_HASH__'", '<!--__NOTICES__-->']) {
  if (template.split(mark).length !== 2) throw new Error(`template.html must have ${mark} one time`);
}
// The security policy of the page permits only this script, by its hash. The hash is of the
// text between the script tags, so the template must not add a character there.
const hash = createHash('sha256').update(bundle, 'utf8').digest('base64');

// The licences of what the bundle holds, which the page must carry: this viewer, Veil, and each
// npm package that esbuild put in the bundle, with packages of the same licence text together.
function licenseText(dir) {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE']) {
    const file = path.join(dir, name);
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  }
  throw new Error(`${dir} has no LICENSE file`);
}
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (!match || packages.has(match[1])) continue;
  const dir = path.dirname(require.resolve(`${match[1]}/package.json`));
  packages.set(match[1], { version: JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version, text: licenseText(dir) });
}
// Each licence text once, after the names of everything under it.
const byText = new Map();
const add = (what, text) => byText.set(text, [...(byText.get(text) ?? []), what]);
add('Veil Trace Viewer, https://github.com/michaelnoguera/veil-trace-viewer\nCopyright 2026 Michael Noguera', licenseText(here));
add(`Veil, https://github.com/verse-lab/veil, revision ${revision}: widget/src and editors/vscode/webview`, licenseText(veil));
for (const [name, { version, text }] of [...packages].sort()) add(`${name} ${version}`, text);
const notices = [...byText]
  .map(([text, names]) => `${names.join('\n\n')}\n\n${text}`)
  .join('\n\n' + '='.repeat(78) + '\n\n');
// An HTML comment ends at "--" followed by ">", and should not hold "--" at all.
if (notices.includes('--')) throw new Error('A licence text has "--", which cannot be in an HTML comment.');
const noticeComment = `<!--\nLicences of this page and of the software bundled in it.\n\n${notices}\n-->`;

writeFileSync(out, template
  .replace("'__SCRIPT_HASH__'", () => `'sha256-${hash}'`)
  .replace('<!--__NOTICES__-->', () => noticeComment)
  .replace('/*__BUNDLE__*/', () => bundle));
console.log(`Wrote ${out} (${Math.round(bundle.length / 1024)} kB of script, Veil ${revision}; licences of ${[...packages.keys()].join(', ')})`);
