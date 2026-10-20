import type { IWalletProvider } from '@sodax/dapp-kit';

/**
 * Wraps a wallet provider so the UI learns a transaction hash the moment the user signs, instead of only when
 * `vaultSwap` resolves after the solver fill. Covers providers that broadcast through `sendTransaction` (EVM);
 * any other provider is passed through and its hash arrives when the flow resolves.
 */
export function withTxListener<T extends IWalletProvider>(walletProvider: T, onTx: (hash: string) => void): T {
  return new Proxy(walletProvider, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== 'function') return value;
      if (prop !== 'sendTransaction') return value.bind(target);
      return async (...args: unknown[]) => {
        const hash: unknown = await value.apply(target, args);
        if (typeof hash === 'string') onTx(hash);
        return hash;
      };
    },
  });
}
