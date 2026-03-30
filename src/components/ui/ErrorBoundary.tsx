import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function ErrorFallback({ error, onReset }: { error: Error | null; onReset: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--color-bg-main)]">
      <div className="max-w-md w-full mx-4 p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <svg className="w-6 h-6 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Something went wrong</h2>
        </div>
        {error && (
          <p className="text-sm text-[var(--color-text-secondary)] mb-6 break-words">
            {error.message.length > 200 ? error.message.slice(0, 200) + '...' : error.message}
          </p>
        )}
        <div className="flex gap-3">
          <button
            onClick={onReset}
            className="flex-1 px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded-lg text-sm font-medium transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex-1 px-4 py-2 bg-[var(--color-bg-hover)] hover:bg-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg text-sm font-medium transition-colors"
          >
            Reload App
          </button>
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('React Error Boundary caught:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} onReset={this.handleReset} />;
    }
    return this.props.children;
  }
}
