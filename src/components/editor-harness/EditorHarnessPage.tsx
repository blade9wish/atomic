import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFont, useTheme } from '../../hooks';
import { AtomicCodeMirrorEditor } from '../editor/AtomicCodeMirrorEditor';
import { SAMPLE_SIZES, type SampleSize, generateSampleMarkdown } from './sample-content';

function formatBytes(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(2)} MB`;
}

export function EditorHarnessPage() {
  useTheme();
  useFont();

  const [size, setSize] = useState<SampleSize>('100 pages');
  const markdownSource = useMemo(() => generateSampleMarkdown(size), [size]);

  const stats = useMemo(() => {
    let lines = 1;
    for (let i = 0; i < markdownSource.length; i++) {
      if (markdownSource.charCodeAt(i) === 10) lines++;
    }
    return { chars: markdownSource.length, lines };
  }, [markdownSource]);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-main)] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-panel)] px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-wide">Editor Harness</span>
            <Link
              to="/"
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)]"
            >
              ← back to app
            </Link>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">size:</span>
            {SAMPLE_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={
                  'rounded border px-2 py-1 text-xs transition-colors ' +
                  (size === s
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-alpha)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]')
                }
              >
                {s}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
            <span>
              <span className="font-mono text-[var(--color-text-primary)]">
                {stats.lines.toLocaleString()}
              </span>{' '}
              lines
            </span>
            <span>
              <span className="font-mono text-[var(--color-text-primary)]">
                {formatBytes(stats.chars)}
              </span>
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="mx-auto h-full max-w-6xl px-4 py-4">
          <div className="h-full overflow-hidden rounded-lg border border-[var(--color-border)]">
            <AtomicCodeMirrorEditor
              key={size}
              documentId={`harness-${size}`}
              markdownSource={markdownSource}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
