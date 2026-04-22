import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { getTransport } from '../../lib/transport';
import { useTagsStore, TagWithCount } from '../../stores/tags';
import { useUIStore } from '../../stores/ui';
import { useAtomsStore } from '../../stores/atoms';
import { useChatStore } from '../../stores/chat';
import {
  GlobalChatSearchResult,
  GlobalSearchResponse,
  GlobalTagSearchResult,
  GlobalWikiSearchResult,
  SemanticSearchResult,
} from '../command-palette/types';

const SEARCH_DEBOUNCE_MS = 250;
const SECTION_LIMIT = 5;
const HYBRID_ATOM_LIMIT = 12;
const HYBRID_ATOM_THRESHOLD = 0.3;

type SearchPaletteMode = 'global' | 'tags' | 'atoms-hybrid';

type SearchPalettePrefix =
  | { token: '#'; label: 'tags' }
  | { token: '>'; label: 'atoms' }
  | null;

type SearchPaletteItem =
  | { kind: 'atom'; result: SemanticSearchResult }
  | { kind: 'wiki'; result: GlobalWikiSearchResult }
  | { kind: 'chat'; result: GlobalChatSearchResult }
  | { kind: 'tag'; result: GlobalTagSearchResult };

interface UseSearchPaletteOptions {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
}

function flattenTags(tagList: TagWithCount[], result: TagWithCount[] = []): TagWithCount[] {
  for (const tag of tagList) {
    result.push(tag);
    if (tag.children?.length) {
      flattenTags(tag.children, result);
    }
  }
  return result;
}

function strongSubstringMatch(haystack: string, needle: string): boolean {
  if (needle.length < 2) {
    return haystack === needle;
  }
  return haystack
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .some((segment) => segment.includes(needle));
}

export function useSearchPalette({ isOpen, onClose, initialQuery = '' }: UseSearchPaletteOptions) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [globalResults, setGlobalResults] = useState<GlobalSearchResponse>({
    atoms: [],
    wiki: [],
    chats: [],
    tags: [],
  });
  const [hybridAtomResults, setHybridAtomResults] = useState<SemanticSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tags = useTagsStore((state) => state.tags);

  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      setSelectedIndex(0);
      setGlobalResults({ atoms: [], wiki: [], chats: [], tags: [] });
      setHybridAtomResults([]);
      setIsSearching(false);
    }
  }, [isOpen, initialQuery]);

  const prefix: SearchPalettePrefix = query.startsWith('#')
    ? { token: '#', label: 'tags' }
    : query.startsWith('>')
      ? { token: '>', label: 'atoms' }
      : null;
  const mode: SearchPaletteMode = prefix?.token === '#'
    ? 'tags'
    : prefix?.token === '>'
      ? 'atoms-hybrid'
      : 'global';
  const searchQuery = prefix ? query.slice(prefix.token.length) : query;

  useEffect(() => {
    if (mode !== 'global' && mode !== 'atoms-hybrid') {
      setGlobalResults({ atoms: [], wiki: [], chats: [], tags: [] });
      setHybridAtomResults([]);
      setIsSearching(false);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setGlobalResults({ atoms: [], wiki: [], chats: [], tags: [] });
      setHybridAtomResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        if (mode === 'atoms-hybrid') {
          const results = await getTransport().invoke<SemanticSearchResult[]>('search_atoms_hybrid', {
            query: trimmed,
            limit: HYBRID_ATOM_LIMIT,
            threshold: HYBRID_ATOM_THRESHOLD,
          });
          setHybridAtomResults(results);
          setGlobalResults({ atoms: [], wiki: [], chats: [], tags: [] });
        } else {
          const results = await getTransport().invoke<GlobalSearchResponse>('search_global_keyword', {
            query: trimmed,
            sectionLimit: SECTION_LIMIT,
          });
          setGlobalResults(results);
          setHybridAtomResults([]);
        }
      } catch (error) {
        console.error('Global search failed:', error);
        setGlobalResults({ atoms: [], wiki: [], chats: [], tags: [] });
        setHybridAtomResults([]);
      } finally {
        setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [mode, searchQuery]);

  const tagResults = useMemo(() => {
    if (mode !== 'tags') return [];
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) return [];

    return flattenTags(tags)
      .map((tag) => {
        const lower = tag.name.toLowerCase();
        let score = 0;
        if (lower === trimmed) {
          score = 1;
        } else if (lower.startsWith(trimmed)) {
          score = 0.95;
        } else if (strongSubstringMatch(lower, trimmed)) {
          score = 0.8;
        }

        return score > 0
          ? {
              id: tag.id,
              name: tag.name,
              parent_id: tag.parent_id,
              created_at: tag.created_at,
              atom_count: tag.atom_count,
              score,
            }
          : null;
      })
      .filter((tag): tag is GlobalTagSearchResult => tag !== null)
      .sort((a, b) => b.score - a.score || b.atom_count - a.atom_count || a.name.localeCompare(b.name))
      .slice(0, SECTION_LIMIT * 2);
  }, [mode, searchQuery, tags]);

  const flatItems = useMemo<SearchPaletteItem[]>(() => {
    if (mode === 'tags') {
      return tagResults.map((result) => ({ kind: 'tag', result }));
    }

    if (mode === 'atoms-hybrid') {
      return hybridAtomResults.map((result) => ({ kind: 'atom' as const, result }));
    }

    return [
      ...globalResults.atoms.map((result) => ({ kind: 'atom' as const, result })),
      ...globalResults.wiki.map((result) => ({ kind: 'wiki' as const, result })),
      ...globalResults.chats.map((result) => ({ kind: 'chat' as const, result })),
      ...globalResults.tags.map((result) => ({ kind: 'tag' as const, result })),
    ];
  }, [mode, globalResults, hybridAtomResults, tagResults]);

  const totalItems = flatItems.length;

  const handleSelect = useCallback(
    (index: number) => {
      const item = flatItems[index];
      if (!item) return;

      onClose();

      switch (item.kind) {
        case 'atom':
          useUIStore.getState().openReader(
            item.result.id,
            item.result.matching_chunk_content || searchQuery.trim()
          );
          break;
        case 'wiki':
          useUIStore.getState().openWikiReader(item.result.tag_id, item.result.tag_name);
          break;
        case 'chat':
          useUIStore.getState().openChatSidebar(undefined, item.result.id);
          void useChatStore.getState().openConversation(item.result.id);
          break;
        case 'tag': {
          const ancestorIds: string[] = [];
          const allTags = flattenTags(tags);
          const tagMap = new Map(allTags.map((tag) => [tag.id, tag]));
          let currentParentId = item.result.parent_id;
          while (currentParentId) {
            ancestorIds.push(currentParentId);
            currentParentId = tagMap.get(currentParentId)?.parent_id ?? null;
          }
          if (ancestorIds.length > 0) {
            useUIStore.getState().expandTagPath(ancestorIds);
          }
          useUIStore.getState().setSelectedTag(item.result.id);
          void useAtomsStore.getState().fetchAtomsByTag(item.result.id);
          break;
        }
      }
    },
    [flatItems, onClose, searchQuery, tags]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, totalItems - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          handleSelect(selectedIndex);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [selectedIndex, totalItems, handleSelect, onClose]
  );

  return {
    query,
    setQuery,
    prefix,
    mode,
    searchQuery,
    selectedIndex,
    isSearching,
    globalResults,
    hybridAtomResults,
    tagResults,
    handleKeyDown,
    handleSelect,
  };
}
