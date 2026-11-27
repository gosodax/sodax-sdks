import { useMemo, type ReactNode, type ReactElement } from 'react';
import { Sodax, type SodaxOptions } from '@sodax/sdk';
import { SodaxContext } from '@/contexts/index.js';

interface SodaxProviderProps {
  children: ReactNode;
  /** Tracked by reference: a new identity re-creates the SDK and resets consumers, so memoize it. */
  config?: SodaxOptions;
}

/** Root provider for `@sodax/dapp-kit`. Must be paired with `QueryClientProvider`. */
export const SodaxProvider = ({ children, config }: SodaxProviderProps): ReactElement => {
  const sodax = useMemo(() => new Sodax(config), [config]);
  const contextValue = useMemo(() => ({ sodax }), [sodax]);

  return <SodaxContext.Provider value={contextValue}>{children}</SodaxContext.Provider>;
};
