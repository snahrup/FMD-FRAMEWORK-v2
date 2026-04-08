// ============================================================================
// ErrorBoundary — Catches uncaught JS errors and prevents white-screen crash
//
// Wraps the route tree so any component error shows a friendly fallback
// instead of crashing the entire React app to a blank page.
// ============================================================================

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary] Uncaught error:", error);
      console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
    }
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="rounded-lg border border-stone-300 bg-stone-50 p-8 shadow-sm" style={{ maxWidth: 480 }}>
            <h1 className="text-xl font-semibold" style={{ color: "#1C1917" }}>
              Something went wrong
            </h1>
            <p className="mt-2 text-sm" style={{ color: "#78716C" }}>
              An unexpected error occurred. Try reloading the page.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <pre
                className="mt-4 max-h-40 overflow-auto rounded border border-stone-200 bg-stone-100 p-3 text-left text-xs"
                style={{ color: "#78716C", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="mt-6 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: "#292524" }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
