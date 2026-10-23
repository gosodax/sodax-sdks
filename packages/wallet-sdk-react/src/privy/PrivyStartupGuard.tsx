import { Component, type ReactNode } from 'react';
import type { PrivyRuntime } from './runtime.js';

type Props = { runtime: PrivyRuntime; fallback: ReactNode; children?: ReactNode };
type State = { error: Error | null };
type PassThroughState = { thrown?: { error: unknown } };

// Errors thrown by the app's own tree: the app's to handle, never a sign that Privy could not start.
const appErrors = new WeakSet<Error>();

/** Wraps the app's own tree, with or without Privy: marks what it throws and passes it on unchanged. */
export class AppErrorPassThrough extends Component<{ children?: ReactNode }, PassThroughState> {
  override state: PassThroughState = {};

  static getDerivedStateFromError(error: unknown): PassThroughState {
    if (error instanceof Error) appErrors.add(error);
    return { thrown: { error } };
  }

  override render() {
    if (this.state.thrown) throw this.state.thrown.error;
    return this.props.children;
  }
}

/**
 * Keeps the app running when `PrivyProvider` cannot start — it throws while rendering on a plain-http
 * origin, with a malformed app id, or inside another `PrivyProvider`. The children then render without
 * Privy and "Email (Privy)" rejects with the cause. Errors from the app's own tree (`AppErrorPassThrough`),
 * and any error once Privy has started, pass through untouched.
 */
export class PrivyStartupGuard extends Component<Props, State> {
  override state: State = { error: null };
  private started = false;

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidMount() {
    this.started = this.state.error === null;
  }

  override componentDidCatch(error: unknown) {
    if (this.passesThrough(error)) return;
    const cause = error instanceof Error ? error : new Error(String(error));
    this.props.runtime.fail(cause);
    console.error('[wallet-sdk-react/privy] Privy could not start; continuing without "Email (Privy)".', cause);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Not a start-up failure: the app's own error boundaries decide what happens.
    if (this.passesThrough(error)) throw error;
    return this.props.fallback;
  }

  private passesThrough(error: unknown) {
    return this.started || (error instanceof Error && appErrors.has(error));
  }
}
