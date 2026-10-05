import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  MarkupEditor,
  MarkupFeatures,
  MarkupFeaturesError,
  VERSION,
  type MarkupAssets,
  type MarkupDocument,
  type MarkupEditorHandle,
  type MarkupEditorState,
  type MarkupError,
  type MarkupExportOptions,
  type MarkupImageInput,
  type MarkupLocale,
  type MarkupResult,
} from 'image-markup-kit';

// A host page for the editor: open sample photos or your own, try the options, and look at what Done returns.
// The editor sits in a modal that closes on Escape, as host dialogs do; the editor keeps its own Escape presses.

interface Sample {
  readonly file: string;
  readonly label: string;
  readonly author: string;
  readonly source: string;
}

const SAMPLES: readonly Sample[] = [
  {
    file: 'mountains-dusk.jpg',
    label: 'Mountains at dusk',
    author: 'Nathan Anderson (via Unsplash)',
    source: 'https://commons.wikimedia.org/wiki/File:Clouds_over_Silverthorne_mountains_(Unsplash).jpg',
  },
  {
    file: 'old-town-snow.jpg',
    label: 'Gamla Stan in the snow',
    author: 'Leonhard Lenz',
    source:
      'https://commons.wikimedia.org/wiki/File:K%C3%B6pmanbrinken_Gamla_stan_Stadslager_Stockholm_2026-01-02_01.jpg',
  },
  {
    file: 'waterfall.jpg',
    label: 'Waterfall',
    author: 'Jeffrey Workman (via Unsplash)',
    source: 'https://commons.wikimedia.org/wiki/File:Peaceful_waterfall_(Unsplash).jpg',
  },
  {
    file: 'mountain-hut.jpg',
    label: 'Mountain hut',
    author: 'Ajznponar',
    source: 'https://commons.wikimedia.org/wiki/File:Mala_gora,_mountain_hut.jpg',
  },
  {
    file: 'mountain-hut-exif6.jpg',
    label: 'Mountain hut (EXIF orientation 6)',
    author: 'Ajznponar',
    source: 'https://commons.wikimedia.org/wiki/File:Mala_gora,_mountain_hut.jpg',
  },
  {
    file: 'mossy-trees.jpg',
    label: 'Mossy trees',
    author: 'Jacob Copus (via Unsplash)',
    source: 'https://commons.wikimedia.org/wiki/File:Mossy_trees_near_Lake_Alpine_(Unsplash).jpg',
  },
];

type Frame = 'fill' | 'phone' | 'tablet';

const FRAMES: Readonly<Record<Frame, { readonly label: string; readonly width?: number; readonly height?: number }>> = {
  fill: { label: 'Fill the window' },
  phone: { label: 'Phone (390 × 844)', width: 390, height: 844 },
  tablet: { label: 'Tablet (1024 × 768)', width: 1024, height: 768 },
};

type Input =
  | { readonly kind: 'image'; readonly image: MarkupImageInput }
  | { readonly kind: 'images'; readonly images: readonly MarkupImageInput[] }
  | { readonly kind: 'document'; readonly document: MarkupDocument; readonly assets: MarkupAssets };

interface Saved {
  readonly document: MarkupDocument;
  readonly assets: MarkupAssets;
}

declare global {
  interface Window {
    /** The open editor, for end-to-end tests. */
    markupEditor?: MarkupEditorHandle | null;
    /** What the last Done returned, for end-to-end tests. */
    markupResult?: MarkupResult | null;
  }
}

async function loadSample(file: string): Promise<Blob> {
  const response = await fetch(`./samples/${file}`);
  if (!response.ok) throw new Error(`Could not load ${file}`);
  return response.blob();
}

function bytes(size: number): string {
  return size >= 1_000_000 ? `${(size / 1_000_000).toFixed(2)} MB` : `${Math.round(size / 1000)} kB`;
}

