import React, { useMemo, type ReactNode } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';
import { type PrivySource, SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import {
  SodaxProvider,
  createSodaxQueryClient,
  type SodaxOptions,
  type SolverConfig,
  ChainKeys,
  type RpcConfig,
} from '@sodax/dapp-kit';
import { defaultUseBackendSubmitTx, productionSolverConfig, stagingSolverConfig } from './constants';
import { SolverEnv, useAppStore } from './zustand/useAppStore';
import { effectiveSodaxApiKey, effectiveSwapsApiBaseUrl, isHttpUrl, nonEmptyEnv } from './lib/sodaxSettings';
import { createDatadogLogger } from './lib/loggers/datadogLogger';
import { createDemoAnalytics } from './lib/analytics';

const rpcConfig: RpcConfig = {
  [ChainKeys.SONIC_MAINNET]: process.env.SONIC_RPC_URL ?? 'https://sonic-rpc.publicnode.com',
  [ChainKeys.AVALANCHE_MAINNET]: process.env.AVALANCHE_RPC_URL ?? 'https://avalanche-c-chain-rpc.publicnode.com',
  [ChainKeys.BASE_MAINNET]: process.env.BASE_RPC_URL ?? 'https://base.drpc.org',
  [ChainKeys.BSC_MAINNET]: process.env.BSC_RPC_URL ?? 'https://bsc.drpc.org',
  [ChainKeys.OPTIMISM_MAINNET]: process.env.OPTIMISM_RPC_URL ?? 'https://optimism-rpc.publicnode.com',
  [ChainKeys.POLYGON_MAINNET]: process.env.POLYGON_RPC_URL ?? 'https://polygon-bor-rpc.publicnode.com',
  [ChainKeys.ETHEREUM_MAINNET]: process.env.ETHEREUM_RPC_URL ?? 'https://ethereum-rpc.publicnode.com',
  [ChainKeys.HYPEREVM_MAINNET]: process.env.HYPEREVM_RPC_URL ?? 'https://rpc.hyperliquid.xyz/evm',
  [ChainKeys.SOLANA_MAINNET]: process.env.SOLANA_RPC_URL ?? 'https://solana-rpc.publicnode.com',
  [ChainKeys.SUI_MAINNET]: process.env.SUI_GRPC_URL ?? 'https://fullnode.mainnet.sui.io',
  [ChainKeys.NEAR_MAINNET]: process.env.NEAR_RPC_URL ?? 'https://free.rpc.fastnear.com',
  [ChainKeys.STELLAR_MAINNET]: {
    horizonRpcUrl: process.env.STELLAR_HORIZON_RPC_URL ?? 'https://horizon.stellar.org',
    sorobanRpcUrl: process.env.STELLAR_SOROBAN_RPC_URL ?? 'https://rpc.ankr.com/stellar_soroban',
  },
  [ChainKeys.BITCOIN_MAINNET]: {
    rpcUrl: process.env.BITCOIN_RPC_URL ?? 'https://mempool.space/api',
  },
};

// Read credentials through Vite-scoped env variables, not the inlined process environment.
// The optional base URL includes any deployment prefix; the SDK appends the sponsoring path.
// Swaps-API and instance-key env defaults live in `lib/sodaxSettings` (shared with the modal).
const sponsoringApiBaseUrlEnv: unknown = import.meta.env.VITE_SPONSORING_API_BASE_URL;
const sponsoringApiKeyEnv: unknown = import.meta.env.VITE_SPONSORING_API_KEY;
const sponsoringApiConfig = {
  ...(isHttpUrl(sponsoringApiBaseUrlEnv) ? { baseURL: sponsoringApiBaseUrlEnv } : {}),
  ...(nonEmptyEnv(sponsoringApiKeyEnv) ? { apiKey: sponsoringApiKeyEnv } : {}),
};

const configMap: Record<SolverEnv, SolverConfig> = {
  [SolverEnv.Production]: productionSolverConfig,
  [SolverEnv.Staging]: stagingSolverConfig,
};

export default function Providers({ children, privy }: { children: ReactNode; privy?: PrivySource }) {
  const { solverEnvironment, sodaxSettings } = useAppStore();

  const walletConfig = useMemo((): SodaxWalletConfig => {
    const wcProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
    const walletConnect = wcProjectId ? { projectId: wcProjectId } : undefined;

    return {
      EVM: {
        // Hydration-timing flag, not "is host app SSR". Keep `true` so wagmi
        // defers its reconnect into `useEffect` and avoids React's "setState
        // during render" warning. See issue #129.
        ssr: true,
        reconnectOnMount: true,
        walletConnect,
        privy,
        chains: {
          [ChainKeys.SONIC_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.SONIC_MAINNET] },
          [ChainKeys.AVALANCHE_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.AVALANCHE_MAINNET] },
          [ChainKeys.BASE_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.BASE_MAINNET] },
          [ChainKeys.BSC_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.BSC_MAINNET] },
          [ChainKeys.OPTIMISM_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.OPTIMISM_MAINNET] },
          [ChainKeys.POLYGON_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.POLYGON_MAINNET] },
          [ChainKeys.HYPEREVM_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.HYPEREVM_MAINNET] },
          // EVM example: tighter confirmations on Arbitrum, longer timeout on Ethereum.
          [ChainKeys.ARBITRUM_MAINNET]: {
            rpcUrl: rpcConfig[ChainKeys.ARBITRUM_MAINNET],
            defaults: { waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 } },
          },
          [ChainKeys.ETHEREUM_MAINNET]: {
            rpcUrl: rpcConfig[ChainKeys.ETHEREUM_MAINNET],
            defaults: { waitForTransactionReceipt: { confirmations: 3, timeout: 180_000 } },
          },
        },
      },
      SOLANA: {
        chains: {
          [ChainKeys.SOLANA_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.SOLANA_MAINNET] },
        },
      },
      SUI: {
        chains: {
          [ChainKeys.SUI_MAINNET]: { grpcUrl: rpcConfig[ChainKeys.SUI_MAINNET] },
        },
      },
      BITCOIN: {
        chains: {
          [ChainKeys.BITCOIN_MAINNET]: rpcConfig[ChainKeys.BITCOIN_MAINNET],
        },
      },
      STELLAR: {
        chains: {
          [ChainKeys.STELLAR_MAINNET]: rpcConfig[ChainKeys.STELLAR_MAINNET],
        },
      },
      ICON: {},
      INJECTIVE: {},
      NEAR: {
        chains: {
          [ChainKeys.NEAR_MAINNET]: {
            rpcUrl: rpcConfig[ChainKeys.NEAR_MAINNET],
          },
        },
      },
      STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } },
    };
  }, [privy]);

  // Effective config = "Sodax Settings" override > VITE_ env default > env solver config /
  // SDK packaged default. Overrides come from the header modal (lib/sodaxSettings).
  const sodaxConfig: SodaxOptions = useMemo(() => {
    const solverBase = configMap[solverEnvironment];
    const s = sodaxSettings;
    const solverApiEndpoint = s.solverApiEndpoint ?? solverBase.solverApiEndpoint;
    return {
      api: {
        // Every base URL is a gateway root incl. version prefix — never a service segment; each
        // service appends its own path (`/be`, `/swaps`, `/bridge`, `/sponsorships/*`).
        // `undefined` slices are skipped by `deepMerge`, so an unset override is the same as no key.
        ...(s.apiBaseUrl ? { baseApiConfig: { baseURL: s.apiBaseUrl } } : {}),
        // Resolved rather than layered, so the Swaps API page's direct client can be built from the
        // same value — a page submitting to one deployment and polling another never shows a status.
        swapsApiConfig: { baseURL: effectiveSwapsApiBaseUrl(s) },
        sponsoringApiConfig,
      },
      apiKey: effectiveSodaxApiKey(s),
      logger: createDatadogLogger(),
      // Opt-in user-action analytics (issue #175). Enabled by default in the demo; the sink logs each
      // event and re-emits it as a `sodax:analytics` window CustomEvent. `false` when disabled, which
      // leaves the SDK on its default (analytics off).
      analytics: createDemoAnalytics() ?? false,
      solver: {
        intentsContract: s.intentsContract ?? solverBase.intentsContract,
        solverApiEndpoint,
        protocolIntentsContract: s.protocolIntentsContract ?? solverBase.protocolIntentsContract,
      },
      swaps: { useBackendSubmitTx: s.swapUseBackendSubmitTx ?? defaultUseBackendSubmitTx(solverApiEndpoint) },
      bridge: { useBackendSubmitTx: s.bridgeUseBackendSubmitTx ?? true },
      // Auto follows swap's rule, not bridge's: a vault swap is a solver intent, and
      // `/leverage-yield/submit-tx` runs the same pipeline the production swaps API serves — so
      // pointing the demo at the staging solver must keep the backend route off (gh-401).
      leverageYield: {
        useBackendSubmitTx: s.leverageYieldUseBackendSubmitTx ?? defaultUseBackendSubmitTx(solverApiEndpoint),
      },

      // No `leverageYield.positionFactory` override: the deployed factory now ships in
      // `leverageYieldConfig`, and pinning the same address here would be a second source of truth
      // that silently outlives a rotation of the packaged one. Worth knowing when it does rotate:
      // clones bake in their implementation, so positions opened against an earlier factory keep
      // working but stop appearing under the new one, and each of its hooks has to be whitelisted
      // with the solver before an intent posted against it can be filled.

      // Global partner fee. Per-call / per-feature fees still win, and the Swaps/Bridge API pages
      // carry their own per-request fee — `SodaxOptions.fee` never reaches those routes.
      ...(s.partnerFeeAddress && s.partnerFeeBps !== null
        ? { fee: { address: s.partnerFeeAddress, percentage: s.partnerFeeBps } }
        : {}),
      ...(s.relayerApiEndpoint ? { relay: { relayerApiEndpoint: s.relayerApiEndpoint } } : {}),
      chains: {
        [ChainKeys.SONIC_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.SONIC_MAINNET] },
        [ChainKeys.AVALANCHE_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.AVALANCHE_MAINNET] },
        [ChainKeys.BASE_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.BASE_MAINNET] },
        [ChainKeys.BSC_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.BSC_MAINNET] },
        [ChainKeys.OPTIMISM_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.OPTIMISM_MAINNET] },
        [ChainKeys.POLYGON_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.POLYGON_MAINNET] },
        [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.ETHEREUM_MAINNET] },
        [ChainKeys.HYPEREVM_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.HYPEREVM_MAINNET] },
        [ChainKeys.SOLANA_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.SOLANA_MAINNET] },
        [ChainKeys.SUI_MAINNET]: { grpc_url: rpcConfig[ChainKeys.SUI_MAINNET] },
        [ChainKeys.NEAR_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.NEAR_MAINNET] },
        [ChainKeys.STELLAR_MAINNET]: rpcConfig[ChainKeys.STELLAR_MAINNET],
        [ChainKeys.BITCOIN_MAINNET]: rpcConfig[ChainKeys.BITCOIN_MAINNET],
      },
    };
  }, [solverEnvironment, sodaxSettings]);

  // Field order is stable (literal object above), so the key is deterministic per config.
  const configKey = `${solverEnvironment}:${JSON.stringify(sodaxSettings)}`;

  // Fresh cache per config — query keys carry no env/endpoint segment, so a shared client
  // would serve one config's data under another.
  // biome-ignore lint/correctness/useExhaustiveDependencies: configKey is the cache-reset trigger, not a value read in the factory
  const queryClient = useMemo(() => createSodaxQueryClient(), [configKey]);

  // A new config identity re-creates the SDK; keying only the children resets page state
  // without tearing down wallet sessions.
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>
          <React.Fragment key={configKey}>{children}</React.Fragment>
        </SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
