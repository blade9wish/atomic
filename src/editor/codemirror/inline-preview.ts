import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

// Inline preview — the Obsidian "Live Preview" model.
//
// Goals:
//   1. No layout shifts between active/inactive state. The raw markdown
//      source is always the DOM text; we only apply line-level CSS
//      classes (setting font-size / weight unconditionally) and hide
//      syntax tokens on inactive lines via empty Decoration.replace.
//      Line heights are driven by CSS class, not by token visibility.
//
//   2. No reveal during mouse interaction. Clicking a heading places the
//      cursor on its line, which would normally "reveal" the `# ` prefix
//      — and that reveal shifts the heading text rightward under the
//      user's cursor, sometimes turning a click into a micro-drag.
//      Obsidian sidesteps this by delaying the reveal until the mouse
//      has been released for a moment; we do the same via a freeze flag.

const FREEZE_TAIL_MS = 100;

// ---- freeze plumbing -----------------------------------------------------

const setFrozen = StateEffect.define<boolean>();

const previewFrozenField = StateField.define<boolean>({
  create: () => false,
  update(prev, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFrozen)) return effect.value;
    }
    return prev;
  },
});

// Tracks mouse state on the editor and drives the freeze flag. We listen
// on the content DOM for pointerdown and on the window for pointerup —
// users can release outside the editor after a drag, and we'd miss the
// up event if we listened on the content DOM only.
const freezeMousePlugin = ViewPlugin.fromClass(
  class {
    private down = false;
    private releaseTimer: number | null = null;
    private readonly onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Only freeze when the pointerdown lands inside the content. The
      // scrollbar (on the outer .cm-scroller) would otherwise engage the
      // freeze too — which keeps decorations stale for the whole drag
      // and the syntax only "pops in" on release. Gesture/wheel scroll
      // doesn't have this issue because it never fires a pointerdown on
      // the scrollbar chrome.
      const target = event.target;
      if (!(target instanceof Node) || !this.view.contentDOM.contains(target)) {
        return;
      }
      this.down = true;
      if (this.releaseTimer != null) {
        window.clearTimeout(this.releaseTimer);
        this.releaseTimer = null;
      }
      if (!this.view.state.field(previewFrozenField)) {
        this.view.dispatch({ effects: setFrozen.of(true) });
      }
    };
    private readonly onUp = () => {
      if (!this.down) return;
      this.down = false;
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer);
      this.releaseTimer = window.setTimeout(() => {
        this.releaseTimer = null;
        if (!this.view.state.field(previewFrozenField)) return;
        try {
          this.view.dispatch({ effects: setFrozen.of(false) });
        } catch {
          // view destroyed while timer was pending.
        }
      }, FREEZE_TAIL_MS);
    };

    constructor(readonly view: EditorView) {
      // Capture-phase listener on view.dom so we dispatch setFrozen(true)
      // BEFORE CM6's own pointerdown handler runs its selection logic.
      // Without capture, CM6's listener can win the order race and
      // rebuild decorations (revealing `# `/`**`) before we freeze.
      view.dom.addEventListener('pointerdown', this.onDown, true);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onUp);
    }

    update(_: ViewUpdate) {
      // No-op — we don't drive freeze off doc changes.
    }

    destroy() {
      this.view.dom.removeEventListener('pointerdown', this.onDown, true);
      window.removeEventListener('pointerup', this.onUp);
      window.removeEventListener('pointercancel', this.onUp);
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer);
    }
  },
);

// ---- decoration building --------------------------------------------------

const LINE_CLASS_BY_BLOCK: Record<string, string> = {
  ATXHeading1: 'cm-atomic-h1',
  ATXHeading2: 'cm-atomic-h2',
  ATXHeading3: 'cm-atomic-h3',
  ATXHeading4: 'cm-atomic-h4',
  ATXHeading5: 'cm-atomic-h5',
  ATXHeading6: 'cm-atomic-h6',
  SetextHeading1: 'cm-atomic-h1',
  SetextHeading2: 'cm-atomic-h2',
  Blockquote: 'cm-atomic-blockquote',
  FencedCode: 'cm-atomic-fenced-code',
};

