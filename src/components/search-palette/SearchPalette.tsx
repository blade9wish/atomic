import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, FileText, Hash, MessageCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CommandInput } from '../command-palette/CommandInput';
import { useSearchPalette } from './useSearchPalette';
import {
  GlobalChatSearchResult,
  GlobalTagSearchResult,
  GlobalWikiSearchResult,
  SemanticSearchResult,
} from '../command-palette/types';

interface SearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide flex items-center justify-between">
      <span>{label}</span>
      <span className="normal-case font-normal">{count}</span>
    </div>
  );
}

function SnippetMarkdown({ content }: { content: string }) {
  return (
    <div className="mt-1 h-10 overflow-hidden text-xs leading-5 text-[var(--color-text-secondary)] [&_p]:m-0 [&_p]:inline [&_strong]:font-medium [&_strong]:text-[var(--color-text-primary)] [&_em]:italic [&_code]:rounded [&_code]:bg-[var(--color-bg-main)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.95em] [&_del]:opacity-80 [&_ul]:m-0 [&_ol]:m-0 [&_li]:inline [&_li]:list-none [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_h4]:m-0 [&_h5]:m-0 [&_h6]:m-0 [&_h1]:inline [&_h2]:inline [&_h3]:inline [&_h4]:inline [&_h5]:inline [&_h6]:inline [&_blockquote]:m-0 [&_blockquote]:inline [&_pre]:m-0 [&_pre]:inline [&_pre]:bg-transparent">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children }) => <>{children}</>,
          img: () => null,
          hr: () => <> </>,
          br: () => <> </>,
          p: ({ children }) => <>{children}</>,
          li: ({ children }) => <>{children} </>,
          ul: ({ children }) => <>{children}</>,
          ol: ({ children }) => <>{children}</>,
          h1: ({ children }) => <>{children}</>,
          h2: ({ children }) => <>{children}</>,
          h3: ({ children }) => <>{children}</>,
          h4: ({ children }) => <>{children}</>,
          h5: ({ children }) => <>{children}</>,
          h6: ({ children }) => <>{children}</>,
          blockquote: ({ children }) => <>{children}</>,
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => <>{children}</>,
          thead: ({ children }) => <>{children}</>,
          tbody: ({ children }) => <>{children}</>,
          tr: ({ children }) => <>{children} </>,
          th: ({ children }) => <>{children} </>,
          td: ({ children }) => <>{children} </>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function PaletteItem({
  selected,
  onClick,
  icon,
  title,
  subtitle,
  meta,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  meta?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
        selected
          ? 'bg-[var(--color-bg-hover)] border-l-2 border-[var(--color-accent)]'
          : 'border-l-2 border-transparent hover:bg-[var(--color-bg-hover)]'
      }`}
    >
      <span className="text-[var(--color-text-secondary)] mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{title}</span>
          {meta ? <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0">{meta}</span> : null}
        </div>
        {subtitle ? <SnippetMarkdown content={subtitle} /> : null}
      </div>
    </button>
  );
}

function atomTitle(result: SemanticSearchResult): string {
  const firstLine = result.content.split('\n')[0].trim().replace(/^#+\s*/, '');
  return firstLine || 'Untitled';
}

export function SearchPalette({ isOpen, onClose, initialQuery = '' }: SearchPaletteProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const {
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
  } = useSearchPalette({ isOpen, onClose, initialQuery });

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  const handleInputChange = (value: string) => {
    setQuery(prefix ? `${prefix.token}${value}` : value);
  };

  const handleClearPrefix = () => {
    setQuery(searchQuery);
  };

  let runningIndex = 0;

  const renderAtoms = (results: SemanticSearchResult[]) => {
    if (results.length === 0) return null;
    const start = runningIndex;
    runningIndex += results.length;
    return (
      <div className="mb-2">
        <SectionHeader label="Atoms" count={results.length} />
        {results.map((result, idx) => (
          <PaletteItem
            key={`atom-${result.id}`}
            selected={selectedIndex === start + idx}
            onClick={() => handleSelect(start + idx)}
            icon={<FileText className="w-4 h-4" strokeWidth={2} />}
            title={atomTitle(result)}
            subtitle={result.matching_chunk_content}
            meta={`${Math.round(result.similarity_score * 100)}%`}
          />
        ))}
      </div>
    );
  };

  const renderWiki = (results: GlobalWikiSearchResult[]) => {
    if (results.length === 0) return null;
    const start = runningIndex;
    runningIndex += results.length;
    return (
      <div className="mb-2">
        <SectionHeader label="Wiki" count={results.length} />
        {results.map((result, idx) => (
          <PaletteItem
            key={`wiki-${result.id}`}
            selected={selectedIndex === start + idx}
            onClick={() => handleSelect(start + idx)}
            icon={<BookOpen className="w-4 h-4" strokeWidth={2} />}
            title={result.tag_name}
            subtitle={result.content_snippet}
            meta={`${result.atom_count} atoms`}
          />
        ))}
      </div>
    );
  };

  const renderChats = (results: GlobalChatSearchResult[]) => {
    if (results.length === 0) return null;
    const start = runningIndex;
    runningIndex += results.length;
    return (
      <div className="mb-2">
        <SectionHeader label="Chats" count={results.length} />
        {results.map((result, idx) => (
          <PaletteItem
            key={`chat-${result.id}`}
            selected={selectedIndex === start + idx}
            onClick={() => handleSelect(start + idx)}
            icon={<MessageCircle className="w-4 h-4" strokeWidth={2} />}
            title={result.title || 'Untitled conversation'}
            subtitle={result.matching_message_content}
            meta={`${result.message_count} messages`}
          />
        ))}
      </div>
    );
  };

  const renderTags = (results: GlobalTagSearchResult[]) => {
    if (results.length === 0) return null;
    const start = runningIndex;
    runningIndex += results.length;
    return (
      <div className="mb-2">
        <SectionHeader label="Tags" count={results.length} />
        {results.map((result, idx) => (
          <PaletteItem
            key={`tag-${result.id}`}
            selected={selectedIndex === start + idx}
            onClick={() => handleSelect(start + idx)}
            icon={<Hash className="w-4 h-4" strokeWidth={2} />}
            title={result.name}
            meta={`${result.atom_count} atoms`}
          />
        ))}
      </div>
    );
  };

  const showEmptyState =
    !isSearching &&
    searchQuery.trim().length >= 2 &&
    ((mode === 'tags' && tagResults.length === 0) ||
      (mode === 'atoms-hybrid' && hybridAtomResults.length === 0) ||
      (mode === 'global' &&
        globalResults.atoms.length === 0 &&
        globalResults.wiki.length === 0 &&
        globalResults.chats.length === 0 &&
        globalResults.tags.length === 0));

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      data-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm safe-area-padding"
    >
      <div className="w-full max-w-2xl mx-4 bg-[var(--color-bg-panel)] rounded-xl shadow-2xl border border-[var(--color-border)] animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
        <CommandInput
          query={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          isSearching={isSearching}
          prefix={prefix}
          onClearPrefix={handleClearPrefix}
          shortcutHint="⌘P"
          placeholder={
            mode === 'tags'
              ? 'Search tags...'
              : mode === 'atoms-hybrid'
                ? 'Search atoms semantically...'
                : 'Search atoms, wiki, chats, and tags...'
          }
        />

        <div className="overflow-y-auto max-h-[50vh] py-2">
          {!searchQuery.trim() ? (
            <div className="px-4 py-8 text-center text-[var(--color-text-tertiary)] text-sm">
              Start typing to search across Atomic. Use `#` for tags or `&gt;` for semantic atom search.
            </div>
          ) : searchQuery.trim().length < 2 && mode !== 'tags' ? (
            <div className="px-4 py-8 text-center text-[var(--color-text-tertiary)] text-sm">
              Type at least 2 characters to search.
            </div>
          ) : null}

          {mode === 'global' && searchQuery.trim().length >= 2 ? (
            <>
              {renderAtoms(globalResults.atoms)}
              {renderWiki(globalResults.wiki)}
              {renderChats(globalResults.chats)}
              {renderTags(globalResults.tags)}
            </>
          ) : null}

          {mode === 'atoms-hybrid' && searchQuery.trim().length >= 2 ? renderAtoms(hybridAtomResults) : null}

          {mode === 'tags' && searchQuery.trim().length >= 2 ? renderTags(tagResults) : null}

          {showEmptyState ? (
            <div className="px-4 py-8 text-center text-[var(--color-text-tertiary)] text-sm">
              No matches found for "{searchQuery}".
            </div>
          ) : null}
        </div>

        <div className="px-4 py-2 border-t border-[var(--color-border)] flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">esc</kbd>
              close
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">#</kbd>
              tags only
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">&gt;</kbd>
              semantic atoms
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
