import { type Address, getAddress, numberToHex, SwitchChainError } from 'viem';
import { ChainNotConfiguredError, type Config, type CreateConnectorFn, createConnector } from 'wagmi';
import { EVM_DEFAULT_PERSIST_KEY } from '@/constants.js';
import {
  INTERNAL_CALL_MS,
  PRIVY_CONNECTOR_ID,
  PRIVY_CONNECTOR_NAME,
  READY_CONNECT_MS,
  RECONNECT_BUDGET_MS,
  WALLET_MS,
} from './constants.js';
import { createDeferredProvider, type DeferredProvider, type Eip1193Like } from './deferredProvider.js';
import { PrivySessionError, PrivyTimeoutError, userRejected, withTimeout } from './errors.js';
import { PRIVY_ICON } from './icon.js';
import type { EmbeddedWallet, PrivyRuntime, PrivySnapshot } from './runtime.js';
import { createStoredFlag } from './storedFlag.js';

type PrivyConnectorOptions = {
  runtime: PrivyRuntime;
  /** wagmi's live state, for the supersession check (`CreateConnectorFn` does not receive it). */
  getState: () => Config['state'];
  /** Chain reported before the first connection. */
  defaultChainId: number;
  /** `'detach'` keeps the Privy session on disconnect; see `PrivyOptions.disconnectBehavior`. @default 'logout' */
  disconnectBehavior?: 'logout' | 'detach';
};

/** `wallet` is the one whose provider is attached; a replacement takes its place only once attached. */
type Session = { readonly address: Address; readonly wallet: EmbeddedWallet };
type Replacement = { readonly wallet: EmbeddedWallet; readonly chainId: number | undefined };

export type PrivyConnectorHandle = {
  readonly connector: CreateConnectorFn;
  /**
   * An SDK disconnect, which must reach Privy even before wagmi lists it (a restore or login in flight).
   * A no-op when Privy is neither connected, connecting, nor restorable on reload.
   */
  readonly disconnect: () => Promise<void>;
};

/** The session's wallet in `snapshot`: `'ended'` on logout or a user change, `'pending'` while Privy reloads. */
function sessionWallet(snapshot: PrivySnapshot, address: Address): EmbeddedWallet | 'ended' | 'pending' {
  if (snapshot.ready && !snapshot.authenticated) return 'ended';
  // Mid-reload: Privy is not ready, or the user's linked wallet is not listed yet.
  if (!snapshot.ready || !snapshot.userLoaded || (snapshot.hasEmbeddedAccount && !snapshot.embedded)) return 'pending';
  const wallet = snapshot.embedded;
  // Fail closed: never follow a different address for an intent-signing session.
  return wallet && getAddress(wallet.address) === address ? wallet : 'ended';
}

/**
 * wagmi connector for the Privy embedded wallet. It never imports Privy: `PrivyBridge` feeds it through
 * `runtime`, and wagmi holds a stable deferred provider the embedded wallet is attached behind.
 */
