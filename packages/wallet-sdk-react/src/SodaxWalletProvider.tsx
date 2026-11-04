'use client';

import { type ReactNode, useRef } from 'react';

import type { SodaxWalletConfig } from './types/config.js';
import { WalletConfigProvider } from './context/WalletConfigContext.js';
import { EvmProvider } from './providers/evm/index.js';
import { SolanaProvider } from './providers/solana/index.js';
import { SuiProvider } from './providers/sui/index.js';
import { useInitChainServices } from './hooks/useInitChainServices.js';

export type SodaxWalletProviderProps = {
  children: ReactNode;
  /**
   * Captured once on mount. Dynamic changes require remounting `SodaxWalletProvider`
   * — passing a new reference on subsequent renders has no effect.
   */
  config: SodaxWalletConfig;
};

/**
 * Root provider for SODAX wallet connectivity. Mounts only the chain-type adapters opted
 * into via `config` and bridges to `@sodax/wallet-sdk-core` so SDK calls receive a typed
 * `IXxxWalletProvider`.
 *
 * Top-level keys on `SodaxWalletConfig` are chain-type slots (`EVM`, `SOLANA`, `BITCOIN`, …).
 * Omit a slot to skip mounting that adapter; pass `{}` to mount with SDK defaults. Provider-
 * managed chains (EVM/Solana/Sui) wrap their native React adapter (wagmi / wallet-adapter /
 * dapp-kit) plus a `<Hydrator>` that syncs adapter state into the Zustand store; non-provider
 * chains register `ChainActions` directly during `useInitChainServices`.
 *
 * **Config is captured once on mount** via `useRef` — subsequent re-renders with a new
 * reference have no effect. To swap config at runtime, remount with a new `key` prop.
 *
 * Must be wrapped by `<QueryClientProvider>` from `@tanstack/react-query` (or, if also
 * using `@sodax/dapp-kit`, see Setup skill for the full provider-stack ordering).
 *
 * @see {@link https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONFIGURE_PROVIDER.md | Configure SodaxWalletProvider}
 */
export const SodaxWalletProvider = ({ children, config }: SodaxWalletProviderProps) => {
  // Freeze config on first render so context, store, and wagmi all share one snapshot
  // and unstable parent references can't trigger re-init.
  const configRef = useRef<SodaxWalletConfig>(config);
  const frozen = configRef.current;

  useInitChainServices(frozen);

  let content = <>{children}</>;

  if (frozen.SOLANA) {
    content = <SolanaProvider config={frozen.SOLANA}>{content}</SolanaProvider>;
  }

  if (frozen.SUI) {
    content = <SuiProvider config={frozen.SUI}>{content}</SuiProvider>;
  }

  if (frozen.EVM) {
    content = <EvmProvider config={frozen.EVM}>{content}</EvmProvider>;
  }

  return <WalletConfigProvider value={frozen}>{content}</WalletConfigProvider>;
};
