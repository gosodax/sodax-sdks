import type {
  EvmSpokeOnlyChainKey,
  GetAddressType,
  GetTokenAddressType,
  HubChainKey,
  Result,
  SpokeChainKey,
  StellarChainKey,
  TxReturnType,
  WalletProviderSlot,
} from '@sodax/types';
import type { FeatureInvariant } from '../errors/invariant.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import {
  isEvmSpokeOnlyChainKeyType,
  isHubChainKeyType,
  isOptionalEvmWalletProviderType,
  isOptionalStellarWalletProviderType,
  isStellarChainKeyType,
} from '../shared/guards.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import type {
  ApprovalTxs,
  SpokeIsAllowanceValidParamsEvmSpoke,
  SpokeIsAllowanceValidParamsHub,
  SpokeIsAllowanceValidParamsStellar,
} from '../shared/types/spoke-types.js';
import type { CreateIntentParams } from '../shared/types/intent-types.js';
import { intentDepositSpender } from './intentDepositSpender.js';

// The intent-deposit approval shared by swap and leverage yield. These return the spoke's raw `Result` and
// never catch: the calling service wraps failures with its own `feature`.

/** Whether the source-token allowance covers `inputAmount`; `true` on a chain with no allowance concept. */
export async function isIntentDepositAllowanceValid<K extends SpokeChainKey>(
  spoke: SpokeService,
  config: ConfigService,
  params: CreateIntentParams<K>,
): Promise<Result<boolean>> {
  const { srcChainKey } = params;
  if (isHubChainKeyType(srcChainKey) || isEvmSpokeOnlyChainKeyType(srcChainKey)) {
    return spoke.isAllowanceValid({
      srcChainKey,
      token: params.inputToken,
      amount: params.inputAmount,
      owner: params.srcAddress,
      spender: intentDepositSpender(config, srcChainKey),
    } satisfies SpokeIsAllowanceValidParamsHub | SpokeIsAllowanceValidParamsEvmSpoke);
  }
  if (isStellarChainKeyType(srcChainKey)) {
    return spoke.isAllowanceValid({
      srcChainKey,
      token: params.inputToken,
      amount: params.inputAmount,
      owner: params.srcAddress,
    } satisfies SpokeIsAllowanceValidParamsStellar);
  }
  return { ok: true, value: true };
}

/**
 * Approves the deposit's spender on the hub or an EVM spoke, or the trustline on Stellar.
 *
 * `assert` is the caller's feature invariant, so a wallet of the wrong family fails under the caller's
 * label. Resolves to `undefined` when the source chain has no approval, for the caller to report.
 */
export async function approveIntentDeposit<K extends SpokeChainKey, Raw extends boolean>(
  spoke: SpokeService,
  config: ConfigService,
  input: { params: CreateIntentParams<K> } & WalletProviderSlot<K, Raw>,
  assert: FeatureInvariant,
): Promise<Result<TxReturnType<K, Raw>> | undefined> {
  const { params } = input;
  if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
    assert(
      isOptionalEvmWalletProviderType(input.walletProvider),
      'Invalid wallet provider. Expected Evm wallet provider.',
    );
    const result = await spoke.approve<HubChainKey | EvmSpokeOnlyChainKey, Raw>({
      srcChainKey: params.srcChainKey,
      owner: params.srcAddress as GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
      token: params.inputToken as GetTokenAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
      amount: params.inputAmount,
      spender: intentDepositSpender(config, params.srcChainKey),
      raw: input.raw,
      walletProvider: input.walletProvider,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, Raw> as TxReturnType<K, Raw>,
    };
  }

  if (isStellarChainKeyType(params.srcChainKey)) {
    assert(
      isOptionalStellarWalletProviderType(input.walletProvider),
      'Invalid wallet provider. Expected Stellar wallet provider.',
    );
    const coreParams = {
      srcChainKey: params.srcChainKey,
      token: params.inputToken,
      amount: params.inputAmount,
      owner: params.srcAddress as GetAddressType<StellarChainKey>,
    } as const;
    const result = await spoke.approve<StellarChainKey, boolean>(
      input.raw ? { ...coreParams, raw: true } : { ...coreParams, raw: false, walletProvider: input.walletProvider },
    );
    if (!result.ok) return result;
    return {
      ok: true,
      value: result.value satisfies TxReturnType<StellarChainKey, boolean> as TxReturnType<K, Raw>,
    };
  }

  return undefined;
}

/**
 * The deposit's unsigned approval transactions, in broadcast order: `resetTx` (when the token needs a
 * stale allowance cleared first) before `approveTx`. Resolves to `undefined` when the source chain has
 * no approval, for the caller to report.
 */
export async function buildIntentDepositApproveTxs<K extends SpokeChainKey>(
  spoke: SpokeService,
  config: ConfigService,
  params: CreateIntentParams<K>,
): Promise<Result<ApprovalTxs<K>> | undefined> {
  if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
    const result = await spoke.buildApproveTxs<HubChainKey | EvmSpokeOnlyChainKey>({
      srcChainKey: params.srcChainKey,
      owner: params.srcAddress as GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
      token: params.inputToken as GetTokenAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
      amount: params.inputAmount,
      spender: intentDepositSpender(config, params.srcChainKey),
      raw: true,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      value: result.value satisfies ApprovalTxs<HubChainKey | EvmSpokeOnlyChainKey> as ApprovalTxs<K>,
    };
  }

  if (isStellarChainKeyType(params.srcChainKey)) {
    const result = await spoke.buildApproveTxs<StellarChainKey>({
      srcChainKey: params.srcChainKey,
      token: params.inputToken,
      amount: params.inputAmount,
      owner: params.srcAddress as GetAddressType<StellarChainKey>,
      raw: true,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      value: result.value satisfies ApprovalTxs<StellarChainKey> as ApprovalTxs<K>,
    };
  }

  return undefined;
}
