import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorSelection } from '@codemirror/state';
import { MarkdownImage } from '../ui/MarkdownImage';
import { getEditorExtensions } from '../../lib/codemirror-config';
import { openExternalUrl } from '../../lib/platform';
// @ts-expect-error — vite raw import returns a string
import kdenliveFixture from './fixtures/kdenlive.md?raw';

/**
 * Dev-only layout harness. Shows view-mode and edit-mode rendering side-by-side
 * for the same markdown, then reports per-landmark Y-offset deltas. Exposes
 * `window.__layoutDiff` so a Playwright script can scrape the numbers.
 */

// A tiny SVG data URI — deterministic, no network. Base64 because the utf8
// parameter isn't universally supported.
const SVG_BOX = (label: string, color = '7c3aed') => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><rect width="600" height="300" fill="#${color}"/><text x="300" y="155" fill="white" font-size="40" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
};

const FIXTURES: Record<string, string> = {
  headings: `# Heading 1
Paragraph after H1. Some body text to take up a line.

## Heading 2
Paragraph after H2. Some body text.

### Heading 3
Paragraph after H3.

#### Heading 4
Paragraph after H4.

##### Heading 5
Paragraph after H5.

###### Heading 6
Paragraph after H6.
`,
  images: `# Images
Intro paragraph before the first image.

![alpha](${SVG_BOX('alpha')})

Middle paragraph between images.

![beta](${SVG_BOX('beta', '22c55e')})

Trailing paragraph.
`,
  lists: `# Lists
Unordered:

- one
- two
  - two-nested-a
  - two-nested-b
- three

Ordered:

1. first
2. second
3. third

After list paragraph.
`,
  kdenlive: kdenliveFixture as string,
  mixed: `# Full kitchen sink

Intro paragraph with **bold** and *italic* and \`inline\` code.

## Subhead
- list item one
- list item two with [a link](https://example.com)

![pic](${SVG_BOX('pic')})

> A quote block that spans a reasonable amount of text to show margins.

\`\`\`js
const x = 1;
const y = 2;
\`\`\`

| Col A | Col B |
| ----- | ----- |
| aaa   | bbb   |
| ccc   | ddd   |

Final paragraph.
`,
};

const markdownComponents = {
  img: ({ src, alt }: { src?: string; alt?: string }) => <MarkdownImage src={src} alt={alt} />,
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    const arr = Array.isArray(children) ? children : [children];
    if (arr.some((c: any) => c?.type === MarkdownImage || c?.props?.src)) return <>{children}</>;
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) openExternalUrl(href).catch(console.error);
        }}
        className="cursor-pointer"
      >
        {children}
      </a>
    );
  },
};

const PROSE = 'prose prose-invert max-w-none';

interface Delta {
  label: string;
  viewTop: number;
  editTop: number;
  delta: number;
}

function firstNOf<T extends Element>(root: Element | null, selector: string, n = Infinity): T[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll(selector)).slice(0, n) as T[];
}