function useObjectURL(blob: Blob | null): string | null {
  const [url, setURL] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return undefined;
    const created = URL.createObjectURL(blob);
    const frame = requestAnimationFrame(() => setURL(created));
    return () => {
      cancelAnimationFrame(frame);
      URL.revokeObjectURL(created);
    };
  }, [blob]);
  return blob ? url : null;
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Links that open the editor right away, for screenshots and devices without automation:
 * `?open=waterfall.jpg`, `?board=a.jpg,b.jpg`, `&locale=ja`, `&frame=phone`, `&demo=1` (adds markup) and
 * `&panel=shapeStyle` (opens a style panel).
 */
const LINK = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
/** The scripted markup of a link runs once per page load. */
let demoStarted = false;

/** Marks up the open document like a person would, through the editor's scripted gestures. */
function runDemo(handle: MarkupEditorHandle, locale: MarkupLocale, panel: string | null): void {
  const document = handle.getDocument();
  const photo = document?.items[0];
  if (!document || photo?.type !== 'image') return;
  const { x, y, width, height } = photo.content.box.frame;
  const at = (u: number, v: number) => ({ x: x + width * u, y: y + height * v });
  const debug = handle.debug;
  debug.perform({ type: 'draw', tool: 'oval', points: [at(0.18, 0.5), at(0.42, 0.75)] });
  debug.perform({ type: 'draw', tool: 'arrow', points: [at(0.62, 0.22), at(0.47, 0.5)] });
  // Picking a tool ends the text being typed, as a tap elsewhere would.
  debug.perform({ type: 'taps', tool: 'text', points: [at(0.6, 0.12)] });
  debug.typeText(locale === 'ja' ? '山小屋 6:00 出発' : 'Summit 2,456 m');
  handle.setTool('select');
  debug.perform({ type: 'taps', tool: 'note', points: [at(0.08, 0.1)] });
  debug.typeText(locale === 'ja' ? '夏の旅行・3か所' : 'Best view!');
  handle.setTool('select');
  debug.perform({ type: 'draw', tool: 'highlighter', points: [at(0.55, 0.85), at(0.7, 0.86), at(0.85, 0.85)] });
  handle.setTool('select');
  handle.setSelectedItemIDs([handle.getDocument()!.items[1]!.id]);
  if (panel === 'shapeStyle' || panel === 'borderColor' || panel === 'fillColor' || panel === 'textStyle') {
    debug.presentPanel(panel);
  }
}

