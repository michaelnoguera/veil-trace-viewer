// A page that shows the result of a Veil model check outside VS Code.
//
// The result is drawn by `ModelCheckerView` from Veil's own sources
// (`widget/src/traceDisplay.tsx`): the component that the Lean infoview and
// the Veil VS Code extension use. This file adds only what a browser page
// needs around it: a result inside the page, "Open JSON", and "Save as HTML".
import ModelCheckerView from '@veil/widget/traceDisplay';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

interface Loaded {
  /** A name for the title, e.g. the module */
  name: string;
  /** The JSON as it was given, which "Save as HTML" keeps */
  raw: unknown;
  /** The JSON of the result, as the checker printed it */
  result: Record<string, unknown>;
  notes: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accept the stdout of a checker, an export of the VS Code extension, or the wrapper of this page. */
function normalize(obj: unknown, fallbackName: string): Loaded {
  if (!isObject(obj)) throw new Error('The file does not hold a JSON object.');
  if (obj.veilTraceViewer && obj.data !== undefined) {
    return { ...normalize(obj.data, String(obj.name ?? fallbackName)), raw: obj.data };
  }
  let name = fallbackName;
  const notes: string[] = [];
  let result: unknown = obj;
  if (isObject(obj.run)) {
    const run = obj.run;
    if (typeof run.module === 'string') name = run.module;
    if (isObject(obj.source) && typeof obj.source.command === 'string') notes.push(obj.source.command);
    if (typeof run.error === 'string') notes.push(`Error: ${run.error}`);
    if (!isObject(run.result)) throw new Error(`This run has no result (status: ${String(run.status ?? 'unknown')}).`);
    result = run.result;
  }
  if (!isObject(result) || typeof result.result !== 'string') {
    throw new Error('This is not a Veil model-checking result: it has no "result" field.');
  }
  return { name, raw: obj, result, notes };
}

function readEmbedded(): Loaded | Error | null {
  const text = document.getElementById('veil-data')?.textContent?.trim();
  if (!text) return null;
  try {
    return normalize(JSON.parse(text), '');
  } catch (e) {
    return new Error(`The result inside this page cannot be read: ${(e as Error).message}`);
  }
}

/** A copy of this page with the result inside it */
function pageWith(loaded: Loaded): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector('#root')!.replaceChildren();
  // Styles that the page added while it ran come back when the copy runs.
  clone.querySelectorAll('head style:not([data-static])').forEach(s => s.remove());
  const payload = JSON.stringify({ veilTraceViewer: 1, name: loaded.name, data: loaded.raw });
  // "<" as an escape, so that the JSON cannot end the script element.
  clone.querySelector('#veil-data')!.textContent = payload.replace(/</g, '\\u003c');
  return `<!doctype html>\n${clone.outerHTML}\n`;
}

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** A link on its own, rather than JSON */
const isLink = (text: string): boolean => /^https?:\/\/\S+$/i.test(text.trim());

/** The parameter that names a result to load: index.html?url=… */
const LINK_PARAM = 'url';

