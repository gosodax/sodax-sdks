import React, { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { RequestOverrideConfig, SpokeChainKey } from '@sodax/dapp-kit';
import { isSignableSwapsApiChain } from '@/components/swaps-api/lib/signAndBroadcast';
import { ROUTES } from '@/constants';
import { effectiveLeverageYieldApiBaseUrl } from '@/lib/sodaxSettings';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/zustand/useAppStore';
import { Hint } from './Hint';

/**
 * How the feature talks to SODAX, fixed by the page that renders it:
 * - 'sdk' (`/leverage-yield`): dapp-kit hooks over the SDK (on-chain reads, SDK-built intents).
 * - 'api' (`/leverage-yield-api`): the leverage-yield REST API via `sodax.api.leverageYield` and the
 *   `useLeverageYieldApi*` hooks. The API builds unsigned transactions; the wallet signs them.
 */
export type Transport = 'sdk' | 'api';

type TransportValue = {
  transport: Transport;
  /**
   * Per-call API config. API page: the Sodax Settings base URL, so it can target a local leverage-yield API without
   * moving the app-wide SDK. SDK page: the per-action key the vault swap and its status reads carry, if set.
   */
  apiConfig: RequestOverrideConfig | undefined;
  /** Whether this transport can sign on `chainKey`: the API path signs API-built txs, which excludes Bitcoin. */
  canSign: (chainKey: SpokeChainKey) => boolean;
};

const signsEverywhere = () => true;

const TransportContext = createContext<TransportValue>({
  transport: 'sdk',
  apiConfig: undefined,
  canSign: signsEverywhere,
});

export function TransportProvider({ transport, children }: { transport: Transport; children: ReactNode }) {
  const sodaxSettings = useAppStore(state => state.sodaxSettings);
  const value = useMemo((): TransportValue => {
    if (transport === 'api') {
      const apiConfig = { baseURL: effectiveLeverageYieldApiBaseUrl(sodaxSettings) };
      return { transport, apiConfig, canSign: isSignableSwapsApiChain };
    }
    const apiKey = sodaxSettings.leverageYieldApiKey;
    return { transport, apiConfig: apiKey ? { apiKey } : undefined, canSign: signsEverywhere };
  }, [transport, sodaxSettings]);
  return <TransportContext.Provider value={value}>{children}</TransportContext.Provider>;
}

export function useTransport(): TransportValue {
  return useContext(TransportContext);
}

const OPTIONS: { value: Transport; label: string; hint: string; route: string }[] = [
  {
    value: 'sdk',
    label: 'SDK',
    hint: 'dapp-kit hooks over @sodax/sdk: reads from chain, SDK builds intents.',
    route: ROUTES.LEVERAGE_YIELD,
  },
  {
    value: 'api',
    label: 'API',
    hint: 'Leverage Yield REST API: builds unsigned txs, your wallet signs.',
    route: ROUTES.LEVERAGE_YIELD_API,
  },
];

/** The SDK/API switch. Each transport is its own page, so switching navigates between them. */
export function TransportToggle() {
  const { transport } = useTransport();
  const navigate = useNavigate();
  return (
    <fieldset
      aria-label="Data source"
      className="inline-flex items-center gap-1 rounded-full border bg-card p-1 text-sm"
    >
      {OPTIONS.map(option => (
        <Hint key={option.value} content={option.hint}>
          <button
            type="button"
            aria-pressed={transport === option.value}
            onClick={() => navigate(option.route)}
            className={cn(
              'rounded-full px-3 py-1 font-medium transition-colors',
              transport === option.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        </Hint>
      ))}
    </fieldset>
  );
}
