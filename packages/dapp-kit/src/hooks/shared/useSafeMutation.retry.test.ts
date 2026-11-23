import { SodaxError } from '@sodax/sdk';
import { QueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { useLeverageYieldVaultSwap } from '../leverageYield/useLeverageYieldVaultSwap.js';
import { useLeverageYieldVaultSwapWithApproval } from '../leverageYield/useLeverageYieldVaultSwapWithApproval.js';
import { useFeeClaimWithdraw } from '../partner/useFeeClaimWithdraw.js';
import { useSwapsApiBroadcastWithApproval } from '../swapsApi/useSwapsApiBroadcastWithApproval.js';

let queryClient: QueryClient;
let options: UseMutationOptions<unknown, Error, unknown>;

vi.mock('./useSodaxContext.js', () => ({ useSodaxContext: () => ({ sodax: {} }) }));
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: (fn: unknown) => fn,
}));
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => queryClient,
  useMutation: (value: typeof options) => {
    options = value;
    return {};
  },
}));

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false, retryDelay: 0 } } });
});

it.each([
  { hook: useLeverageYieldVaultSwap, name: 'useLeverageYieldVaultSwap' },
  { hook: useLeverageYieldVaultSwapWithApproval, name: 'useLeverageYieldVaultSwapWithApproval' },
  { hook: useSwapsApiBroadcastWithApproval, name: 'useSwapsApiBroadcastWithApproval' },
  { hook: useFeeClaimWithdraw, name: 'useFeeClaimWithdraw' },
])('$name preserves keyed retries before submission and stops after submission', async ({ hook }) => {
  queryClient.setMutationDefaults(['retry-test'], { retry: 2 });
  hook({ mutationOptions: { mutationKey: ['retry-test'] } });
  const pending = new SodaxError('RELAY_TIMEOUT', 'Settlement pending', {
    feature: 'bridge',
    context: { srcTxHash: '0x1234' },
  });
  const submit = vi.fn().mockRejectedValueOnce(new Error('Before submission')).mockRejectedValue(pending);
  const mutation = queryClient.getMutationCache().build(queryClient, { ...options, mutationFn: submit });

  await expect(mutation.execute(undefined)).rejects.toBe(pending);
  expect(submit).toHaveBeenCalledTimes(2);
});