// Node names whose characters we want invisible when the cursor isn't on
// their line. Every hit contributes a Decoration.replace with no widget,
// which hides the range without affecting layout.
const HIDEABLE_SYNTAX = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
  'URL',
  'LinkTitle',
  'StrikethroughMark',
  'QuoteMark',
]);

// Inline content nodes that get a class applied unconditionally.
const INLINE_MARK_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-atomic-strong',
  Emphasis: 'cm-atomic-em',
  InlineCode: 'cm-atomic-inline-code',
  Strikethrough: 'cm-atomic-strike',
  Link: 'cm-atomic-link',
};

// Substitute a `•` for the raw `-`/`*`/`+` marker on bullet-list items
// when the line isn't active. We don't do this for ordered lists because
// `1.`, `2.`, ... are numeric information the reader expects to see.
class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-atomic-bullet';
    span.textContent = '•';
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

// Single shared instance — WidgetType is stateless per decoration and CM6
// compares with `eq()`, not reference equality.
const BULLET_WIDGET = new BulletWidget();

// GFM task-list checkbox. The raw `[ ]` / `[x]` in a list item gets
// replaced by an interactive checkbox. Clicking the checkbox toggles the
// source text between the two states without ever moving the cursor
// into the line — `ignoreEvent` returns true for mouse events so CM6
// doesn't try to place a selection there, and our own click handler does
// the dispatch.
class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.className = 'cm-atomic-task-checkbox';
    input.setAttribute('contenteditable', 'false');
    input.addEventListener('mousedown', (e) => {
      // Swallow the mousedown so the freeze plugin doesn't engage and
      // CM6 doesn't start a selection at the checkbox.
      e.preventDefault();
      e.stopPropagation();
    });
    input.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Re-resolve the checkbox's doc position at click time — the
      // widget's DOM may have been reused across doc edits.
      const pos = view.posAtDOM(input);
      if (pos < 0) return;
      const current = view.state.doc.sliceString(pos, pos + 3);
      const next = /\[x\]/i.test(current) ? '[ ]' : '[x]';
      if (current === next) return;
      view.dispatch({ changes: { from: pos, to: pos + 3, insert: next } });
    });
    return input;
  }

  // Tell CM6 to leave mouse events on this widget alone — our own
  // listener handles the toggle.
  ignoreEvent(event: Event): boolean {
    return event.type === 'mousedown' || event.type === 'click';
  }
}

function buildInlineDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const ranges: Range<Decoration>[] = [];

  const activeLines = new Set<number>();
  for (const r of state.selection.ranges) {
    const firstLine = doc.lineAt(r.from).number;
    const lastLine = doc.lineAt(r.to).number;
    for (let n = firstLine; n <= lastLine; n++) activeLines.add(n);
  }

  // Push the incremental parser far enough to cover the viewport before
  // we build decorations. Without this, on long docs the lezer tree may
  // stop partway through, leaving everything past that point undecorated
  // until some later event (like a click) nudges the parser forward.
  // 50ms is a generous per-update budget — the user-perceivable effect
  // is a tiny hitch when scrolling into fresh territory, not a hang.
  const tree = ensureSyntaxTree(state, view.viewport.to, 50) ?? syntaxTree(state);

  // Scope both tree walks to the viewport. `iterate({ from, to })` still
  // visits nodes that *overlap* the range, so a FencedCode that starts
  // before the viewport and extends into it is still seen.
  const viewportFrom = view.viewport.from;
  const viewportTo = view.viewport.to;

  // Pre-pass with two jobs:
  //   1. Keep fence framing visible when editing a fenced code block.
  //      If any line inside a FencedCode is active, pull every line of
  //      the block into activeLines so the ``` fences stay visible
  //      instead of folding back.
  //   2. Index task-list items by line. We use this in the main pass to
  //      suppress the bullet marker on task lines — the checkbox alone
  //      conveys "this is a list item", so also rendering a `•` next to
  //      it is visual noise.
  const taskMarkerByLine = new Map<number, number>();
  tree.iterate({
    from: viewportFrom,
    to: viewportTo,
    enter: (node) => {
      if (node.name === 'FencedCode') {
        const firstLine = doc.lineAt(node.from).number;
        const lastLine = doc.lineAt(node.to).number;
        let anyActive = false;
        for (let n = firstLine; n <= lastLine; n++) {
          if (activeLines.has(n)) {
            anyActive = true;
            break;
          }
        }
        if (anyActive) {
          for (let n = firstLine; n <= lastLine; n++) activeLines.add(n);
        }
      } else if (node.name === 'TaskMarker') {
        taskMarkerByLine.set(doc.lineAt(node.from).number, node.from);
      }
    },
  });

  tree.iterate({
    from: viewportFrom,
    to: viewportTo,
    enter: (node) => {
      const lineClass = LINE_CLASS_BY_BLOCK[node.name];
      if (lineClass) {
        const firstLine = doc.lineAt(node.from);
        const lastLine = doc.lineAt(node.to);
        for (let n = firstLine.number; n <= lastLine.number; n++) {
          const line = doc.line(n);
          ranges.push(Decoration.line({ class: lineClass }).range(line.from));
        }
      }

      const markClass = INLINE_MARK_CLASS[node.name];
      if (markClass && node.from < node.to) {
        ranges.push(Decoration.mark({ class: markClass }).range(node.from, node.to));
      }

      if (HIDEABLE_SYNTAX.has(node.name) && node.from < node.to) {
        const lineNum = doc.lineAt(node.from).number;
        if (!activeLines.has(lineNum)) {
          ranges.push(Decoration.replace({}).range(node.from, node.to));
        }
      }

      if (node.name === 'ListMark' && node.from < node.to) {
        const lineNum = doc.lineAt(node.from).number;
        const taskFrom = taskMarkerByLine.get(lineNum);
        if (taskFrom !== undefined) {
          // Task-list item: hide the `- ` (and any whitespace up to the
          // TaskMarker) so only the checkbox shows. Rendering both a
          // bullet and a checkbox would be redundant.
          ranges.push(Decoration.replace({}).range(node.from, taskFrom));
        } else {
          // Regular bullet list: render the marker as `•`, unconditional
          // of active state. Keeps the visual stable when the cursor
          // enters or leaves a list item, and the reader never needs to
          // see the raw `-`/`*`/`+`. Ordered markers (`1.`, `2.`, …)
          // stay as-is — the numbers are information.
          const markText = doc.sliceString(node.from, node.to);
          if (markText === '-' || markText === '*' || markText === '+') {
            ranges.push(
              Decoration.replace({ widget: BULLET_WIDGET }).range(node.from, node.to),
            );
          }
        }
      }

      if (node.name === 'TaskMarker' && node.from < node.to) {
        // `[ ]` / `[x]` → rendered checkbox. Always-on (not conditional
        // on active line) so the user can click to toggle without having
        // to enter the line first.
        const markText = doc.sliceString(node.from, node.to);
        const checked = /\[x\]/i.test(markText);
        ranges.push(
          Decoration.replace({ widget: new TaskCheckboxWidget(checked) }).range(
            node.from,
            node.to,
          ),
        );
        if (checked) {
          // Strike through the rest of the item's line to make "done"
          // visually obvious.
          const lineNum = doc.lineAt(node.from).number;
          const line = doc.line(lineNum);
          ranges.push(
            Decoration.line({ class: 'cm-atomic-task-done' }).range(line.from),
          );
        }
      }
    },
  });

  return Decoration.set(ranges, true);
}

