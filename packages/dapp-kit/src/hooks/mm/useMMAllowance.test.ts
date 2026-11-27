import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoneyMarketParams, SpokeChainKey } from '@sodax/sdk';
import type { QueryObserverOptions } from '@tanstack/react-query';

// No renderer, per the package convention: capture the options bag and drive a real observer with it.
let captured: QueryObserverOptions<boolean, Error> | undefined;

const isAllowanceValid = vi.fn();
vi.mock('../shared/useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { moneyMarket: { isAllowanceValid } } }),
}));
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: QueryObserverOptions<boolean, Error>) => {
    captured = options;
    return {};
  },
}));

const { QueryClient, QueryObserver } = await import('@tanstack/react-query');
const { useMMAllowance } = await import('./useMMAllowance.js');

type Action = 'supply' | 'borrow' | 'withdraw' | 'repay';

const observe = (action: Action) => {
  const fields = { srcChainKey: '0xa4b1.arbitrum', token: '0xtoken', action };
  // The hook only reads these fields; a full MoneyMarketParams needs real chain/wallet config.
  const payload = fields as unknown as MoneyMarketParams<SpokeChainKey>;
  useMMAllowance({ params: { payload } });
  if (!captured) throw new Error('useQuery was not called');
  const client = new QueryClient();
  return { client, result: new QueryObserver(client, captured).getCurrentResult() };
};

afterEach(() => {
  captured = undefined;
  isAllowanceValid.mockReset();
});

describe('useMMAllowance', () => {
  it.each<Action>(['borrow', 'withdraw'])('reports %s as approved without querying the SDK', action => {
    const { client, result } = observe(action);
    expect(result.data).toBe(true);
    expect(result.isLoading).toBe(false);
    expect(isAllowanceValid).not.toHaveBeenCalled();
    client.clear();
  });

  it.each<Action>(['supply', 'repay'])('leaves %s pending until the SDK answers', action => {
    const { client, result } = observe(action);
    expect(result.data).toBeUndefined();
    expect(captured?.enabled).toBe(true);
    client.clear();
  });
});
