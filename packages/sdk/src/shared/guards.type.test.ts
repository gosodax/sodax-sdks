/**
 * Compile-time contract for `guards.ts`: each type guard narrows to its exact public type, the chain-key
 * guards narrow a chain key to its family, and the generic params / wallet-provider guards narrow per chain.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BitcoinChainKey,
  ChainKeys,
  EvmChainKey,
  EvmSpokeChainConfig,
  EvmSpokeOnlyChainKey,
  HubChainKey,
  IBitcoinWalletProvider,
  IconAddress,
  IconChainKey,
  IEvmWalletProvider,
  InjectiveChainKey,
  ISolanaWalletProvider,
  IStellarWalletProvider,
  IWalletProvider,
  JsonRpcPayloadResponse,
  NearChainKey,
  PartnerFeeAmount,
  PartnerFeePercentage,
  RawDestinationParams,
  ResponseAddressType,
  ResponseSigningType,
  SolanaChainKey,
  SonicChainKey,
  SpokeApproveParams,
  SpokeApproveParamsEvmSpoke,
  SpokeApproveParamsHub,
  SpokeApproveParamsStellar,
  SpokeChainKey,
  SpokeIsAllowanceValidParamsEvmSpoke,
  SpokeIsAllowanceValidParamsHub,
  SpokeIsAllowanceValidParamsStellar,
  StacksChainKey,
  StellarChainKey,
  SuiChainKey,
} from '../index.js';
import {
  isApprovalSupportedChainKeyType,
  isBitcoinChainKeyType,
  isBitcoinWalletProviderType,
  isEvmChainKeyType,
  isEvmSpokeChainConfig,
  isEvmSpokeOnlyChainKeyType,
  isEvmWalletProviderType,
  isHubChainKeyType,
  isIconAddress,
  isIconChainKeyType,
  isInjectiveChainKeyType,
  isJsonRpcPayloadResponse,
  isNearChainKeyType,
  isOptionalBitcoinWalletProviderType,
  isOptionalEvmWalletProviderType,
  isOptionalStellarWalletProviderType,
  isPartnerFeeAmount,
  isPartnerFeePercentage,
  isRawDestinationParams,
  isResponseAddressType,
  isResponseSigningType,
  isSolanaChainKeyType,
  isSonicChainKeyType,
  isSpokeApproveParamsEvmSpoke,
  isSpokeApproveParamsHub,
  isSpokeApproveParamsStellar,
  isSpokeIsAllowanceValidParamsEvmSpoke,
  isSpokeIsAllowanceValidParamsHub,
  isSpokeIsAllowanceValidParamsStellar,
  isStacksChainKeyType,
  isStellarChainKeyType,
  isStellarWalletProviderType,
  isSuiChainKeyType,
  isUndefinedOrValidWalletProviderForChainKey,
  isValidInjectiveAddress,
  isValidNearAccountId,
} from './guards.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SONIC = typeof ChainKeys.SONIC_MAINNET;
type STELLAR = typeof ChainKeys.STELLAR_MAINNET;
type SOLANA = typeof ChainKeys.SOLANA_MAINNET;
type ApprovableKey = SONIC | BSC | STELLAR;

declare const anyKey: SpokeChainKey;
declare const bscKey: BSC;
declare const stellarKey: STELLAR;
declare const solanaKey: SOLANA;
declare const approveParams: SpokeApproveParams<ApprovableKey, false>;
declare const approveParamsRaw: SpokeApproveParams<ApprovableKey, true>;
declare const wallet: IWalletProvider | undefined;
declare const solanaApproveParams: Omit<SpokeApproveParamsStellar<STELLAR, false>, 'srcChainKey'> & {
  srcChainKey: SOLANA;
};

// The value as narrowed in the guard's true branch. Never invoked.
function narrow<T, N extends T>(value: T, guard: (v: T) => v is N): N {
  if (guard(value)) return value;
  throw new Error('unreachable');
}
const suiKey = () => narrow(anyKey, isSuiChainKeyType);
const evmSpokeKey = () => narrow(anyKey, isEvmSpokeOnlyChainKeyType);
const approveHub = () => narrow(approveParams, isSpokeApproveParamsHub);
const approveEvmSpoke = () => narrow(approveParams, isSpokeApproveParamsEvmSpoke);
const approveStellar = () => narrow(approveParams, isSpokeApproveParamsStellar);
const approveHubRaw = () => narrow(approveParamsRaw, isSpokeApproveParamsHub);
const approveEvmSpokeRaw = () => narrow(approveParamsRaw, isSpokeApproveParamsEvmSpoke);
const approveStellarRaw = () => narrow(approveParamsRaw, isSpokeApproveParamsStellar);
const walletForBsc = () => {
  if (isUndefinedOrValidWalletProviderForChainKey(bscKey, wallet)) return wallet;
  throw new Error('unreachable');
};
const walletForStellar = () => {
  if (isUndefinedOrValidWalletProviderForChainKey(stellarKey, wallet)) return wallet;
  throw new Error('unreachable');
};
const walletForSolana = () => {
  if (isUndefinedOrValidWalletProviderForChainKey(solanaKey, wallet)) return wallet;
  throw new Error('unreachable');
};
const invalidCalls = () => [
  // @ts-expect-error — chain-key guards take a spoke chain key, not an arbitrary string
  isSuiChainKeyType('not-a-chain'),
  // @ts-expect-error — wallet-provider guards take an IWalletProvider, not a chain key
  isEvmWalletProviderType(bscKey),
  // @ts-expect-error — approve guards accept only approvable families (hub, EVM spoke, Stellar)
  isSpokeApproveParamsHub(solanaApproveParams),
];

describe('guards type contract', () => {
  it('config, address and payload guards narrow to their public types', () => {
    expectTypeOf(isEvmSpokeChainConfig).guards.toEqualTypeOf<EvmSpokeChainConfig>();
    expectTypeOf(isIconAddress).guards.toEqualTypeOf<IconAddress>();
    expectTypeOf(isResponseAddressType).guards.toEqualTypeOf<ResponseAddressType>();
    expectTypeOf(isResponseSigningType).guards.toEqualTypeOf<ResponseSigningType>();
    expectTypeOf(isJsonRpcPayloadResponse).guards.toEqualTypeOf<JsonRpcPayloadResponse>();
    expectTypeOf(isPartnerFeeAmount).guards.toEqualTypeOf<PartnerFeeAmount>();
    expectTypeOf(isPartnerFeePercentage).guards.toEqualTypeOf<PartnerFeePercentage>();
    expectTypeOf(isRawDestinationParams).guards.toEqualTypeOf<RawDestinationParams>();
  });

  it('plain validators return boolean', () => {
    expectTypeOf(isValidNearAccountId).returns.toEqualTypeOf<boolean>();
    expectTypeOf(isValidInjectiveAddress).returns.toEqualTypeOf<boolean>();
    expectTypeOf(isApprovalSupportedChainKeyType).returns.toEqualTypeOf<boolean>();
    expectTypeOf(isApprovalSupportedChainKeyType).parameter(0).toEqualTypeOf<SpokeChainKey>();
  });

  it('chain-key guards narrow a spoke chain key to its family', () => {
    expectTypeOf(isEvmChainKeyType).guards.toEqualTypeOf<EvmChainKey>();
    expectTypeOf(isEvmSpokeOnlyChainKeyType).guards.toEqualTypeOf<EvmSpokeOnlyChainKey>();
    expectTypeOf(isSonicChainKeyType).guards.toEqualTypeOf<SonicChainKey>();
    expectTypeOf(isHubChainKeyType).guards.toEqualTypeOf<HubChainKey>();
    expectTypeOf(isSolanaChainKeyType).guards.toEqualTypeOf<SolanaChainKey>();
    expectTypeOf(isNearChainKeyType).guards.toEqualTypeOf<NearChainKey>();
    expectTypeOf(isStellarChainKeyType).guards.toEqualTypeOf<StellarChainKey>();
    expectTypeOf(isBitcoinChainKeyType).guards.toEqualTypeOf<BitcoinChainKey>();
    expectTypeOf(isInjectiveChainKeyType).guards.toEqualTypeOf<InjectiveChainKey>();
    expectTypeOf(isIconChainKeyType).guards.toEqualTypeOf<IconChainKey>();
    expectTypeOf(isSuiChainKeyType).guards.toEqualTypeOf<SuiChainKey>();
    expectTypeOf(isStacksChainKeyType).guards.toEqualTypeOf<StacksChainKey>();
    expectTypeOf<ReturnType<typeof suiKey>>().toEqualTypeOf<SuiChainKey>();
    expectTypeOf<ReturnType<typeof evmSpokeKey>>().toEqualTypeOf<EvmSpokeOnlyChainKey>();
  });

  it('allowance-params guards narrow to the family variant', () => {
    expectTypeOf(isSpokeIsAllowanceValidParamsHub).guards.toEqualTypeOf<SpokeIsAllowanceValidParamsHub>();
    expectTypeOf(isSpokeIsAllowanceValidParamsEvmSpoke).guards.toEqualTypeOf<SpokeIsAllowanceValidParamsEvmSpoke>();
    expectTypeOf(isSpokeIsAllowanceValidParamsStellar).guards.toEqualTypeOf<SpokeIsAllowanceValidParamsStellar>();
  });

  it('approve-params guards narrow per family and keep the execution mode', () => {
    expectTypeOf<ReturnType<typeof approveHub>>().toEqualTypeOf<SpokeApproveParamsHub<SONIC, false>>();
    expectTypeOf<ReturnType<typeof approveEvmSpoke>>().toEqualTypeOf<SpokeApproveParamsEvmSpoke<BSC, false>>();
    expectTypeOf<ReturnType<typeof approveStellar>>().toEqualTypeOf<SpokeApproveParamsStellar<STELLAR, false>>();
    expectTypeOf<ReturnType<typeof approveHubRaw>>().toEqualTypeOf<SpokeApproveParamsHub<SONIC, true>>();
    expectTypeOf<ReturnType<typeof approveEvmSpokeRaw>>().toEqualTypeOf<SpokeApproveParamsEvmSpoke<BSC, true>>();
    expectTypeOf<ReturnType<typeof approveStellarRaw>>().toEqualTypeOf<SpokeApproveParamsStellar<STELLAR, true>>();
  });

  it('wallet-provider guards narrow to the chain-specific provider', () => {
    expectTypeOf(isBitcoinWalletProviderType).guards.toEqualTypeOf<IBitcoinWalletProvider>();
    expectTypeOf(isEvmWalletProviderType).guards.toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf(isStellarWalletProviderType).guards.toEqualTypeOf<IStellarWalletProvider>();
    expectTypeOf(isOptionalEvmWalletProviderType).guards.toEqualTypeOf<IEvmWalletProvider | undefined>();
    expectTypeOf(isOptionalStellarWalletProviderType).guards.toEqualTypeOf<IStellarWalletProvider | undefined>();
    expectTypeOf(isOptionalBitcoinWalletProviderType).guards.toEqualTypeOf<IBitcoinWalletProvider | undefined>();
  });

  it('isUndefinedOrValidWalletProviderForChainKey narrows to the chain key family provider', () => {
    expectTypeOf<ReturnType<typeof walletForBsc>>().toEqualTypeOf<IEvmWalletProvider | undefined>();
    expectTypeOf<ReturnType<typeof walletForStellar>>().toEqualTypeOf<IStellarWalletProvider | undefined>();
    expectTypeOf<ReturnType<typeof walletForSolana>>().toEqualTypeOf<ISolanaWalletProvider | undefined>();
  });

  it('rejects inputs outside the guard domain', () => {
    expectTypeOf(invalidCalls).returns.toEqualTypeOf<boolean[]>();
  });
});
