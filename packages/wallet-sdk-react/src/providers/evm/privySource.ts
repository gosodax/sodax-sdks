import type { ComponentType, ReactNode } from 'react';
import type { Config, CreateConnectorFn } from 'wagmi';
import type { PrivySource } from '@/types/config.js';

/** What `EvmProvider` hands the Privy source. Internal — the public side is the opaque `PrivySource`. */
export type PrivySourceContext = {
  /** The URL each chain's wagmi transport uses (`resolveEvmRpcUrls`). */
  readonly rpcUrls: Readonly<Record<number, string>>;
  readonly getState: () => Config['state'];
};

export type PrivySourceSetup = {
  readonly connector: CreateConnectorFn;
  /** Run by an SDK disconnect: ends Privy even before wagmi lists it (a restore or login in flight). */
  readonly disconnect: () => Promise<void>;
  /** Rendered inside `WagmiProvider` around the children, never around the hydrator. */
  readonly Host: ComponentType<{ children?: ReactNode }>;
};

/** Returns `undefined` for a source `privy()` already rejected (it logged why). */
type PrivySourceFactory = (ctx: PrivySourceContext) => PrivySourceSetup | undefined;

// A class instance, not a plain object: React refuses to pass it from a Server Component, so a config
// built on the server fails loudly instead of losing Privy on the client.
class PrivySourceValue implements PrivySource {
  readonly kind = 'privy';
}

// Keyed by the opaque value, so the setup contract never appears in the public types.
const factories = new WeakMap<object, PrivySourceFactory>();

export function createPrivySource(factory: PrivySourceFactory): PrivySource {
  const source = Object.freeze(new PrivySourceValue());
  factories.set(source, factory);
  return source;
}

/** Runs the source's setup, or warns and returns `undefined` for a value `privy()` did not create. */
export function setupPrivySource(source: PrivySource, ctx: PrivySourceContext): PrivySourceSetup | undefined {
  const factory = factories.get(source);
  if (!factory) {
    console.warn(
      "[wallet-sdk-react] EVM.privy must be created by privy() from '@sodax/wallet-sdk-react/privy' — skipped.",
    );
    return undefined;
  }
  return factory(ctx);
}