async function waitForImages(root: Element | null): Promise<void> {
  if (!root) return;
  const imgs = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, 1500);
        })
    )
  );
  // `MarkdownImage` flips its class from .markdown-image-loading to
  // .markdown-image-loaded on the React side after the load event. Wait until
  // no loading class remains so we measure the settled layout.
  const start = Date.now();
  while (Date.now() - start < 2000) {
    if (root.querySelectorAll('.markdown-image-loading').length === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface SnapSample {
  t: number;
  // Top offset of a landmark inside the edit column (px from column top).
  landmark: number;
  // Total height of the edit column (px).
  total: number;
}

export default function LayoutDebug() {
  const [fixtureKey, setFixtureKey] = useState<string>('headings');
  const [editKey, setEditKey] = useState(0);
  const content = FIXTURES[fixtureKey];

  const viewRef = useRef<HTMLDivElement | null>(null);
  const editRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const [deltas, setDeltas] = useState<Delta[]>([]);
  const [totalView, setTotalView] = useState(0);
  const [totalEdit, setTotalEdit] = useState(0);
  const [measuredAt, setMeasuredAt] = useState<number>(0);
  const [snapTrace, setSnapTrace] = useState<SnapSample[]>([]);

  const extensions = useMemo(() => getEditorExtensions(), []);

  // Park the cursor at the end of the doc so every line is "inactive" — this
  // matches what a reader sees when not typing and what view mode shows.
  useEffect(() => {
    let attempts = 0;
    const park = () => {
      const v = editorRef.current?.view;
      if (!v) {
        if (attempts++ < 20) requestAnimationFrame(park);
        return;
      }
      v.contentDOM.blur();
      v.dispatch({ selection: EditorSelection.cursor(v.state.doc.length) });
    };
    requestAnimationFrame(park);
  }, [content, editKey]);

  // Reproduce "squished after scrolling past an image" by: (1) remount the
  // editor fresh, (2) measure a deep landmark before and after a programmatic
  // scroll, (3) log whether positions shifted. This is the bug signature —
  // static measurement wasn't catching it.
  const runSnapTrace = useCallback(async () => {
    setEditKey((k) => k + 1);
    setSnapTrace([]);
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const view = editorRef.current?.view;
    if (!view) return;

    const samples: SnapSample[] = [];
    const start = performance.now();
    const measureDeep = (): { landmark: number; total: number } => {
      const e = editRef.current!;
      const eTop = e.getBoundingClientRect().top;
      // Pick the 6th heading (well below the first image) — gives us content
      // past the first scroll event.
      const headings = Array.from(
        e.querySelectorAll('.cm-md-h2, .cm-md-h3')
      ) as HTMLElement[];
      const target = headings[Math.min(5, headings.length - 1)] || e.lastElementChild;
      return {
        landmark: (target as HTMLElement).getBoundingClientRect().top - eTop,
        total: e.scrollHeight,
      };
    };
    const sample = (label: string) => {
      const m = measureDeep();
      samples.push({
        t: Math.round(performance.now() - start),
        landmark: m.landmark,
        total: m.total,
      });
      return label;
    };

    // t0: fresh mount
    sample('fresh');
    // let images load + any layout settle
    await new Promise((r) => setTimeout(r, 300));
    sample('post-300ms');

    // Scroll the outer page down so the CM editor reveals a later image
    // (simulates the user's "scroll past an image" action).
    window.scrollBy({ top: 1500, behavior: 'instant' as ScrollBehavior });
    await new Promise((r) => setTimeout(r, 50));
    sample('post-scroll');
    await new Promise((r) => setTimeout(r, 300));
    sample('post-scroll+300');

    window.scrollBy({ top: 1500, behavior: 'instant' as ScrollBehavior });
    await new Promise((r) => setTimeout(r, 50));
    sample('scroll2');
    await new Promise((r) => setTimeout(r, 300));
    sample('scroll2+300');

    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    await new Promise((r) => setTimeout(r, 50));
    sample('back-top');

    setSnapTrace(samples);
    (window as any).__snapTrace = samples;
  }, []);

  useEffect(() => {
    (window as any).__layoutDiff = null;
    let cancelled = false;
    (async () => {
      await Promise.all([waitForImages(viewRef.current), waitForImages(editRef.current)]);
      // Two frames: first lets CodeMirror finish its height pass, second lets
      // any deferred prose work settle.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) return;

      const v = viewRef.current;
      const e = editRef.current;
      if (!v || !e) return;
      const vTop = v.getBoundingClientRect().top;
      const eTop = e.getBoundingClientRect().top;
      const out: Delta[] = [];

      const levelClasses = ['cm-md-h1', 'cm-md-h2', 'cm-md-h3', 'cm-md-h4', 'cm-md-h5', 'cm-md-h6'];
      for (let lvl = 1; lvl <= 6; lvl++) {
        const vs = firstNOf<HTMLElement>(v, `h${lvl}`);
        const es = firstNOf<HTMLElement>(e, `.${levelClasses[lvl - 1]}`);
        const n = Math.min(vs.length, es.length);
        for (let i = 0; i < n; i++) {
          const vt = vs[i].getBoundingClientRect().top - vTop;
          const et = es[i].getBoundingClientRect().top - eTop;
          out.push({ label: `h${lvl}[${i}]`, viewTop: vt, editTop: et, delta: et - vt });
        }
      }
      // Use the flow-participating wrapper span (the <img> inside is
      // position:absolute while loading and gives misleading offsets).
      const vImgs = firstNOf<HTMLElement>(v, '.markdown-image-wrapper');
      const eImgs = firstNOf<HTMLElement>(e, 'img.cm-md-img');
      const iN = Math.min(vImgs.length, eImgs.length);
      for (let i = 0; i < iN; i++) {
        const vt = vImgs[i].getBoundingClientRect().top - vTop;
        const et = eImgs[i].getBoundingClientRect().top - eTop;
        out.push({ label: `img[${i}]`, viewTop: vt, editTop: et, delta: et - vt });
      }
      // Sample a few list-item positions (useful for larger fixtures).
      const vLis = firstNOf<HTMLElement>(v, 'li', 8);
      const eLis = firstNOf<HTMLElement>(e, '.cm-md-li', 8);
      const lN = Math.min(vLis.length, eLis.length);
      for (let i = 0; i < lN; i++) {
        const vt = vLis[i].getBoundingClientRect().top - vTop;
        const et = eLis[i].getBoundingClientRect().top - eTop;
        out.push({ label: `li[${i}]`, viewTop: vt, editTop: et, delta: et - vt });
      }
      const vH = v.scrollHeight;
      const eH = e.scrollHeight;

      setDeltas(out);
      setTotalView(vH);
      setTotalEdit(eH);
      setMeasuredAt(performance.now());

      (window as any).__layoutDiff = {
        fixture: fixtureKey,
        deltas: out,
        totalView: vH,
        totalEdit: eH,
        totalDelta: eH - vH,
      };
    })();
    return () => {
      cancelled = true;
    };
  }, [content, fixtureKey]);

  const threshold = 2;
  const over = deltas.filter((d) => Math.abs(d.delta) > threshold).length;
  const totalDelta = totalEdit - totalView;

  return (
    <div className="p-6 bg-[var(--color-bg-main)] min-h-screen text-[var(--color-text-primary)]">
      <header className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Layout debug</h1>
        <select
          value={fixtureKey}
          onChange={(e) => setFixtureKey(e.target.value)}
          className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded px-2 py-1"
          data-testid="fixture-select"
        >
          {Object.keys(FIXTURES).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <span
          className={`text-sm ${over > 0 || Math.abs(totalDelta) > threshold ? 'text-yellow-400' : 'text-green-400'}`}
          data-testid="summary"
        >
          {over} block{over === 1 ? '' : 's'} over ±{threshold}px · totalΔ={totalDelta.toFixed(1)}px
        </span>
        <button
          data-testid="snap-trace"
          onClick={runSnapTrace}
          className="text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded px-2 py-1 hover:border-[var(--color-accent)]"
        >
          Trace snap
        </button>
      </header>

      {/* Columns are 768px wide to match the real reader's max-w-3xl. */}
      <div className="flex gap-8 mb-6">
        <div>
          <h2 className="text-sm text-[var(--color-text-secondary)] mb-2">View</h2>
          <div
            ref={viewRef}
            data-testid="view-column"
            className={`${PROSE} bg-[var(--color-bg-card)] p-4 rounded`}
            style={{ width: 768 }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents as any}
              urlTransform={(url) => url}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
        <div>
          <h2 className="text-sm text-[var(--color-text-secondary)] mb-2">Edit</h2>
          <div
            ref={editRef}
            data-testid="edit-column"
            className={`${PROSE} bg-[var(--color-bg-card)] p-4 rounded`}
            style={{ width: 768 }}
          >
            <CodeMirror
              key={`${fixtureKey}-${editKey}`}
              ref={editorRef}
              value={content}
              extensions={extensions}
              theme="none"
              basicSetup={{
                lineNumbers: false,
                highlightActiveLineGutter: false,
                highlightActiveLine: false,
                foldGutter: false,
                bracketMatching: false,
                closeBrackets: false,
              }}
            />
          </div>
        </div>
      </div>

      {snapTrace.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm text-[var(--color-text-secondary)] mb-2">
            Snap trace (edit column, fresh mount) · landmark = 6th heading
          </h2>
          <table className="text-sm border border-[var(--color-border)] rounded" data-testid="snap-table">
            <thead>
              <tr className="bg-[var(--color-bg-card)]">
                <th className="px-3 py-1 text-left">t (ms)</th>
                <th className="px-3 py-1 text-right">landmark top</th>
                <th className="px-3 py-1 text-right">Δ from t0</th>
                <th className="px-3 py-1 text-right">total height</th>
                <th className="px-3 py-1 text-right">Δ from t0</th>
              </tr>
            </thead>
            <tbody>
              {snapTrace.map((s, i) => {
                const dL = s.landmark - snapTrace[0].landmark;
                const dT = s.total - snapTrace[0].total;
                return (
                  <tr key={i} className={Math.abs(dL) > 2 || Math.abs(dT) > 2 ? 'text-yellow-400' : ''}>
                    <td className="px-3 py-0.5">{s.t}</td>
                    <td className="px-3 py-0.5 text-right">{s.landmark.toFixed(1)}</td>
                    <td className="px-3 py-0.5 text-right">{dL.toFixed(1)}</td>
                    <td className="px-3 py-0.5 text-right">{s.total.toFixed(1)}</td>
                    <td className="px-3 py-0.5 text-right">{dT.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h2 className="text-sm text-[var(--color-text-secondary)] mb-2">
          Deltas (edit − view, px) · measured at {measuredAt.toFixed(0)}ms
        </h2>
        <table className="text-sm border border-[var(--color-border)] rounded">
          <thead>
            <tr className="bg-[var(--color-bg-card)]">
              <th className="px-3 py-1 text-left">Landmark</th>
              <th className="px-3 py-1 text-right">View top</th>
              <th className="px-3 py-1 text-right">Edit top</th>
              <th className="px-3 py-1 text-right">Δ</th>
            </tr>
          </thead>
          <tbody data-testid="delta-table">
            {deltas.map((d) => (
              <tr key={d.label} className={Math.abs(d.delta) > threshold ? 'text-yellow-400' : ''}>
                <td className="px-3 py-0.5">{d.label}</td>
                <td className="px-3 py-0.5 text-right">{d.viewTop.toFixed(1)}</td>
                <td className="px-3 py-0.5 text-right">{d.editTop.toFixed(1)}</td>
                <td className="px-3 py-0.5 text-right">{d.delta.toFixed(1)}</td>
              </tr>
            ))}
            <tr className={Math.abs(totalDelta) > threshold ? 'text-yellow-400' : ''}>
              <td className="px-3 py-0.5 font-semibold">totalHeight</td>
              <td className="px-3 py-0.5 text-right">{totalView.toFixed(1)}</td>
              <td className="px-3 py-0.5 text-right">{totalEdit.toFixed(1)}</td>
              <td className="px-3 py-0.5 text-right">{totalDelta.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
