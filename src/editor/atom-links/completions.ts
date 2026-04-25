import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { AtomLinkExtensionConfig, AtomLinkSuggestion } from './types';

interface AtomLinkCompletion extends Completion {
  atomLinkSuggestion: AtomLinkSuggestion;
}

const WIKI_LINK_QUERY_RE = /\[\[[^\]\n|]*$/;

export function atomLinkCompletions(config: AtomLinkExtensionConfig): Extension {
  return autocompletion({
    activateOnTyping: true,
    icons: false,
    override: [async (context) => completionSource(context, config)],
  });
}

async function completionSource(
  context: CompletionContext,
  config: AtomLinkExtensionConfig,
): Promise<CompletionResult | null> {
  const match = context.matchBefore(WIKI_LINK_QUERY_RE);
  if (!match || (match.from === match.to && !context.explicit)) return null;

  const query = match.text.slice(2);
  const suggestions = dedupeSuggestions(
    (await config.suggestAtoms(query)).filter((suggestion) => suggestion.id !== config.currentAtomId),
  ).slice(0, config.maxSuggestions ?? 12);

  if (context.aborted) return null;

  return {
    from: match.from + 2,
    to: context.pos,
    options: suggestions.map(toCompletion),
    validFor: /^[^\]\n|]*$/,
  };
}

function toCompletion(suggestion: AtomLinkSuggestion): AtomLinkCompletion {
  const label = displayTitle(suggestion.title);
  return {
    label,
    detail: suggestion.source ? sourceLabel(suggestion.source) : undefined,
    type: 'text',
    boost: suggestion.source === 'title' || suggestion.source === 'recent' ? 20 : 0,
    apply: (view: EditorView, completion: Completion, from: number, to: number) => {
      const selected = (completion as AtomLinkCompletion).atomLinkSuggestion;
      const insert = `${selected.id}|${escapeLabel(displayTitle(selected.title))}]]`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
    },
    atomLinkSuggestion: suggestion,
  };
}

function dedupeSuggestions(suggestions: AtomLinkSuggestion[]): AtomLinkSuggestion[] {
  const seen = new Set<string>();
  const deduped: AtomLinkSuggestion[] = [];

  for (const suggestion of suggestions) {
    if (seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    deduped.push(suggestion);
  }

  return deduped;
}

function sourceLabel(source: NonNullable<AtomLinkSuggestion['source']>): string {
  switch (source) {
    case 'recent':
      return 'Recent';
    case 'title':
      return 'Title';
    case 'content':
      return 'Content';
    case 'hybrid':
      return 'Related';
  }
}

function displayTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled atom';
}

function escapeLabel(label: string): string {
  return label.replace(/[\]\|]/g, ' ').replace(/\s+/g, ' ').trim();
}