// Decoration source. A ViewPlugin (not a StateField) so we can see
// `view.viewport` and scope both syntax-tree iteration and decoration
// emission to what's actually visible. The StateField approach doesn't
// have access to the viewport, which is why content past the initial
// parse window appeared unrendered until a click nudged an update.
const inlinePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildInlineDecorations(view);
    }

    update(update: ViewUpdate) {
      const prevFrozen = update.startState.field(previewFrozenField);
      const nextFrozen = update.state.field(previewFrozenField);
      const justUnfroze = prevFrozen && !nextFrozen;

      // While frozen, keep whatever was last shown. This is what prevents
      // mousedown-triggered selection changes from revealing syntax
      // tokens mid-click and shifting layout under the cursor.
      if (nextFrozen && !justUnfroze) return;

      if (
        justUnfroze ||
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = buildInlineDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

// Tight-continuation Enter for bullet lists.
//
// Why we override the default: @codemirror/lang-markdown's
// `insertNewlineContinueMarkup` uses the syntax tree to decide whether a
// list is "loose" (blank lines between items) and, if so, inserts a
// blank line as part of the continuation. That inference bleeds in when
// you start a new list adjacent to an existing one — lezer sees both as
// siblings in a loose list, and the new item sprouts a blank line the
// user didn't intend. In our inline-preview mode loose vs tight lists
// look identical anyway, so we always continue tight.
function insertTightListItem(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const from = sel.from;
  const line = state.doc.lineAt(from);

  // Confirm we're inside a BulletList by walking ancestors. Without this
  // the handler would hijack Enter on every line.
  const tree = syntaxTree(state);
  let cursor = tree.resolveInner(from, -1).cursor();
  let inBulletList = false;
  for (;;) {
    if (cursor.name === 'BulletList') {
      inBulletList = true;
      break;
    }
    if (!cursor.parent()) break;
  }
  if (!inBulletList) return false;

  // The actual line text — we use its prefix to recover the indent,
  // bullet marker, and whitespace, so the continuation matches the
  // user's preferred style.
  const lineText = state.doc.sliceString(line.from, line.to);
  const prefix = lineText.match(/^(\s*)([-*+])(\s+)/);
  if (!prefix) return false;

  const [whole, indent, marker] = prefix;
  const rest = lineText.slice(whole.length);

  // Detect a GFM task-list item so we can propagate `[ ]` to the new
  // line (an Obsidian-style ergonomic — Enter on a task creates a fresh
  // unchecked task, not a plain bullet). A completed `[x]` still
  // produces a fresh unchecked box.
  const taskMatch = rest.match(/^(\[[ xX]\])(\s*)/);
  const taskPrefixLen = taskMatch ? taskMatch[0].length : 0;
  const contentAfterPrefix = rest.slice(taskPrefixLen);

  // Empty continuation — user pressed Enter on a bullet (or empty task)
  // with no content. Exit the list: replace the line with just its
  // indent so the cursor lands on a plain blank line.
  if (!contentAfterPrefix.trim()) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: indent },
      selection: EditorSelection.cursor(line.from + indent.length),
    });
    return true;
  }

  const continuation = taskMatch ? `${marker} [ ] ` : `${marker} `;
  const insert = `\n${indent}${continuation}`;
  view.dispatch({
    changes: { from, to: from, insert },
    selection: EditorSelection.cursor(from + insert.length),
  });
  return true;
}

export const inlinePreviewExtension: Extension = [
  previewFrozenField,
  inlinePreviewPlugin,
  freezeMousePlugin,
  // Prec.highest to beat @codemirror/lang-markdown's own Enter handler,
  // which is registered internally by the `markdown()` extension (not
  // just via the exported markdownKeymap) and otherwise wins precedence.
  Prec.highest(keymap.of([{ key: 'Enter', run: insertTightListItem }])),
];
