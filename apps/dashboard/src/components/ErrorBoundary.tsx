import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught:", error, info);
    this.setState({ error, info });
    this.props.onError?.(error);
  }

  reset = (): void => {
    this.setState({ error: null, info: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="h-full flex items-center justify-center bg-stone-950 p-8">
          <div className="max-w-2xl w-full space-y-4">
            <div className="flex items-center gap-2 text-accent-amber">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h2 className="text-lg font-semibold">This page hit an error</h2>
            </div>
            <p className="text-stone-400 text-sm">
              {this.state.error.message || String(this.state.error)}
            </p>
            {this.state.error.stack && (
              <details className="text-xs text-stone-600">
                <summary className="cursor-pointer hover:text-stone-400 mb-2">Stack trace</summary>
                <pre className="whitespace-pre-wrap bg-stone-900/60 p-3 rounded-md overflow-auto max-h-96 font-mono">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <div className="flex gap-2 pt-2">
              <button
                onClick={this.reset}
                className="px-3 py-1.5 text-xs font-medium text-stone-300 bg-stone-800 rounded-md hover:bg-stone-700 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => { window.location.href = "/"; }}
                className="px-3 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-300 transition-colors"
              >
                Back to home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
