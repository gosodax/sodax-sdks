import type {
  BalnMigrateParams,
  IcxCreateRevertMigrationParams,
  IcxMigrateParams,
  MigrationAction,
  SpokeChainKey,
  UnifiedBnUSDMigrateParams,
} from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

/** `params` excludes `walletProvider`/`raw`; ICX forward and BALN always resolve `true` (Icon has no allowance). */
export type UseMigrationAllowanceInputs<K extends SpokeChainKey = SpokeChainKey> = {
  params:
    | IcxMigrateParams
    | IcxCreateRevertMigrationParams
    | UnifiedBnUSDMigrateParams<K>
    | BalnMigrateParams
    | undefined;
  action: MigrationAction | undefined;
};

export type UseMigrationAllowanceParams<K extends SpokeChainKey = SpokeChainKey> = ReadHookParams<
  boolean,
  UseMigrationAllowanceInputs<K>
>;

const REFETCH_INTERVAL_MS = 2_000;

/** Resolves `false` when params are missing. */
export function useMigrationAllowance<K extends SpokeChainKey = SpokeChainKey>({
  params,
  queryOptions,
}: UseMigrationAllowanceParams<K> = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const migrationParams = params?.params;
  const action = params?.action;

  return useQuery<boolean, Error>({
    // Key on the scoping tuple: raw params hold bigints and churn every render.
    queryKey: [
      'migrate',
      'allowance',
      action,
      migrationParams?.srcChainKey,
      migrationParams?.srcAddress,
      migrationParams && 'srcbnUSD' in migrationParams ? migrationParams.srcbnUSD : undefined,
      migrationParams?.amount?.toString(),
    ],
    queryFn: async () => {
      if (!migrationParams || !action) return false;
      const result = await sodax.migration.isAllowanceValid<K>(migrationParams, action);
      return result.ok ? result.value : false;
    },
    enabled: !!migrationParams && !!action,
    refetchInterval: REFETCH_INTERVAL_MS,
    ...queryOptions,
  });
}
