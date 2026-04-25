import type { Extension } from '@codemirror/state';
import { atomLinkCompletions } from './completions';
import { atomLinkDecorations } from './decorations';
import type { AtomLinkExtensionConfig } from './types';

export type {
  AtomLinkExtensionConfig,
  AtomLinkSuggestion,
  AtomLinkSuggestionSource,
  ResolvedAtomLinkTarget,
} from './types';

export function atomLinkExtension(config: AtomLinkExtensionConfig): Extension[] {
  return [
    atomLinkDecorations(config),
    atomLinkCompletions(config),
  ];
}
