import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAtomsStore } from '../stores/atoms';

interface EmbeddingCompletePayload {
  atom_id: string;
  status: 'complete' | 'failed';
  error?: string;
}

export function useEmbeddingEvents() {
  const updateAtomStatus = useAtomsStore((s) => s.updateAtomStatus);
  
  useEffect(() => {
    const unlisten = listen<EmbeddingCompletePayload>('embedding-complete', (event) => {
      console.log('Embedding complete event:', event.payload);
      updateAtomStatus(event.payload.atom_id, event.payload.status);
    });
    
    return () => {
      unlisten.then(fn => fn());
    };
  }, [updateAtomStatus]);
}

