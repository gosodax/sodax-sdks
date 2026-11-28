import type { GetWalletProviderType, INearWalletProvider, Result, SpokeChainKey } from '@sodax/sdk';
import { resolveNearStorageGate } from '../../utils/nearStorageGate.js';
import { useNearStorageCheck } from './useNearStorageCheck.js';
import { useRegisterNearStorage } from './useRegisterNearStorage.js';

export interface UseNearStorageGateParams {
  /** `undefined` (not chosen yet) leaves the gate inert. */
  dstChainKey: SpokeChainKey | undefined;
  token: string | undefined;
  accountId: string | undefined;
  /** Only consumed when it is the NEAR provider. */
  walletProvider: GetWalletProviderType<SpokeChainKey> | undefined;
}

export interface NearStorageGate {
  isNear: boolean;
  needsRegistration: boolean;
  /** True while the gate is unresolved or unmet. */
  blocksAction: boolean;
  isChecking: boolean;
  checkFailed: boolean;
  retry: () => void;
  isRegistering: boolean;
  /** Resolves to `undefined` if inputs are missing. */
  registerStorage: () => Promise<Result<string> | undefined>;
}

/** NEP-141 storage-registration gate for flows that deliver a token to a user on NEAR. */
export function useNearStorageGate({
  dstChainKey,
  token,
  accountId,
  walletProvider,
}: UseNearStorageGateParams): NearStorageGate {
  const nearWalletProvider = walletProvider?.chainType === 'NEAR' ? (walletProvider as INearWalletProvider) : undefined;

  const storageCheck = useNearStorageCheck({ params: { token, accountId, chainId: dstChainKey } });
  const { mutateAsyncSafe: register, isPending: isRegistering } = useRegisterNearStorage();
  const { isNear, needsRegistration, blocksAction } = resolveNearStorageGate(dstChainKey, storageCheck);

  const registerStorage = async (): Promise<Result<string> | undefined> => {
    if (!nearWalletProvider || !token || !accountId) return undefined;
    return register({ token, accountId, walletProvider: nearWalletProvider });
  };

  return {
    isNear,
    needsRegistration,
    blocksAction,
    isChecking: storageCheck.isLoading,
    checkFailed: isNear && storageCheck.isError && storageCheck.data === undefined,
    retry: () => void storageCheck.refetch(),
    isRegistering,
    registerStorage,
  };
}
