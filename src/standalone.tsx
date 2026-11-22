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

function App() {
  const first = React.useMemo(readEmbedded, []);
  const [loaded, setLoaded] = React.useState<Loaded | null>(first instanceof Error ? null : first);
  const [error, setError] = React.useState<string | null>(first instanceof Error ? first.message : null);
  const [layout, setLayout] = React.useState<'vertical' | 'horizontal'>('vertical');
  const [over, setOver] = React.useState(false);

  const read = React.useCallback((file: File) => {
    file.text().then(text => {
      try {
        setLoaded(normalize(JSON.parse(text), file.name.replace(/\.json$/i, '')));
        setError(null);
      } catch (e) {
        setLoaded(null);
        setError(`${file.name}: ${(e as Error).message}`);
      }
    });
  }, []);

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
        <button
          disabled={!loaded}
          onClick={() => loaded && download(`${(loaded.name || 'veil-trace').replace(/[^\w.-]+/g, '_')}.html`, pageWith(loaded))}
        >
          Save as HTML
        </button>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {loaded?.notes.map(note => <div className="note" key={note}>{note}</div>)}
        {loaded
          ? <ModelCheckerView result={loaded.result} layout={layout} />
          : (
            <div className={over ? 'empty over' : 'empty'}>
              <p>Drop a Veil model-checking result here, or use “Open JSON…”.</p>
              <p>It can be the JSON that a compiled checker prints, or a result exported from the Veil VS Code extension.</p>
            </div>
          )}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
