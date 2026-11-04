import { ProviderDisconnectedError } from 'viem';
import { isRecord } from '@/shared/guards.js';

type RequestArguments = { readonly method: string; readonly params?: unknown };

export type Eip1193Like = { request(args: RequestArguments): Promise<unknown> };

/** The provider wagmi holds for the Privy connector: one stable object, whatever is attached behind it. */
export type DeferredProvider = Eip1193Like & {
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
};

type DeferredProviderHandle = {
  readonly provider: DeferredProvider;
  attach(target: Eip1193Like): void;
  detach(): void;
  current(): Eip1193Like | undefined;
};

/**
 * `wallet_switchEthereumChain` is routed to `switchChain` so a caller going through the wallet client
 * gets the connector's validated switch — Privy's own handler accepts any chain id. Detached requests
 * fail with 4900 and are never queued: a replay after a later login could sign as a different user.
 */
export function createDeferredProvider(switchChain: (chainId: number) => Promise<unknown>): DeferredProviderHandle {
  let target: Eip1193Like | undefined;

  const provider: DeferredProvider = {
    async request(args) {
      if (!target) throw new ProviderDisconnectedError(new Error('The Privy wallet is not connected.'));
      if (args.method === 'wallet_switchEthereumChain') {
        await switchChain(parseSwitchChainId(args.params));
        return null;
      }
      // Never timed: signing may be waiting on Privy's MFA prompt or confirmation modal.
      return target.request(args);
    },
    // Privy's provider events are not forwarded: the connector reports chain and session changes itself.
    on() {},
    removeListener() {},
  };

  return {
    provider,
    attach(next) {
      target = next;
    },
    detach() {
      target = undefined;
    },
    current: () => target,
  };
}

function parseSwitchChainId(params: unknown): number {
  const first: unknown = Array.isArray(params) ? params[0] : undefined;
  const chainId = isRecord(first) ? first.chainId : undefined;
  const parsed = typeof chainId === 'string' || typeof chainId === 'number' ? Number(chainId) : Number.NaN;
  if (!Number.isInteger(parsed)) throw new Error('Invalid wallet_switchEthereumChain params.');
  return parsed;
}
