import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { UserRejectedRequestError } from 'viem';
import { PrivyUnavailableError } from './errors.js';
import { PrivyBridge } from './PrivyBridge.js';
import { createPrivyRuntime } from './runtime.js';

type LoginCallbacks = { onComplete?: () => void; onError?: (code: string) => void };

const privy = vi.hoisted(() => ({
  state: {
    ready: true,
    authenticated: false,
    user: null as unknown,
    error: null as Error | null,
    logout: vi.fn(),
    isModalOpen: false,
  },
  wallets: { wallets: [] as unknown[], ready: true },
  login: vi.fn(),
  createWallet: vi.fn(),
  callbacks: [] as LoginCallbacks[],
}));

vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => privy.state,
  useWallets: () => privy.wallets,
  useCreateWallet: () => ({ createWallet: privy.createWallet }),
  useLogin: (callbacks: LoginCallbacks) => {
    privy.callbacks.push(callbacks);
    return { login: privy.login };
  },
}));

const embeddedWallet = (address: string, walletIndex: number) => ({
  address,
  walletClientType: 'privy',
  walletIndex,
  getEthereumProvider: vi.fn(),
  switchChain: vi.fn(),
});

beforeEach(() => {
  privy.state = { ready: true, authenticated: false, user: null, error: null, logout: vi.fn(), isModalOpen: false };
  privy.wallets = { wallets: [], ready: true };
  privy.login.mockReset();
  privy.callbacks = [];
});
afterEach(cleanup);

describe('PrivyBridge', () => {
  it('publishes Privy state, picking the first HD wallet whatever order Privy lists it in', () => {
    privy.state.authenticated = true;
    privy.state.user = { linkedAccounts: [{ type: 'wallet', walletClientType: 'privy', chainType: 'ethereum' }] };
    privy.wallets.wallets = [
      { address: '0x01', walletClientType: 'metamask' },
      embeddedWallet('0x03', 1),
      embeddedWallet('0x02', 0),
    ];
    const runtime = createPrivyRuntime();

    render(<PrivyBridge runtime={runtime} />);

    expect(runtime.getSnapshot()).toMatchObject({
      ready: true,
      authenticated: true,
      userLoaded: true,
      hasEmbeddedAccount: true,
    });
    expect(runtime.getSnapshot().embedded?.address).toBe('0x02');
  });

  it('publishes the embedded wallet as soon as Privy lists it, though useWallets().ready stays false', () => {
    // Privy's own flag also waits on external-wallet connectors, which the SDK's config turns off.
    privy.state.authenticated = true;
    privy.state.user = { linkedAccounts: [{ type: 'wallet', walletClientType: 'privy', chainType: 'ethereum' }] };
    privy.wallets = { wallets: [], ready: false };
    const runtime = createPrivyRuntime();
    const { rerender } = render(<PrivyBridge runtime={runtime} />);
    expect(runtime.getSnapshot().embedded).toBeUndefined();

    privy.wallets = { wallets: [embeddedWallet('0x02', 0)], ready: false };
    rerender(<PrivyBridge runtime={runtime} />);

    expect(runtime.getSnapshot()).toMatchObject({ hasEmbeddedAccount: true });
    expect(runtime.getSnapshot().embedded?.address).toBe('0x02');
  });

  it('publishes whether Privy has a modal on screen', () => {
    privy.state.isModalOpen = true;
    const runtime = createPrivyRuntime();

    render(<PrivyBridge runtime={runtime} />);

    expect(runtime.getSnapshot().modalOpen).toBe(true);
  });

  it('opens the login modal and rejects only when the user closes it', async () => {
    const runtime = createPrivyRuntime();
    render(<PrivyBridge runtime={runtime} />);

    const loggingIn = runtime.login();
    expect(privy.login).toHaveBeenCalledOnce();
    privy.callbacks.at(-1)?.onError?.('invalid_credentials');
    privy.callbacks.at(-1)?.onError?.('exited_auth_flow');

    await expect(loggingIn).rejects.toBeInstanceOf(UserRejectedRequestError);
  });

  it('keeps the login callbacks object stable across renders', () => {
    const runtime = createPrivyRuntime();
    const { rerender } = render(<PrivyBridge runtime={runtime} />);
    rerender(<PrivyBridge runtime={runtime} />);

    expect(new Set(privy.callbacks).size).toBe(1);
  });

  it("survives StrictMode's simulated unmount: a restore waiting on Privy is not cut off", async () => {
    privy.state.ready = false;
    const runtime = createPrivyRuntime();
    const restoring = runtime.waitFor(s => s.ready, 1_000);

    const { rerender } = render(
      <StrictMode>
        <PrivyBridge runtime={runtime} />
      </StrictMode>,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    privy.state = { ...privy.state, ready: true };
    rerender(
      <StrictMode>
        <PrivyBridge runtime={runtime} />
      </StrictMode>,
    );

    await expect(restoring).resolves.toMatchObject({ ready: true });
  });

  it('rejects a pending login and resets the snapshot when the bridge unmounts', async () => {
    const runtime = createPrivyRuntime();
    const { unmount } = render(<PrivyBridge runtime={runtime} />);
    const loggingIn = expect(runtime.login()).rejects.toBeInstanceOf(PrivyUnavailableError);

    unmount();

    await loggingIn;
    expect(runtime.getSnapshot().ready).toBe(false);
  });
});
