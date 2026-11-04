import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Component, createContext, type ReactNode, useContext, useState } from 'react';
import { AppErrorPassThrough, PrivyStartupGuard } from './PrivyStartupGuard.js';
import { createPrivyRuntime } from './runtime.js';

class AppBoundary extends Component<{ children?: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? <span>app boundary: {this.state.error.message}</span> : this.props.children;
  }
}

function FailsToStart(): ReactNode {
  throw new Error('Embedded wallet is only available over HTTPS');
}

// Stands in for `PrivyProvider`: an app error that needs it would vanish if the app re-rendered without Privy.
const InsidePrivy = createContext(false);

function FailsInsidePrivy(): ReactNode {
  if (useContext(InsidePrivy)) throw new Error('partner bug');
  return <span>running without Privy</span>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PrivyStartupGuard', () => {
  it('renders the app without Privy when PrivyProvider throws while starting, and reports the cause', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = createPrivyRuntime();
    const fail = vi.spyOn(runtime, 'fail');

    const { getByText } = render(
      <PrivyStartupGuard runtime={runtime} fallback={<span>app</span>}>
        <FailsToStart />
      </PrivyStartupGuard>,
    );

    expect(getByText('app')).toBeTruthy();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Embedded wallet is only available over HTTPS' }),
    );
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('Privy could not start'), expect.any(Error));
  });

  it("hands errors thrown after a successful start to the app's own boundaries", () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = createPrivyRuntime();
    const fail = vi.spyOn(runtime, 'fail');
    let breakChild: () => void = () => undefined;
    function Child() {
      const [broken, setBroken] = useState(false);
      breakChild = () => setBroken(true);
      if (broken) throw new Error('partner bug');
      return <span>running</span>;
    }

    const { getByText } = render(
      <AppBoundary>
        <PrivyStartupGuard runtime={runtime} fallback={<span>fallback</span>}>
          <Child />
        </PrivyStartupGuard>
      </AppBoundary>,
    );
    expect(getByText('running')).toBeTruthy();
    act(() => breakChild());

    expect(getByText('app boundary: partner bug')).toBeTruthy();
    expect(fail).not.toHaveBeenCalled();
  });

  it("hands an error the app throws on its first render to the app's own boundaries, not to the fallback", () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = createPrivyRuntime();
    const fail = vi.spyOn(runtime, 'fail');
    const app = (
      <AppErrorPassThrough>
        <FailsInsidePrivy />
      </AppErrorPassThrough>
    );

    const { getByText } = render(
      <AppBoundary>
        <PrivyStartupGuard runtime={runtime} fallback={app}>
          <InsidePrivy.Provider value={true}>{app}</InsidePrivy.Provider>
        </PrivyStartupGuard>
      </AppBoundary>,
    );

    expect(getByText('app boundary: partner bug')).toBeTruthy();
    expect(fail).not.toHaveBeenCalled();
  });
});
