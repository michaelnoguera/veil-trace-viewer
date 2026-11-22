# Veil trace viewer

Shows the result of a [Veil](https://github.com/verse-lab/veil) model check
in a browser, without VS Code. The trace is drawn by Veil's own component
(`widget/src/traceDisplay.tsx`), the one that the Lean infoview and the Veil
VS Code extension use.

## Use

**In a browser.** Open `index.html`. Drop a result on the page, or use
"Open JSON…". The page reads:

- the JSON that a compiled model checker prints on stdout;
- a result exported from the Veil VS Code extension.

"Save as HTML" writes a copy of the page with the result inside it.

**From the command line.**

```sh
./veil-trace.py Model.lean          # build and run each #model_check, write Model.html
./veil-trace.py result.json         # write result.html from a result
./veil-trace.py Model.lean --json   # keep the JSON of the result too
./veil-trace.py Model.lean --open   # open the page in the browser
```

For a `.lean` file, the script finds the Lake project of the file and needs
`lake` on the `PATH`. Each page is one file that needs no server and no
network.

## As a static site

`index.html` is the whole site: one file, with its script and styles inside
it. Any static host can serve it. People open their own result files in the
page. The browser reads each file from the disk of that person; the server
never gets it, and the site keeps no results.

A host that forbids inline scripts with its own Content-Security-Policy
header cannot serve the page as it is.

## Security

A result file can come from anywhere, so the page treats it as data only.

- The page shows the values of a result as text. No part of a result becomes
  HTML or script.
- The page has a Content-Security-Policy (a `meta` element in `index.html`):

  | Directive | Effect |
  | --- | --- |
  | `default-src 'none'` | No request to any server: no fetch, image, font, frame or worker. The page cannot send a result, or anything else, to another place. |
  | `script-src 'sha256-…'` | Only the script of the page runs, by its hash. No other inline script, no script from a URL, no event-handler attribute. |
  | `style-src 'unsafe-inline'` | Inline styles only. Veil's display adds its styles while it runs, so they cannot have a hash. |
  | `base-uri 'none'`, `form-action 'none'` | No change of the base URL, no form submission. |

- The page does not read or write cookies, `localStorage` or other storage.
- "Save as HTML" and `veil-trace.py` keep the policy and the script without
  change, so the hash is correct in the pages that they write.

Limits:

- A `meta` element cannot set the `sandbox` or `frame-ancestors` directives.
  Thus the script of the page itself is not cut off from the cookies of its
  site by the policy; it only does not use them. To make that impossible,
  serve the page from an origin of its own, or let the host send the header
  `Content-Security-Policy: sandbox allow-scripts allow-downloads`. That
  header is not tested here.
- The policy has no effect on what a person does with a file after "Save as
  HTML".

## Build

`index.html` is generated. To build it again:

```sh
git submodule update --init     # once: Veil's sources, in ./veil
npm install                     # once
node build.mjs
```

Veil is a git submodule in `veil/`, at the revision that `index.html` was
built from. The build uses its widget sources (`veil/widget/src`) and the
stub of its VS Code extension (`veil/editors/vscode/webview`), and follows
the build of that extension (`veil/editors/vscode/esbuild.mjs`). For a newer
Veil, check out that revision in `veil/` and build again. `VEIL_DIR` gives
another Veil checkout than the submodule.

The build puts the hash of the script in the policy. Do not edit the script
in `index.html` by hand: the page then stops with an empty window.

- `src/standalone.tsx`: the page around Veil's component (open, save).
- `src/template.html`: the HTML and the colours. Veil's component uses the
  colours of the VS Code theme, so the template gives the values of the
  default light and dark themes.

## Licenses

`index.html` contains code of Veil (Apache-2.0) and of React (MIT).
