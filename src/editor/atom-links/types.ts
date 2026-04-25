export type AtomLinkSuggestionSource = 'recent' | 'title' | 'content' | 'hybrid';

export interface AtomLinkSuggestion {
  id: string;
  title: string;
  snippet?: string | null;
  source?: AtomLinkSuggestionSource;
}

export interface ResolvedAtomLinkTarget {
  id: string;
  title: string;
  snippet?: string | null;
}

export interface AtomLinkExtensionConfig {
  currentAtomId?: string;
  suggestAtoms: (query: string) => Promise<AtomLinkSuggestion[]>;
  resolveAtom?: (id: string) => Promise<ResolvedAtomLinkTarget | null>;
  openAtom?: (id: string) => void;
  maxSuggestions?: number;
}

export interface ParsedAtomLink {
  from: number;
  to: number;
  targetFrom: number;
  targetTo: number;
  labelFrom: number | null;
  labelTo: number | null;
  closeFrom: number;
  target: string;
  label: string | null;
  isUuidTarget: boolean;
}
