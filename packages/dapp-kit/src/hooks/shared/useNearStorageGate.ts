import type { GetWalletProviderType, INearWalletProvider, Result, SpokeChainKey } from '@sodax/sdk';
import { resolveNearStorageGate } from '../../utils/nearStorageGate.js';
import { useNearStorageCheck } from './useNearStorageCheck.js';
import { useRegisterNearStorage } from './useRegisterNearStorage.js';

export interface UseNearStorageGateParams {
  /** Destination chain the token is delivered on; `undefined` (not chosen yet) leaves the gate inert. */
  dstChainKey: SpokeChainKey | undefined;
  /** Destination token address the recipient must be registered for. */
  token: string | undefined;
  /** Recipient NEAR account id. */
  accountId: string | undefined;
  /** Destination wallet provider; only consumed when it is the NEAR provider. */
  walletProvider: GetWalletProviderType<SpokeChainKey> | undefined;
}

export interface NearStorageGate {
  /** Destination is NEAR. */
  isNear: boolean;
  /** Destination is NEAR and the recipient is not yet storage-registered for `token`. */
  needsRegistration: boolean;
  /** The downstream action must stay disabled while the gate is unresolved or unmet. */
  blocksAction: boolean;
  /** The registration-status query is actively fetching. */
  isChecking: boolean;
  /** Destination is NEAR and the registration check failed, so whether the recipient can receive is unknown. */
  checkFailed: boolean;
  /** Re-run the registration check. */
  retry: () => void;
  /** A `storage_deposit` tx is in flight. */
  isRegistering: boolean;
  /** Submit the `storage_deposit`; resolves to the SDK `Result` or `undefined` if inputs are missing. */
  registerStorage: () => Promise<Result<string> | undefined>;
}

/**
 * NEP-141 storage-registration gate for flows that deliver a token to a user on NEAR.
 */
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
