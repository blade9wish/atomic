import { useRef, useEffect, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AtomEditor } from '../atoms/AtomEditor';
import { AtomViewer } from '../atoms/AtomViewer';
import { WikiViewer } from '../wiki/WikiViewer';
import { ChatViewer } from '../chat/ChatViewer';
import { useUIStore } from '../../stores/ui';
import { useAtomsStore, type AtomWithTags } from '../../stores/atoms';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useKeyboard } from '../../hooks/useKeyboard';

// Benchmarking helper
const PERF_DEBUG = true;
const perfLog = (label: string, startTime?: number) => {
  if (!PERF_DEBUG) return;
  if (startTime !== undefined) {
    console.log(`[RightDrawer] ${label}: ${(performance.now() - startTime).toFixed(2)}ms`);
  } else {
    console.log(`[RightDrawer] ${label}`);
  }
};

export function RightDrawer() {
  const { drawerState, closeDrawer, openDrawer } = useUIStore();
  const drawerRef = useRef<HTMLDivElement>(null);
  const openTimeRef = useRef<number | null>(null);

  const { isOpen, mode, atomId, tagId, tagName, conversationId } = drawerState;

  const [atom, setAtom] = useState<AtomWithTags | null>(null);
  const [isLoadingAtom, setIsLoadingAtom] = useState(false);

  // Watch the atoms store for updates to the currently viewed atom
  const storeAtom = useAtomsStore((s) =>
    atomId ? s.atoms.find((a) => a.id === atomId) : undefined
  );

  // Track drawer open/close timing
  useEffect(() => {
    if (isOpen) {
      openTimeRef.current = performance.now();
      perfLog(`Drawer OPENING (mode=${mode}, atomId=${atomId?.slice(0, 8)}...)`);
    } else if (openTimeRef.current !== null) {
      perfLog('Drawer CLOSED, total open duration', openTimeRef.current);
      openTimeRef.current = null;
    }
  }, [isOpen, mode, atomId]);

  // Fetch atom from database when viewing
  useEffect(() => {
    if (mode === 'viewer' && atomId) {
      const fetchStart = performance.now();
      perfLog('Atom fetch START');
      setIsLoadingAtom(true);
      invoke<AtomWithTags | null>('get_atom_by_id', { id: atomId })
        .then((fetchedAtom) => {
          perfLog('Atom fetch COMPLETE', fetchStart);
          if (fetchedAtom) {
            perfLog(`  Content length: ${fetchedAtom.content.length} chars`);
            perfLog(`  Tags: ${fetchedAtom.tags.length}`);
          }
          setAtom(fetchedAtom);
          setIsLoadingAtom(false);
        })
        .catch((error) => {
          console.error('Failed to fetch atom:', error);
          perfLog('Atom fetch FAILED', fetchStart);
          setAtom(null);
          setIsLoadingAtom(false);
        });
    } else {
      setAtom(null);
    }
  }, [mode, atomId]);

  // Update local atom state when the store atom changes (e.g., after tag extraction)
  useEffect(() => {
    if (mode === 'viewer' && atomId && storeAtom && !isLoadingAtom) {
      setAtom(storeAtom);
    }
  }, [mode, atomId, storeAtom, isLoadingAtom]);

  // Close on click outside
  useClickOutside(drawerRef, closeDrawer, isOpen);

  // Close on Escape key
  useKeyboard('Escape', closeDrawer, isOpen);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleEdit = useCallback(() => {
    if (atomId) {
      openDrawer('editor', atomId);
    }
  }, [atomId, openDrawer]);

  const renderContent = () => {
    const renderStart = performance.now();
    let result: React.ReactNode = null;
    let contentType = 'unknown';

    switch (mode) {
      case 'editor':
        contentType = 'editor';
        result = <AtomEditor atomId={atomId} onClose={closeDrawer} />;
        break;
      case 'viewer':
        if (isLoadingAtom) {
          contentType = 'viewer-loading';
          result = (
            <div className="flex items-center justify-center h-full text-[var(--color-text-secondary)]">
              Loading...
            </div>
          );
          break;
        }
        if (!atom) {
          contentType = 'viewer-not-found';
          result = (
            <div className="flex items-center justify-center h-full text-[var(--color-text-secondary)]">
              Atom not found
            </div>
          );
          break;
        }
        contentType = 'viewer-atom';
        result = <AtomViewer atom={atom} onClose={closeDrawer} onEdit={handleEdit} />;
        break;
      case 'wiki':
        if (!tagId || !tagName) {
          contentType = 'wiki-no-tag';
          result = (
            <div className="flex items-center justify-center h-full text-[var(--color-text-secondary)]">
              No tag selected
            </div>
          );
          break;
        }
        contentType = 'wiki';
        result = <WikiViewer tagId={tagId} tagName={tagName} />;
        break;
      case 'chat':
        contentType = 'chat';
        // Only render when open to ensure proper initialization on each open
        result = isOpen ? <ChatViewer initialTagId={tagId} initialConversationId={conversationId} /> : null;
        break;
      default:
        contentType = 'null';
        result = null;
    }

    perfLog(`renderContent (${contentType}) JSX creation`, renderStart);
    return result;
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed top-0 right-0 h-full w-[75vw] min-w-[600px] max-w-[1200px] bg-[var(--color-bg-panel)] border-l border-[var(--color-border)] shadow-2xl z-50 transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ backdropFilter: 'blur(var(--backdrop-blur))' }}
      >
        {renderContent()}
      </div>
    </>
  );
}

