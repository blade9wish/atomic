import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

// We hang the theme off our own CSS vars (see src/index.css) so the editor
// follows the user's active Atomic theme without JS-side reconfiguration.
// Everything here is CM6's CSS-in-JS — its selectors target `.cm-*` classes
// rendered inside `.cm-editor`, so we namespace via `&` at the theme root.

export const atomicEditorTheme: Extension = EditorView.theme(
  {
    '&': {
      color: 'var(--color-text-primary)',
      backgroundColor: 'transparent',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--atomic-prose-body, 1rem)',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-sans)',
      lineHeight: 'var(--atomic-prose-leading, 1.75)',
      overflow: 'auto',
    },
    '.cm-content': {
      caretColor: 'var(--color-accent-light)',
      padding: '0',
      paddingBottom: '40vh',
    },
    '.cm-line': {
      padding: '0',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-accent-light)',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground': {
      backgroundColor:
        'color-mix(in srgb, var(--color-accent) 28%, var(--color-bg-main) 72%)',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-gutters': {
      display: 'none',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--color-bg-card)',
      color: 'var(--color-text-primary)',
      border: '1px solid var(--color-border)',
      borderRadius: '6px',
    },
    '.cm-panels': {
      backgroundColor: 'var(--color-bg-panel)',
      color: 'var(--color-text-primary)',
      borderColor: 'var(--color-border)',
    },
    '.cm-panel.cm-search': {
      padding: '8px 12px',
      fontFamily: 'var(--font-sans)',
    },
    '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
      fontFamily: 'var(--font-sans)',
      fontSize: '0.8125rem',
    },
    '.cm-panel.cm-search input[type=text]': {
      backgroundColor: 'var(--color-bg-main)',
      color: 'var(--color-text-primary)',
      border: '1px solid var(--color-border)',
      borderRadius: '4px',
      padding: '4px 8px',
    },
    '.cm-panel.cm-search button': {
      backgroundColor: 'transparent',
      color: 'var(--color-text-secondary)',
      border: '1px solid var(--color-border)',
      borderRadius: '4px',
      padding: '4px 10px',
      cursor: 'pointer',
    },
    '.cm-panel.cm-search button[name=close]': {
      color: 'var(--color-text-secondary)',
    },
    '.cm-searchMatch': {
      backgroundColor:
        'color-mix(in srgb, var(--color-accent) 26%, transparent 74%)',
      borderRadius: '2px',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor:
        'color-mix(in srgb, var(--color-accent) 60%, transparent 40%)',
      outline: '1px solid var(--color-accent-light)',
    },
  },
  { dark: true },
);

// Markdown syntax tinting. Intentionally muted for the punctuation tokens
// (#, *, `, [, ]) so the surrounding prose reads cleanly; the headings and
// structural tokens get real visual weight. Once live-preview widgets land
// in Phase 2, most of these tokens will be hidden on inactive lines and
// only the widget-rendered form will be visible.
export const atomicMarkdownHighlight = HighlightStyle.define([
  // Headings — weight from the lang-markdown parser's block hierarchy.
  { tag: t.heading1, fontWeight: '700', fontSize: '1.6em', lineHeight: '1.25' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.35em', lineHeight: '1.3' },
  { tag: t.heading3, fontWeight: '700', fontSize: '1.15em', lineHeight: '1.35' },
  { tag: t.heading4, fontWeight: '700', fontSize: '1.05em' },
  { tag: [t.heading5, t.heading6], fontWeight: '700' },

  // Emphasis marks — use the visual form, not just color.
  { tag: t.strong, fontWeight: '700', color: 'var(--color-text-primary)' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--color-text-primary)' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--color-text-secondary)' },

  // Code.
  {
    tag: [t.monospace],
    fontFamily: 'var(--font-mono)',
    color: 'var(--atomic-prose-link, #60a5fa)',
  },

  // Links.
  { tag: t.link, color: 'var(--atomic-prose-link, #60a5fa)' },
  { tag: t.url, color: 'var(--atomic-prose-link, #60a5fa)' },

  // Structural punctuation — muted so prose dominates.
  { tag: t.processingInstruction, color: 'var(--color-text-tertiary)' },
  { tag: t.contentSeparator, color: 'var(--color-text-tertiary)' },
  { tag: t.quote, color: 'var(--color-text-secondary)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--color-text-primary)' },
  { tag: t.meta, color: 'var(--color-text-tertiary)' },

  // Generic fallback tokens used by the markdown parser for punctuation.
  { tag: t.punctuation, color: 'var(--color-text-tertiary)' },
  { tag: t.operator, color: 'var(--color-text-tertiary)' },
]);

export const atomicMarkdownSyntax = syntaxHighlighting(atomicMarkdownHighlight);