async function get(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new Error(`The request to ${new URL(url).host} failed. The server may be down, or it may not let other sites read the file (CORS).`);
  }
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`);
  return res;
}

interface GistFile { filename?: string; raw_url?: string; content?: string; truncated?: boolean }

/** Fetch the result that a link names. A gist page is read through GitHub's API, a GitHub
 * file page through its raw file; any other link is fetched as it is. */
async function fetchLink(link: string): Promise<{ text: string; name: string }> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error('This is not a valid link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https links can be loaded.');
  const base = (path: string) => decodeURIComponent(path.split('/').pop() ?? '').replace(/\.json$/i, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (url.hostname === 'gist.github.com') {
    const id = parts.find(p => /^[0-9a-f]{20,}$/i.test(p));
    if (!id) throw new Error('This gist link has no gist id.');
    const meta = await (await get(`https://api.github.com/gists/${id}`)).json();
    const files = Object.values((meta?.files ?? {}) as Record<string, GistFile>);
    // "#file-name-json" on a gist page points at one file.
    const anchored = url.hash.startsWith('#file-')
      ? files.find(f => `#file-${(f.filename ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}` === url.hash.toLowerCase())
      : undefined;
    const file = anchored ?? files.find(f => /\.json$/i.test(f.filename ?? '')) ?? files[0];
    if (!file) throw new Error('This gist has no files.');
    const name = base(file.filename ?? id);
    if (typeof file.content === 'string' && !file.truncated) return { text: file.content, name };
    if (!file.raw_url) throw new Error('GitHub gave no address for the file of this gist.');
    return { text: await (await get(file.raw_url)).text(), name };
  }
  if (url.hostname === 'github.com' && parts[2] === 'blob' && parts.length > 4) {
    const [owner, repo, , ...rest] = parts;
    url = new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${rest.join('/')}`);
  }
  return { text: await (await get(url.href)).text(), name: base(url.pathname) };
}

/** Put `link` in the address of the page, or take it out, so that the address can be shared. */
function setLinkParam(link: string | null): void {
  try {
    const url = new URL(location.href);
    if (link) url.searchParams.set(LINK_PARAM, link);
    else url.searchParams.delete(LINK_PARAM);
    if (url.href !== location.href) history.replaceState(null, '', url.href);
  } catch {
    // A page opened from the disk may not allow it.
  }
}

function App() {
  const first = React.useMemo(readEmbedded, []);
  const [loaded, setLoaded] = React.useState<Loaded | null>(first instanceof Error ? null : first);
  const [error, setError] = React.useState<string | null>(first instanceof Error ? first.message : null);
  const [layout, setLayout] = React.useState<'vertical' | 'horizontal'>('vertical');
  const [over, setOver] = React.useState(false);

  const [pasting, setPasting] = React.useState(false);
  const [pasted, setPasted] = React.useState('');

  /** Show the result in `text`; on failure, keep what is shown and report `label` with the error. */
  const show = React.useCallback((text: string, name: string, label: string): boolean => {
    try {
      setLoaded(normalize(JSON.parse(text), name));
      setError(null);
      return true;
    } catch (e) {
      setError(`${label}: ${(e as Error).message}`);
      return false;
    }
  }, []);

  // A link in the address of the page (?url=) is loaded only after the person agrees.
  const [pending, setPending] = React.useState<string | null>(() =>
    first ? null : new URLSearchParams(location.search).get(LINK_PARAM));
  const [busy, setBusy] = React.useState<string | null>(null);
  // Only the latest load shows its result.
  const generation = React.useRef(0);

  const read = React.useCallback((file: File) => {
    const mine = ++generation.current;
    setBusy(null);
    file.text().then(text => {
      if (mine !== generation.current) return;
      if (show(text, file.name.replace(/\.json$/i, ''), file.name)) { setPasting(false); setLinkParam(null); }
    });
  }, [show]);

  const loadLink = React.useCallback((link: string) => {
    const mine = ++generation.current;
    setPending(null);
    setBusy(link);
    fetchLink(link).then(
      ({ text, name }) => {
        if (mine !== generation.current) return;
        if (show(text, name, link)) { setPasting(false); setPasted(''); setLinkParam(link); }
      },
      e => { if (mine === generation.current) setError(`${link}: ${(e as Error).message}`); },
    ).finally(() => { if (mine === generation.current) setBusy(null); });
  }, [show]);

  /** Pasted text: a link to load, or the JSON of a result */
  const take = React.useCallback((text: string): boolean => {
    if (isLink(text)) { loadLink(text.trim()); return false; }
    ++generation.current;
    setBusy(null);
    const ok = show(text, '', 'Pasted text');
    if (ok) { setPasting(false); setLinkParam(null); }
    return ok;
  }, [show, loadLink]);

  const showPasted = () => { if (take(pasted)) setPasted(''); };

  // Paste anywhere on the page, outside a text field, shows the pasted result.
  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable]')) return;
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (!text) return;
      e.preventDefault();
      take(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [take]);

  React.useEffect(() => {
    document.title = loaded?.name ? `${loaded.name} — Veil trace` : 'Veil trace viewer';
  }, [loaded]);

  React.useEffect(() => {
    const onOver = (e: DragEvent) => { e.preventDefault(); setOver(true); };
    const onLeave = () => setOver(false);
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) read(file);
    };
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [read]);

  return (
    <>
      <header className="bar">
        <h1>Veil trace viewer</h1>
        {loaded?.name && <span className="name">{loaded.name}</span>}
        <span className="spacer" />
        {loaded && (
          <label className="pick">
            Layout{' '}
            <select value={layout} onChange={e => setLayout(e.target.value as 'vertical' | 'horizontal')}>
              <option value="vertical">vertical</option>
              <option value="horizontal">horizontal</option>
            </select>
          </label>
        )}
        <label className="btn">
          Open JSON…
          <input
            type="file"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) read(file);
              e.target.value = '';
            }}
          />
        </label>
        <button aria-expanded={pasting} onClick={() => setPasting(p => !p)}>Paste JSON…</button>
        <button
          disabled={!loaded}
          onClick={() => loaded && download(`${(loaded.name || 'veil-trace').replace(/[^\w.-]+/g, '_')}.html`, pageWith(loaded))}
        >
          Save as HTML
        </button>
      </header>
      <main>
        {pending && (
          <div className="confirm" role="alertdialog" aria-label="Load the linked result?">
            <p>
              This page was opened with a link to a result on{' '}
              <strong className="host">{(() => { try { return new URL(pending).host; } catch { return 'an unknown server'; } })()}</strong>:
            </p>
            <p><code>{pending}</code></p>
            <p>
              Load it only if you trust the person who sent you this page.
            </p>
            <div className="actions">
              <button onClick={() => { setPending(null); setLinkParam(null); }}>Don’t load</button>
              <button className="primary" autoFocus onClick={() => loadLink(pending)}>Load</button>
            </div>
          </div>
        )}
        {busy && <div className="note">Loading {busy}…</div>}
        {pasting && (
          <div className="paste">
            <textarea
              autoFocus
              spellCheck={false}
              aria-label="JSON of a Veil model-checking result, or a link to one"
              placeholder="Paste the JSON of a result, or a link to one: a gist, a file on GitHub, or any URL."
              value={pasted}
              onChange={e => setPasted(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) showPasted(); }}
            />
            <div className="actions">
              <button onClick={() => { setPasting(false); setPasted(''); }}>Cancel</button>
              <button className="primary" disabled={!pasted.trim()} onClick={showPasted}>Show</button>
            </div>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        {loaded?.notes.map(note => <div className="note" key={note}>{note}</div>)}
        {loaded
          ? <ModelCheckerView result={loaded.result} layout={layout} />
          : (
            <div className={over ? 'empty over' : 'empty'}>
              <p>Drop a Veil model-checking result here, paste it or a link to it, or use “Open JSON…”.</p>
              <p>It can be the JSON that a compiled checker prints, or a result exported from the Veil VS Code extension.</p>
            </div>
          )}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