export function App(): ReactElement {
  const [locale, setLocale] = useState<MarkupLocale>(() => (LINK.get('locale') === 'ja' ? 'ja' : 'en'));
  const [frame, setFrame] = useState<Frame>(() => {
    const value = LINK.get('frame');
    return value === 'phone' || value === 'tablet' ? value : 'fill';
  });
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [maxBytes, setMaxBytes] = useState('');
  const [includePackage, setIncludePackage] = useState(true);
  const [featuresJSON, setFeaturesJSON] = useState(() => MarkupFeatures.all.toJSONString());
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [input, setInput] = useState<Input | null>(null);
  const [session, setSession] = useState(0);
  const [result, setResult] = useState<MarkupResult | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [state, setState] = useState<MarkupEditorState | null>(null);
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const files = useRef<HTMLInputElement>(null);

  const features = useMemo((): { value: MarkupFeatures; error: string | null } => {
    try {
      return { value: MarkupFeatures.fromJSON(featuresJSON), error: null };
    } catch (error) {
      const message = error instanceof MarkupFeaturesError ? `${error.kind} at ${error.path}` : String(error);
      return { value: MarkupFeatures.all, error: message };
    }
  }, [featuresJSON]);

  const exportOptions = useMemo((): MarkupExportOptions => {
    const limit = Number(maxBytes);
    return {
      format:
        format === 'png'
          ? { type: 'png' }
          : { type: 'jpeg', quality: 0.85, ...(limit > 0 ? { maxBytes: limit, fallbackQualities: [0.75, 0.6] } : {}) },
    };
  }, [format, maxBytes]);

  // A host dialog closes on Escape; presses the editor handles never get here.
  useEffect(() => {
    if (!input) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInput(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [input]);

  const open = (next: Input) => {
    setResult(null);
    setState(null);
    setSession((value) => value + 1);
    setInput(next);
  };

  const openSamples = async (names: readonly string[]) => {
    setBusy(true);
    try {
      const blobs = await Promise.all(names.map(loadSample));
      open({ kind: 'images', images: blobs });
    } finally {
      setBusy(false);
    }
  };

  const say = (message: string) => setMessages((current) => [...current.slice(-4), message]);

  // Links that open the editor at once (see LINK).
  useEffect(() => {
    const single = LINK.get('open');
    const board = LINK.get('board')?.split(',').filter(Boolean) ?? [];
    if (!single && board.length === 0) return undefined;
    let cancelled = false;
    void Promise.all((single ? [single] : board).map(loadSample)).then((blobs) => {
      if (cancelled) return;
      setSession((value) => value + 1);
      setInput(single ? { kind: 'image', image: blobs[0]! } : { kind: 'images', images: blobs });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const demo = LINK.get('demo') === '1';
  const onReady = (handle: MarkupEditorHandle | null) => {
    window.markupEditor = handle;
    if (!handle || !demo || demoStarted) return;
    demoStarted = true;
    // Waits for the photos, then marks the document up once.
    const start = () => {
      if (!handle.getDocument()) {
        setTimeout(start, 100);
        return;
      }
      runDemo(handle, locale, LINK.get('panel'));
    };
    start();
  };

  const onDone = async (done: MarkupResult) => {
    // Pretend to upload: the editor stays busy until this settles.
    await new Promise((resolve) => setTimeout(resolve, 300));
    window.markupResult = done;
    setResult(done);
    setSaved({ document: done.document, assets: done.assets });
    setInput(null);
  };

  const frameSize = FRAMES[frame];
  const resultURL = useObjectURL(result?.blob ?? null);

  return (
    <div className="page">
      <header className="page-header">
        <h1>image-markup-kit {VERSION}</h1>
        <p>A photo markup editor for React. Open a sample photo, or a few for a board, and press Done.</p>
      </header>

      <section className="panel" aria-labelledby="open-title">
        <h2 id="open-title">Open</h2>
        <ul className="samples">
          {SAMPLES.map((sample) => (
            <li key={sample.file} className="sample">
              <img src={`./samples/${sample.file}`} alt={sample.label} loading="lazy" />
              <span className="sample-label">{sample.label}</span>
              <span className="sample-actions">
                <button
                  type="button"
                  data-testid={`open.${sample.file}`}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      open({ kind: 'image', image: await loadSample(sample.file) });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Annotate
                </button>
                <label>
                  <input
                    type="checkbox"
                    data-testid={`select.${sample.file}`}
                    checked={selected.includes(sample.file)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelected((current) =>
                        checked ? [...current, sample.file] : current.filter((file) => file !== sample.file),
                      );
                    }}
                  />
                  Board
                </label>
              </span>
            </li>
          ))}
        </ul>
        <div className="actions">
          <button
            type="button"
            data-testid="open.board"
            disabled={busy || selected.length === 0}
            onClick={() => void openSamples(selected)}
          >
            Board with {selected.length || 'the'} selected photo{selected.length === 1 ? '' : 's'}
          </button>
          <button
            type="button"
            data-testid="open.board20"
            disabled={busy}
            onClick={() => void openSamples(Array.from({ length: 20 }, (_, i) => SAMPLES[i % SAMPLES.length]!.file))}
          >
            Board with 20 photos
          </button>
          <button type="button" data-testid="open.files" disabled={busy} onClick={() => files.current?.click()}>
            Your photos…
          </button>
          <input
            ref={files}
            type="file"
            accept="image/*"
            multiple
            hidden
            data-testid="open.input"
            onChange={(event) => {
              const chosen = [...(event.currentTarget.files ?? [])];
              event.currentTarget.value = '';
              if (chosen.length === 1) open({ kind: 'image', image: chosen[0]! });
              else if (chosen.length > 1) open({ kind: 'images', images: chosen });
            }}
          />
          <button
            type="button"
            data-testid="open.saved"
            disabled={!saved}
            onClick={() => saved && open({ kind: 'document', document: saved.document, assets: saved.assets })}
          >
            Edit the last result again
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="options-title">
        <h2 id="options-title">Options</h2>
        <div className="options">
          <label>
            Language
            <select
              value={locale}
              data-testid="option.locale"
              onChange={(e) => setLocale(e.currentTarget.value as MarkupLocale)}
            >
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </label>
          <label>
            Size
            <select value={frame} data-testid="option.frame" onChange={(e) => setFrame(e.currentTarget.value as Frame)}>
              {(Object.keys(FRAMES) as Frame[]).map((key) => (
                <option key={key} value={key}>
                  {FRAMES[key].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Export
            <select value={format} onChange={(e) => setFormat(e.currentTarget.value as 'jpeg' | 'png')}>
              <option value="jpeg">JPEG 0.85</option>
              <option value="png">PNG</option>
            </select>
          </label>
          <label>
            JPEG at most (bytes)
            <input
              type="number"
              min={0}
              step={100000}
              placeholder="no limit"
              value={maxBytes}
              onChange={(e) => setMaxBytes(e.currentTarget.value)}
            />
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={includePackage}
              onChange={(e) => setIncludePackage(e.currentTarget.checked)}
            />
            Editable package
          </label>
        </div>
        <label className="features">
          Features (the same JSON as MarkupFeatures.json on iOS)
          <textarea
            value={featuresJSON}
            spellCheck={false}
            rows={8}
            data-testid="option.features"
            onChange={(e) => setFeaturesJSON(e.currentTarget.value)}
          />
        </label>
        {features.error ? <p className="error">Features: {features.error}</p> : null}
      </section>

      {result ? (
        <section className="panel" aria-labelledby="result-title" data-testid="result">
          <h2 id="result-title">Result</h2>
          {resultURL ? <img className="result-image" src={resultURL} alt="The exported markup" /> : null}
          <dl className="facts">
            <dt>Image</dt>
            <dd data-testid="result.size">
              {result.pixelSize.width} × {result.pixelSize.height} px, {result.blob.type}, {bytes(result.blob.size)}
            </dd>
            <dt>Limits</dt>
            <dd>
              {result.isClamped ? 'scaled down to fit the pixel limits' : 'full resolution'}
              {result.exceedsMaxBytes ? ', still above the byte limit' : ''}
            </dd>
            <dt>Items</dt>
            <dd>{result.document.items.length}</dd>
            {result.warnings.length > 0 ? (
              <>
                <dt>Warnings</dt>
                <dd>{result.warnings.map((warning) => `${warning.code} ${warning.assetID}`).join(', ')}</dd>
              </>
            ) : null}
          </dl>
          {result.package ? (
            <ul className="files">
              {Object.entries(result.package).map(([name, blob]) => (
                <li key={name}>
                  <button type="button" onClick={() => download(name.replace(/\//g, '_'), blob)}>
                    {name}
                  </button>{' '}
                  {bytes(blob.size)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {messages.length > 0 ? (
        <section className="panel" aria-labelledby="messages-title">
          <h2 id="messages-title">Messages</h2>
          <ul data-testid="messages">
            {messages.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="credits">
        Sample photos from Wikimedia Commons, CC0:{' '}
        {SAMPLES.filter((sample) => !sample.file.includes('exif')).map((sample, index) => (
          <span key={sample.file}>
            {index > 0 ? ', ' : ''}
            <a href={sample.source}>{sample.label}</a> by {sample.author}
          </span>
        ))}
        .
      </footer>

      {input ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Markup" data-testid="host.modal">
          <div className="modal-status" aria-live="polite">
            {state
              ? `${state.tool}${state.hasChanges ? ' · edited' : ''}${state.isExporting ? ' · exporting' : ''}`
              : ''}
          </div>
          <div
            className={frame === 'fill' ? 'modal-frame modal-fill' : 'modal-frame'}
            style={frameSize.width ? { width: frameSize.width, height: frameSize.height } : undefined}
          >
            <MarkupEditor
              key={session}
              ref={onReady}
              {...(input.kind === 'image'
                ? { image: input.image }
                : input.kind === 'images'
                  ? { images: input.images }
                  : { document: input.document, assets: input.assets })}
              configuration={{
                locale,
                features: features.value,
                exportOptions,
                includePackage,
              }}
              onDone={onDone}
              onCancel={() => setInput(null)}
              onError={(error: MarkupError) => say(`${error.code}: ${error.message}`)}
              onStateChange={setState}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
