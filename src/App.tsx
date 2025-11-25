import { Layout } from './components/layout';
import { useEmbeddingEvents } from './hooks';

function App() {
  // Initialize embedding event listener
  useEmbeddingEvents();
  
  return <Layout />;
}

export default App;

