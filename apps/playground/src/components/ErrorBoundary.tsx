import { Component, type ErrorInfo, type ReactNode } from 'react';

type State = { error: Error | undefined };

/** This page is meant to be embedded, so a render crash must not leave a blank rectangle in someone else's site. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Playground crashed', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app">
        <section className="card">
          {/* The message stays in the console: this rectangle renders inside someone else's site. */}
          <div className="alert" role="alert">
            The widget hit an unexpected error and stopped.
          </div>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      </div>
    );
  }
}
