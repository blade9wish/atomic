import { useCallback } from 'react';
import { Toaster } from 'sonner';
import { Layout } from './components/layout';
import { LocalGraphView } from './components/canvas';
import { useEmbeddingEvents } from './hooks';
import { useUIStore } from './stores/ui';

function App() {
  // Initialize embedding event listener
  useEmbeddingEvents();

  const openDrawer = useUIStore(s => s.openDrawer);

  const handleAtomClick = useCallback((atomId: string) => {
    openDrawer('viewer', atomId);
  }, [openDrawer]);

  return (
    <>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          className: 'atomic-toast',
          duration: 5000,
        }}
      />
      <Layout />
      <LocalGraphView onAtomClick={handleAtomClick} />
    </>
  );
}

export default App;