export function privyConnector({
  runtime,
  getState,
  defaultChainId,
  disconnectBehavior = 'logout',
}: PrivyConnectorOptions): PrivyConnectorHandle {
  let sdkDisconnect: (() => Promise<void>) | undefined;
  const connector = createConnector<DeferredProvider>(config => {
    const prefix = `${config.storage?.key ?? EVM_DEFAULT_PERSIST_KEY}.privy`;
    const flag = createStoredFlag(`${prefix}.connected`);
    // A sign-out the user asked for that Privy has not confirmed yet; stored so it outlives a reload or a
    // closed tab, and held in memory so a refused storage write cannot drop it in this tab.
    const storedSignOut = createStoredFlag(`${prefix}.signout`);
    let signOutPending = false;
    const signOutOwed = {
      read: () => signOutPending || storedSignOut.read(),
      write: () => {
        signOutPending = true;
        storedSignOut.write();
      },
      clear: () => {
        signOutPending = false;
        storedSignOut.clear();
      },
    };
    const deferred = createDeferredProvider(chainId => switchChain(chainId));
    let session: Session | undefined;
    let chainId: number | undefined; // last chain verified on the attached provider
    let attempt: AbortController | undefined;
    let attemptIsInteractive = false; // started by a user connect, not by wagmi's restore
    let unwatch: (() => void) | undefined;
    let switching = false;
    let replacing: Replacement | undefined; // a replacement wallet's provider being prepared
    let signingOut: Promise<void> | undefined;

    const readChainId = async (provider: Eip1193Like, signal?: AbortSignal) =>
      Number(await withTimeout(provider.request({ method: 'eth_chainId' }), INTERNAL_CALL_MS, 'eth_chainId', signal));

    const requestSwitch = (provider: Eip1193Like, target: number, signal?: AbortSignal) =>
      withTimeout(
        provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(target) }] }),
        INTERNAL_CALL_MS,
        'wallet_switchEthereumChain',
        signal,
      );

    // Changes no connector state; it may switch the provider's own chain: a provider from
    // `getEthereumProvider()` starts on the chain Privy last recorded, so it is pulled to `alignTo` first.
    async function prepare(wallet: EmbeddedWallet, alignTo: number | undefined, signal?: AbortSignal) {
      const provider = await withTimeout(wallet.getEthereumProvider(), INTERNAL_CALL_MS, 'getEthereumProvider', signal);
      let current = await readChainId(provider, signal);
      if (alignTo !== undefined && current !== alignTo) {
        await requestSwitch(provider, alignTo, signal);
        current = alignTo;
      }
      return { provider, chainId: current };
    }

    function detachSession() {
      unwatch?.();
      unwatch = undefined;
      replacing = undefined;
      deferred.detach();
      session = undefined;
    }

    function resetSession() {
      detachSession();
      chainId = undefined;
      flag.clear();
    }

    function endSession() {
      resetSession();
      config.emitter.emit('disconnect');
    }

    // Never awaited by `disconnect()`: wagmi rewrites its connection list once that resolves, dropping any
    // wallet connected meanwhile. Privy must be ready to sign out, which it may not be right after a reload.
    function signOut(): Promise<void> {
      signingOut ??= (async () => {
        try {
          await runtime.waitFor(s => s.ready, READY_CONNECT_MS, undefined, 'Waiting for Privy to sign out');
          await withTimeout(runtime.logout(), INTERNAL_CALL_MS, 'logout');
          await runtime.waitFor(s => !s.authenticated, INTERNAL_CALL_MS, undefined, 'Waiting for the Privy sign-out');
          signOutOwed.clear();
        } catch {
          // Still owed: the next connect signs out again before it trusts `authenticated`.
        } finally {
          signingOut = undefined;
        }
      })();
      return signingOut;
    }

    async function disconnect() {
      attempt?.abort(userRejected('Disconnected while connecting.'));
      attempt = undefined;
      resetSession();
      if (disconnectBehavior === 'detach') return;
      signOutOwed.write();
      void signOut();
    }

    sdkDisconnect = async () => {
      if (!attempt && !session && !flag.read()) return;
      await disconnect();
    };

    // Privy's provider reports neither logout nor a user change, so the connector watches the runtime.
    function onRuntimeChange() {
      const current = session;
      if (!current || switching) return;
      const wallet = sessionWallet(runtime.getSnapshot(), current.address);
      if (wallet === 'ended') return endSession();
      if (wallet === 'pending' || wallet === current.wallet) return;
      if (replacing?.wallet === wallet && replacing.chainId === chainId) return;
      const pending: Replacement = { wallet, chainId };
      replacing = pending;
      prepare(wallet, pending.chainId).then(
        ({ provider }) => {
          if (replacing !== pending) return; // detached, or a newer replacement took over
          replacing = undefined;
          // Mid-switch: the switch's own final check prepares it again for the chain it lands on.
          if (switching) return;
          session = { ...current, wallet };
          deferred.attach(provider);
        },
        () => {
          // Keep the previous attachment; it still signs for the same address. The next Privy update retries.
          if (replacing === pending) replacing = undefined;
        },
      );
    }

    function watch() {
      unwatch?.();
      unwatch = runtime.subscribe(onRuntimeChange);
    }

    async function switchChain(target: number) {
      const chain = config.chains.find(candidate => candidate.id === target);
      if (!chain) throw new SwitchChainError(new ChainNotConfiguredError());
      const provider = deferred.current();
      const current = session;
      if (!provider || !current) throw new SwitchChainError(new Error('The Privy wallet is not connected.'));
      switching = true;
      try {
        await requestSwitch(provider, target);
        // Best effort: keeps Privy's own per-wallet chain in step; `prepare` re-aligns a provider if it lags.
        await withTimeout(current.wallet.switchChain(target), INTERNAL_CALL_MS, 'switchChain').catch(() => undefined);
        const actual = await readChainId(provider);
        if (actual !== target) {
          throw new SwitchChainError(
            new Error(`The Privy wallet reports chain ${actual} after switching to ${target}.`),
          );
        }
        chainId = target;
        config.emitter.emit('change', { chainId: target });
        return chain;
      } finally {
        switching = false;
        if (unwatch) onRuntimeChange(); // a logout that arrived mid-switch
      }
    }

    return {
      id: PRIVY_CONNECTOR_ID,
      name: PRIVY_CONNECTOR_NAME,
      type: 'privy',
      icon: PRIVY_ICON,

      async connect({ chainId: requested, isReconnecting } = {}) {
        // Already attached (e.g. wagmi re-running its reconnect): report the live session, do not rebuild it.
        if (session && deferred.current()) {
          if (requested !== undefined && requested !== chainId) await switchChain(requested);
          return { accounts: [session.address], chainId: chainId ?? defaultChainId };
        }

        // A background restore stands down rather than cancel a connect the user started (its login may be open).
        if (isReconnecting && attempt && attemptIsInteractive) {
          throw new Error('[wallet-sdk-react/privy] A connection the user started is still in progress.');
        }
        attempt?.abort(userRejected('Superseded by a newer connection attempt.'));
        const controller = new AbortController();
        attempt = controller;
        attemptIsInteractive = !isReconnecting;
        const { signal } = controller;
        // wagmi restores wallets one after another: the whole restore gets one budget, not one per step.
        const budget = isReconnecting
          ? setTimeout(
              () => controller.abort(new PrivyTimeoutError('Restoring the Privy session', RECONNECT_BUDGET_MS)),
              RECONNECT_BUDGET_MS,
            )
          : undefined;
        const startCurrent = getState().current;
        let loggedIn = false;

        try {
          let ready = await runtime.waitFor(s => s.ready, READY_CONNECT_MS, signal, 'Waiting for Privy to be ready');
          // Until Privy confirms an owed sign-out, `authenticated` may still be the previous user's session.
          if (signOutOwed.read()) {
            if (isReconnecting) throw new PrivySessionError('The Privy session was signed out.');
            await signOut();
            signal.throwIfAborted();
            if (signOutOwed.read()) {
              throw new PrivySessionError('Could not sign out of the previous Privy session.');
            }
            ready = runtime.getSnapshot();
          }
          if (!ready.authenticated) {
            if (isReconnecting) {
              flag.clear();
              throw new PrivySessionError('The Privy session has ended.');
            }
            await runtime.login(signal);
            loggedIn = true;
          }
          const user = await runtime.waitFor(
            s => s.authenticated && s.userLoaded,
            WALLET_MS,
            signal,
            'Waiting for the Privy user',
          );
          if (!user.hasEmbeddedAccount) {
            if (isReconnecting) {
              flag.clear();
              throw new PrivySessionError('The Privy user has no embedded wallet.');
            }
            // Only on positive evidence: createWallet() throws for a user who already has one.
            await withTimeout(runtime.createWallet(), WALLET_MS, 'Creating the Privy wallet', signal).catch(
              () => undefined,
            );
          }
          const { embedded } = await runtime.waitFor(
            s => s.embedded !== undefined || (s.ready && !s.authenticated),
            WALLET_MS,
            signal,
            'Waiting for the Privy embedded wallet',
          );
          if (!embedded) throw new PrivySessionError('The Privy session has ended.');

          const prepared = await prepare(embedded, undefined, signal);
          signal.throwIfAborted();
          deferred.attach(prepared.provider);
          session = { address: getAddress(embedded.address), wallet: embedded };
          chainId = prepared.chainId;
          if (requested !== undefined && requested !== chainId) {
            await switchChain(requested);
            signal.throwIfAborted();
          }

          // No await from here to return. wagmi marks itself connecting before calling us, so `connected` here
          // means another wallet finished meanwhile — returning would make wagmi replace the user's choice.
          const { status, current, connections } = getState();
          const otherIsCurrent = current !== null && connections.get(current)?.connector.id !== PRIVY_CONNECTOR_ID;
          if (status === 'connected' && otherIsCurrent && (isReconnecting || current !== startCurrent)) {
            throw userRejected('Another wallet connected while Privy was connecting.');
          }
          // `watch()` only sees later changes: a logout while preparing or switching is caught here.
          if (sessionWallet(runtime.getSnapshot(), session.address) === 'ended') {
            flag.clear();
            throw new PrivySessionError('The Privy session has ended.');
          }
          flag.write();
          watch();
          return { accounts: [session.address], chainId: chainId ?? defaultChainId };
        } catch (error) {
          if (attempt === controller) {
            detachSession();
            // No flag was written, so a later SDK disconnect would find nothing to sign out of.
            if (
              !isReconnecting &&
              disconnectBehavior === 'logout' &&
              (loggedIn || runtime.getSnapshot().authenticated)
            ) {
              signOutOwed.write();
              void signOut();
            }
          }
          throw error;
        } finally {
          clearTimeout(budget);
          if (attempt === controller) attempt = undefined;
        }
      },

      disconnect,

      async getAccounts() {
        return session ? [session.address] : [];
      },

      async getChainId() {
        const provider = deferred.current();
        if (provider) {
          try {
            return await readChainId(provider);
          } catch {
            // Fall through to the last chain this connector verified.
          }
        }
        return chainId ?? defaultChainId;
      },

      async getProvider() {
        return deferred.provider;
      },

      async isAuthorized() {
        return flag.read();
      },

      async switchChain({ chainId: target }) {
        return switchChain(target);
      },

      onAccountsChanged(accounts) {
        if (accounts.length === 0) endSession();
      },

      onChainChanged(chain) {
        config.emitter.emit('change', { chainId: Number(chain) });
      },

      onDisconnect() {
        endSession();
      },
    };
  });
  return { connector, disconnect: async () => sdkDisconnect?.() };
}
