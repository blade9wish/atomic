import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { findAtomLinksInVisibleRanges } from './parser';
import type { AtomLinkExtensionConfig, ParsedAtomLink, ResolvedAtomLinkTarget } from './types';

interface ResolutionPayload {
  id: string;
  atom: ResolvedAtomLinkTarget | null;
}

interface AtomLinkDecorationState {
  decorations: DecorationSet;
  resolved: Map<string, ResolvedAtomLinkTarget | null>;
}

const atomLinkResolved = StateEffect.define<ResolutionPayload>();

class AtomLinkWidget extends WidgetType {
  constructor(
    private readonly target: string,
    private readonly title: string,
    private readonly status: 'resolved' | 'loading' | 'missing' | 'unresolved',
    private readonly atomId: string | null,
  ) {
    super();
  }

  override eq(other: AtomLinkWidget): boolean {
    return (
      this.target === other.target &&
      this.title === other.title &&
      this.status === other.status &&
      this.atomId === other.atomId
    );
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = `cm-atomic-atom-link-widget cm-atomic-atom-link-widget-${this.status}`;
    span.dataset.atomLinkTarget = this.target;
    if (this.atomId) span.dataset.atomId = this.atomId;
    span.textContent = this.title;
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class AtomLinkResolverPlugin {
  private readonly pending = new Set<string>();
  private destroyed = false;

  constructor(private readonly view: EditorView, private readonly config: AtomLinkExtensionConfig) {
    this.resolveVisibleBareLinks();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.resolveVisibleBareLinks();
    }
  }

  destroy(): void {
    this.destroyed = true;
  }

  private resolveVisibleBareLinks(): void {
    if (!this.config.resolveAtom) return;

    const links = findAtomLinksInVisibleRanges(this.view.state.doc, this.view.visibleRanges);
    for (const link of links) {
      if (!link.isUuidTarget || link.label || this.pending.has(link.target)) continue;
      this.resolve(link.target);
    }
  }

  private resolve(id: string): void {
    if (!this.config.resolveAtom) return;

    this.pending.add(id);
    this.config.resolveAtom(id)
      .then((atom) => {
        if (!this.destroyed) {
          this.view.dispatch({ effects: atomLinkResolved.of({ id, atom }) });
        }
      })
      .catch(() => {
        if (!this.destroyed) {
          this.view.dispatch({ effects: atomLinkResolved.of({ id, atom: null }) });
        }
      })
      .finally(() => {
        this.pending.delete(id);
      });
  }
}

export function atomLinkDecorations(config: AtomLinkExtensionConfig): Extension {
  const field = StateField.define<AtomLinkDecorationState>({
    create(state) {
      const resolved = new Map<string, ResolvedAtomLinkTarget | null>();
      return {
        resolved,
        decorations: buildDecorations(state, resolved),
      };
    },
    update(value, transaction) {
      let resolved = value.resolved;
      let resolutionChanged = false;

      for (const effect of transaction.effects) {
        if (!effect.is(atomLinkResolved)) continue;
        if (resolved === value.resolved) resolved = new Map(value.resolved);
        resolved.set(effect.value.id, effect.value.atom);
        resolutionChanged = true;
      }

      if (transaction.docChanged || transaction.selection || resolutionChanged) {
        return {
          resolved,
          decorations: buildDecorations(transaction.state, resolved),
        };
      }

      return {
        resolved,
        decorations: value.decorations.map(transaction.changes),
      };
    },
    provide: (fieldValue) => EditorView.decorations.from(fieldValue, (value) => value.decorations),
  });

  const resolver = ViewPlugin.define((view) => new AtomLinkResolverPlugin(view, config));

  return [
    field,
    resolver,
    EditorView.domEventHandlers({
      click(event) {
        if (!config.openAtom || !(event.metaKey || event.ctrlKey)) return false;

        const target = event.target as HTMLElement | null;
        const link = target?.closest<HTMLElement>('[data-atom-id]');
        const atomId = link?.dataset.atomId;
        if (!atomId) return false;

        event.preventDefault();
        config.openAtom(atomId);
        return true;
      },
    }),
  ];
}

function buildDecorations(
  state: EditorState,
  resolved: ReadonlyMap<string, ResolvedAtomLinkTarget | null>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const links = findAtomLinksInVisibleRanges(state.doc, [{ from: 0, to: state.doc.length }]);

  for (const link of links) {
    if (!isSingleLineRange(state, link.from, link.to)) continue;

    if (isSelectionInsideLink(state, link)) {
      builder.add(link.from, link.to, Decoration.mark({ class: 'cm-atomic-atom-link-active' }));
      continue;
    }

    if (link.label) {
      addLabeledLink(builder, link);
      continue;
    }

    if (link.isUuidTarget) {
      const target = resolved.get(link.target);
      const title = target === undefined ? 'Atom' : target?.title.trim() || 'Missing atom';
      const status = target === undefined ? 'loading' : target ? 'resolved' : 'missing';
      addBareLinkWidget(builder, link, title, status, target ? link.target : null);
    } else {
      addBareLinkWidget(builder, link, link.target, 'unresolved', null);
    }
  }

  return builder.finish();
}

function addLabeledLink(builder: RangeSetBuilder<Decoration>, link: ParsedAtomLink): void {
  if (link.labelFrom == null || link.labelTo == null || link.labelFrom >= link.labelTo) return;

  builder.add(link.from, link.labelFrom, Decoration.mark({ class: 'cm-atomic-atom-link-hidden-syntax' }));
  builder.add(
    link.labelFrom,
    link.labelTo,
    Decoration.mark({
      class: link.isUuidTarget ? 'cm-atomic-atom-link-rendered' : 'cm-atomic-atom-link-unresolved',
      attributes: link.isUuidTarget
        ? { 'data-atom-id': link.target }
        : { 'data-atom-link-target': link.target },
    }),
  );
  builder.add(link.labelTo, link.to, Decoration.mark({ class: 'cm-atomic-atom-link-hidden-syntax' }));
}

function addBareLinkWidget(
  builder: RangeSetBuilder<Decoration>,
  link: ParsedAtomLink,
  title: string,
  status: 'resolved' | 'loading' | 'missing' | 'unresolved',
  atomId: string | null,
): void {
  builder.add(
    link.from,
    link.from,
    Decoration.widget({
      widget: new AtomLinkWidget(link.target, title, status, atomId),
      side: -1,
    }),
  );
  builder.add(link.from, link.to, Decoration.mark({ class: 'cm-atomic-atom-link-hidden-syntax' }));
}

function isSelectionInsideLink(state: EditorState, link: ParsedAtomLink): boolean {
  return state.selection.ranges.some((range) => {
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);
    if (from === to) return from > link.from && from < link.to;
    return from < link.to && to > link.from;
  });
}

function isSingleLineRange(state: EditorState, from: number, to: number): boolean {
  const end = Math.max(from, to - 1);
  return state.doc.lineAt(from).number === state.doc.lineAt(end).number;
}
