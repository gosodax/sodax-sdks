import type { Sodax } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseIcxReverseMigrationEnabledParams = ReadHookParams<boolean>;

type IcxReverseSwitchReader = {
  migration: { icxMigration: Pick<Sodax['migration']['icxMigration'], 'isReverseMigrationEnabled'> };
};

const STALE_TIME_MS = 60_000;

export function getIcxReverseMigrationEnabledQueryOptions({ sodax }: { sodax: IcxReverseSwitchReader }) {
  return {
    queryKey: ['migrate', 'icxReverseMigrationEnabled'] as const,
    queryFn: async (): Promise<boolean> => {
      const result = await sodax.migration.icxMigration.isReverseMigrationEnabled();
      if (!result.ok) throw result.error;
      return result.value;
    },
    staleTime: STALE_TIME_MS,
  };
}

/**
 * React hook reading whether the ICX migration contract currently accepts SODA → ICX reverse
 * migrations. While `false`, `useMigrationApprove` (ICX revert) and `useRevertMigrateSodaToIcx`
 * fail with `VALIDATION_FAILED`, so gate the revert UI on this before asking for an approval.
 */
export function useIcxReverseMigrationEnabled({
  queryOptions,
}: UseIcxReverseMigrationEnabledParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  return useQuery<boolean, Error>({
    ...getIcxReverseMigrationEnabledQueryOptions({ sodax }),
    ...queryOptions,
  });
}
