import { lazy, Suspense } from 'react';
import { Toaster } from 'sonner';
import { Layout } from './components/layout';
import { useEmbeddingEvents } from './hooks';

const LayoutDebug = lazy(() => import('./components/dev/LayoutDebug'));

function App() {
  // Dev-only harness for comparing view/edit layout. Not included on normal paths.
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('layout-debug') === '1') {
    return (
      <Suspense fallback={null}>
        <LayoutDebug />
      </Suspense>
    );
  }

  // Initialize embedding event listener
  useEmbeddingEvents();

  return (
    <>
      <Toaster
        position="bottom-right"
        theme="dark"
        // Lift toasts above the iOS home indicator on Capacitor; no-op on
        // desktop where env(safe-area-inset-bottom) is 0.
        offset={{ bottom: 'calc(16px + env(safe-area-inset-bottom))', right: 'calc(16px + env(safe-area-inset-right))' }}
        toastOptions={{
          className: 'atomic-toast',
          duration: 5000,
        }}
      />
      <Layout />
    </>
  );
}

export default App;

