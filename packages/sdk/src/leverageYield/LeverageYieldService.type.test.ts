/**
 * Compile-time contract: LeverageYieldService results. `createVaultIntent` narrows by source chain
 * family and execution mode, `approve` (hub-only) by mode, and `approvePositionFunding` by source
 * family; every other method returns a fixed `Result` whatever chain it is called from.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  Address,
  ApprovalStrategy,
  ApprovalStrategyError,
  BitcoinRawTransaction,
  ChainKeys,
  CreateIntentParams,
  DetailedLeverageYieldStatus,
  EvmRawTransaction,
  FeeAmount,
  Hex,
  IBitcoinWalletProvider,
  IconRawTransaction,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  InjectiveRawTransaction,
  Intent,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  LeveragePosition,
  LeveragePositionAccount,
  LeveragePositionCollateral,
  LeveragePositionIntentResult,
  LeveragePositionPendingState,
  LeverageYieldAllowanceCheckError,
  LeverageYieldApproveError,
  LeverageYieldApproveParams,
  LeverageYieldApr,
  LeverageYieldCreateIntentError,
  LeverageYieldDetailedStatusError,
  LeverageYieldEffectiveApr,
  LeverageYieldLookupError,
  LeverageYieldLsdApr,
  LeverageYieldPosition,
  LeverageYieldPostExecutionError,
  LeverageYieldSwapError,
  LeverageYieldSwapPayload,
  LeverageYieldVault,
  NearRawTransaction,
  OpenPositionFromDebtTokenParams,
  OpenPositionParams,
  PositionDirectCall,
  PositionIntentCall,
  PositionLegQuote,
  RelayExtraData,
  Result,
  SolanaRawTransaction,
  SolverErrorResponse,
  SolverExecutionResponse,
  SolverIntentQuoteResponse,
  SolverIntentStatusResponse,
  StacksRawTransaction,
  StellarRawTransaction,
  SuiRawTransaction,
  TxHashPair,
  VaultSwapActionParams,
  VaultSwapResponse,
  VaultSwapWithApprovalError,
  VaultSwapWithApprovalParams,
  VaultSwapWithApprovalResponse,
} from '../index.js';
import type { LeverageYieldService } from './LeverageYieldService.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SONIC = typeof ChainKeys.SONIC_MAINNET;
type Keys = {
  evm: BSC;
  hub: SONIC;
  icon: typeof ChainKeys.ICON_MAINNET;
  sui: typeof ChainKeys.SUI_MAINNET;
  stellar: typeof ChainKeys.STELLAR_MAINNET;
  solana: typeof ChainKeys.SOLANA_MAINNET;
  injective: typeof ChainKeys.INJECTIVE_MAINNET;
  near: typeof ChainKeys.NEAR_MAINNET;
  stacks: typeof ChainKeys.STACKS_MAINNET;
  bitcoin: typeof ChainKeys.BITCOIN_MAINNET;
};
// [signed, raw] result per family, spelled out rather than derived through `TxReturnType`.
type Fam = {
  evm: [Hex, EvmRawTransaction];
  hub: [Hex, EvmRawTransaction];
  icon: [Hex, IconRawTransaction];
  sui: [string, SuiRawTransaction];
  stellar: [string, StellarRawTransaction];
  solana: [string, SolanaRawTransaction];
  injective: [string, InjectiveRawTransaction];
  near: [string, NearRawTransaction];
  stacks: [string, StacksRawTransaction];
  // Bitcoin's raw type already includes the hash string.
  bitcoin: [string, BitcoinRawTransaction | string];
};
type VaultIntent<T> = Promise<
  Result<{ tx: T; intent: Intent & FeeAmount; relayData: RelayExtraData }, LeverageYieldCreateIntentError>
>;
type VaultIntentMatrix = {
  readonly [N in keyof Fam]: readonly [VaultIntent<Fam[N][0]>, VaultIntent<Fam[N][1]>];
};
type FundingApproveMatrix = { readonly [N in keyof Fam]: Promise<Result<Fam[N][0], LeverageYieldApproveError>> };
type Lookup<T> = Promise<Result<T, LeverageYieldLookupError>>;
type Opened = Promise<Result<TxHashPair, LeverageYieldSwapError | LeverageYieldLookupError>>;
type Reported = Promise<Result<LeveragePositionIntentResult, LeverageYieldSwapError | LeverageYieldLookupError>>;

declare const svc: LeverageYieldService;
declare const wallet: {
  evm: IEvmWalletProvider;
  hub: IEvmWalletProvider;
  icon: IIconWalletProvider;
  sui: ISuiWalletProvider;
  stellar: IStellarWalletProvider;
  solana: ISolanaWalletProvider;
  injective: IInjectiveWalletProvider;
  near: INearWalletProvider;
  stacks: IStacksWalletProvider;
  bitcoin: IBitcoinWalletProvider;
};
declare const vault: { [N in keyof Keys]: CreateIntentParams<Keys[N]> };
declare const funding: {
  [N in keyof Keys]: { srcChainKey: Keys[N]; srcAddress: string; token: string; amount: bigint };
};
declare const open: { [N in keyof Keys]: OpenPositionParams<Keys[N]> };
declare const openDebt: { [N in keyof Keys]: OpenPositionFromDebtTokenParams<Keys[N]> };
declare const evmTx: EvmRawTransaction;
declare const intentCall: PositionIntentCall;
declare const directCall: PositionDirectCall;
declare const isRaw: boolean;

// One row per chain family: [walletProvider, raw: true]. Never invoked.
const vaultIntentRows = () =>
  ({
    evm: [
      svc.createVaultIntent({ params: vault.evm, walletProvider: wallet.evm }),
      svc.createVaultIntent({ params: vault.evm, raw: true }),
    ],
    hub: [
      svc.createVaultIntent({ params: vault.hub, walletProvider: wallet.hub }),
      svc.createVaultIntent({ params: vault.hub, raw: true }),
    ],
    icon: [
      svc.createVaultIntent({ params: vault.icon, walletProvider: wallet.icon }),
      svc.createVaultIntent({ params: vault.icon, raw: true }),
    ],
    sui: [
      svc.createVaultIntent({ params: vault.sui, walletProvider: wallet.sui }),
      svc.createVaultIntent({ params: vault.sui, raw: true }),
    ],
    stellar: [
      svc.createVaultIntent({ params: vault.stellar, walletProvider: wallet.stellar }),
      svc.createVaultIntent({ params: vault.stellar, raw: true }),
    ],
    solana: [
      svc.createVaultIntent({ params: vault.solana, walletProvider: wallet.solana }),
      svc.createVaultIntent({ params: vault.solana, raw: true }),
    ],
    injective: [
      svc.createVaultIntent({ params: vault.injective, walletProvider: wallet.injective }),
      svc.createVaultIntent({ params: vault.injective, raw: true }),
    ],
    near: [
      svc.createVaultIntent({ params: vault.near, walletProvider: wallet.near }),
      svc.createVaultIntent({ params: vault.near, raw: true }),
    ],
    stacks: [
      svc.createVaultIntent({ params: vault.stacks, walletProvider: wallet.stacks }),
      svc.createVaultIntent({ params: vault.stacks, raw: true }),
    ],
    bitcoin: [
      svc.createVaultIntent({ params: vault.bitcoin, walletProvider: wallet.bitcoin }),
      svc.createVaultIntent({ params: vault.bitcoin, raw: true }),
    ],
  }) as const;

// Signed only: `walletProvider` is optional and the result is always the broadcast hash.
const fundingApproveRows = () =>
  ({
    evm: svc.approvePositionFunding({ ...funding.evm, walletProvider: wallet.evm }),
    hub: svc.approvePositionFunding({ ...funding.hub, walletProvider: wallet.hub }),
    icon: svc.approvePositionFunding({ ...funding.icon, walletProvider: wallet.icon }),
    sui: svc.approvePositionFunding({ ...funding.sui, walletProvider: wallet.sui }),
    stellar: svc.approvePositionFunding({ ...funding.stellar, walletProvider: wallet.stellar }),
    solana: svc.approvePositionFunding({ ...funding.solana, walletProvider: wallet.solana }),
    injective: svc.approvePositionFunding({ ...funding.injective, walletProvider: wallet.injective }),
    near: svc.approvePositionFunding({ ...funding.near, walletProvider: wallet.near }),
    stacks: svc.approvePositionFunding({ ...funding.stacks, walletProvider: wallet.stacks }),
    bitcoin: svc.approvePositionFunding({ ...funding.bitcoin, walletProvider: wallet.bitcoin }),
  }) as const;

describe('LeverageYieldService', () => {
  it('createVaultIntent narrows to the source chain family and mode', () => {
    expectTypeOf<ReturnType<typeof vaultIntentRows>>().toEqualTypeOf<VaultIntentMatrix>();
  });

  it('createVaultIntent: explicit raw: false matches the omitted form; a runtime mode keeps both', () => {
    const explicit = () => svc.createVaultIntent({ params: vault.icon, raw: false, walletProvider: wallet.icon });
    expectTypeOf<ReturnType<typeof explicit>>().toEqualTypeOf<VaultIntent<Hex>>();
    const runtime = (args: VaultSwapActionParams<BSC, boolean>) => svc.createVaultIntent(args);
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<VaultIntent<Hex | EvmRawTransaction>>();
  });

  it('approve is hub-only and narrows by mode', () => {
    const calls = (runtime: LeverageYieldApproveParams<boolean>, vaultAddr: Address) =>
      [
        svc.approve({ vault: vaultAddr, amount: 1n, walletProvider: wallet.hub }),
        svc.approve({ vault: vaultAddr, amount: 1n, walletProvider: wallet.hub, raw: false }),
        svc.approve({ vault: vaultAddr, amount: 1n, walletProvider: wallet.hub, raw: true }),
        svc.approve(runtime),
      ] as const;
    type R<T> = Promise<Result<T, LeverageYieldApproveError>>;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<
      readonly [R<Hex>, R<Hex>, R<EvmRawTransaction>, R<Hex | EvmRawTransaction>]
    >();
  });

  it('approvePositionFunding narrows to the source family hash', () => {
    expectTypeOf<ReturnType<typeof fundingApproveRows>>().toEqualTypeOf<FundingApproveMatrix>();
    const noWallet = () => svc.approvePositionFunding(funding.evm);
    expectTypeOf<ReturnType<typeof noWallet>>().toEqualTypeOf<Promise<Result<Hex, LeverageYieldApproveError>>>();
  });

  it('vault swaps resolve to fixed results from any source chain', () => {
    const calls = (
      withApproval: VaultSwapWithApprovalParams<BSC>,
      hubWithApproval: VaultSwapWithApprovalParams<SONIC>,
    ) =>
      [
        svc.vaultSwap({ params: vault.evm, walletProvider: wallet.evm }),
        svc.vaultSwap({ params: vault.hub, walletProvider: wallet.hub }),
        svc.vaultSwap({ params: vault.sui, walletProvider: wallet.sui }),
        svc.getApprovalStrategy(withApproval),
        svc.getApprovalStrategy(hubWithApproval),
        svc.vaultSwapWithApproval(withApproval),
        svc.vaultSwapWithApproval(hubWithApproval),
      ] as const;
    type Swap = Promise<Result<VaultSwapResponse, LeverageYieldSwapError>>;
    type Strategy = Promise<Result<ApprovalStrategy, ApprovalStrategyError>>;
    type WithApproval = Promise<Result<VaultSwapWithApprovalResponse, VaultSwapWithApprovalError>>;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<
      readonly [Swap, Swap, Swap, Strategy, Strategy, WithApproval, WithApproval]
    >();
  });

  it('registry, quote and solver reporting return fixed types', () => {
    expectTypeOf<ReturnType<LeverageYieldService['listVaults']>>().toEqualTypeOf<readonly LeverageYieldVault[]>();
    expectTypeOf<ReturnType<LeverageYieldService['getVault']>>().toEqualTypeOf<LeverageYieldVault | undefined>();
    expectTypeOf<ReturnType<LeverageYieldService['getVaultByAddress']>>().toEqualTypeOf<
      LeverageYieldVault | undefined
    >();
    expectTypeOf<ReturnType<LeverageYieldService['getQuote']>>().toEqualTypeOf<
      Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse | LeverageYieldLookupError>>
    >();
    type Payload = Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError | LeverageYieldLookupError>>;
    expectTypeOf<ReturnType<LeverageYieldService['deposit']>>().toEqualTypeOf<Payload>();
    expectTypeOf<ReturnType<LeverageYieldService['withdraw']>>().toEqualTypeOf<Payload>();
    expectTypeOf<ReturnType<LeverageYieldService['notifySolver']>>().toEqualTypeOf<
      Promise<Result<SolverExecutionResponse, LeverageYieldPostExecutionError>>
    >();
    expectTypeOf<ReturnType<LeverageYieldService['getIntentStatus']>>().toEqualTypeOf<
      Promise<Result<SolverIntentStatusResponse, LeverageYieldPostExecutionError>>
    >();
    expectTypeOf<ReturnType<LeverageYieldService['getDetailedStatus']>>().toEqualTypeOf<
      Promise<Result<DetailedLeverageYieldStatus, LeverageYieldDetailedStatusError>>
    >();
    expectTypeOf<ReturnType<LeverageYieldService['isAllowanceValid']>>().toEqualTypeOf<
      Promise<Result<boolean, LeverageYieldAllowanceCheckError>>
    >();
  });

  it('vault reads return fixed lookups', () => {
    expectTypeOf<ReturnType<LeverageYieldService['getAsset']>>().toEqualTypeOf<Lookup<Address>>();
    expectTypeOf<ReturnType<LeverageYieldService['getPosition']>>().toEqualTypeOf<Lookup<LeverageYieldPosition>>();
    expectTypeOf<ReturnType<LeverageYieldService['getApr']>>().toEqualTypeOf<Lookup<LeverageYieldApr>>();
    expectTypeOf<ReturnType<LeverageYieldService['getLsdApr']>>().toEqualTypeOf<Lookup<LeverageYieldLsdApr>>();
    expectTypeOf<ReturnType<LeverageYieldService['getEffectiveApr']>>().toEqualTypeOf<
      Lookup<LeverageYieldEffectiveApr>
    >();
    expectTypeOf<ReturnType<LeverageYieldService['getMaxWithdraw']>>().toEqualTypeOf<Lookup<bigint>>();
    expectTypeOf<ReturnType<LeverageYieldService['getTotalAssets']>>().toEqualTypeOf<Lookup<bigint>>();
    expectTypeOf<ReturnType<LeverageYieldService['previewDeposit']>>().toEqualTypeOf<Lookup<bigint>>();
    expectTypeOf<ReturnType<LeverageYieldService['previewWithdraw']>>().toEqualTypeOf<Lookup<bigint>>();
    expectTypeOf<ReturnType<LeverageYieldService['previewRedeem']>>().toEqualTypeOf<Lookup<bigint>>();
    expectTypeOf<ReturnType<LeverageYieldService['getShareBalance']>>().toEqualTypeOf<Lookup<bigint>>();
  });

  it('per-user reads return the same lookup from any source chain', () => {
    const calls = (v: Address) =>
      [
        svc.getMaxWithdrawForUser(v, open.evm.srcChainKey, ''),
        svc.getMaxWithdrawForUser(v, open.hub.srcChainKey, ''),
        svc.getMaxWithdrawForUser(v, open.solana.srcChainKey, ''),
        svc.getShareBalanceForUser(v, open.evm.srcChainKey, ''),
        svc.getShareBalanceForUser(v, open.stellar.srcChainKey, ''),
      ] as const;
    type B = Lookup<bigint>;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<readonly [B, B, B, B, B]>();
    const positions = () =>
      [
        svc.listPositionsForUser(open.evm.srcChainKey, ''),
        svc.listPositionsForUser(open.icon.srcChainKey, ''),
      ] as const;
    type L = Lookup<readonly Address[]>;
    expectTypeOf<ReturnType<typeof positions>>().toEqualTypeOf<readonly [L, L]>();
    expectTypeOf<ReturnType<LeverageYieldService['listPositions']>>().toEqualTypeOf<L>();
  });

  it('position reads return fixed lookups', () => {
    expectTypeOf<ReturnType<LeverageYieldService['getPositionInfo']>>().toEqualTypeOf<Lookup<LeveragePosition>>();
    expectTypeOf<ReturnType<LeverageYieldService['getPositionAccount']>>().toEqualTypeOf<
      Lookup<LeveragePositionAccount>
    >();
    expectTypeOf<ReturnType<LeverageYieldService['getPositionCollateralBalance']>>().toEqualTypeOf<
      Lookup<LeveragePositionCollateral>
    >();
    expectTypeOf<ReturnType<LeverageYieldService['getPositionPendingState']>>().toEqualTypeOf<
      Lookup<LeveragePositionPendingState>
    >();
    expectTypeOf<ReturnType<LeverageYieldService['predictPosition']>>().toEqualTypeOf<Lookup<Address>>();
    expectTypeOf<ReturnType<LeverageYieldService['getEffectivePositionFee']>>().toEqualTypeOf<
      Result<{ feeReceiver: Address; feeBps: number }, LeverageYieldLookupError>
    >();
    expectTypeOf<ReturnType<LeverageYieldService['resolvePositionFunding']>>().toEqualTypeOf<Address | undefined>();
    expectTypeOf<ReturnType<LeverageYieldService['getPositionLegQuote']>>().toEqualTypeOf<
      Promise<Result<PositionLegQuote, SolverErrorResponse | LeverageYieldLookupError>>
    >();
  });

  it('position builders brand their calls by whether they post an intent', () => {
    type Built = Result<EvmRawTransaction, LeverageYieldLookupError>;
    expectTypeOf<ReturnType<LeverageYieldService['buildCreatePositionAndLeverage']>>().toEqualTypeOf<Built>();
    expectTypeOf<ReturnType<LeverageYieldService['buildCreatePositionFromDebtToken']>>().toEqualTypeOf<Built>();
    expectTypeOf<ReturnType<LeverageYieldService['buildAddLeverage']>>().toEqualTypeOf<PositionIntentCall>();
    expectTypeOf<ReturnType<LeverageYieldService['buildDecreaseLeverage']>>().toEqualTypeOf<PositionIntentCall>();
    expectTypeOf<ReturnType<LeverageYieldService['buildPositionWithdraw']>>().toEqualTypeOf<PositionDirectCall>();
    expectTypeOf<ReturnType<LeverageYieldService['buildSettlePosition']>>().toEqualTypeOf<PositionDirectCall>();
    expectTypeOf<
      ReturnType<LeverageYieldService['buildCancelPositionOperation']>
    >().toEqualTypeOf<PositionDirectCall>();
    expectTypeOf<ReturnType<LeverageYieldService['encodePositionCalls']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<LeverageYieldService['buildOpenPositionData']>>().toEqualTypeOf<Lookup<Hex>>();
    expectTypeOf<ReturnType<LeverageYieldService['buildOpenPositionFromDebtTokenData']>>().toEqualTypeOf<Lookup<Hex>>();
  });

  it('isPositionFundingAllowanceValid returns the same check from any source chain', () => {
    const calls = () =>
      [
        svc.isPositionFundingAllowanceValid(funding.evm),
        svc.isPositionFundingAllowanceValid(funding.hub),
        svc.isPositionFundingAllowanceValid(funding.stellar),
      ] as const;
    type R = Promise<Result<boolean, LeverageYieldAllowanceCheckError>>;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<readonly [R, R, R]>();
  });

  it('opening a position resolves to a hash pair or a reported intent from any source chain', () => {
    const calls = () =>
      [
        svc.openPosition({ params: open.evm, walletProvider: wallet.evm }),
        svc.openPosition({ params: open.hub, walletProvider: wallet.hub }),
        svc.openPosition({ params: open.sui, walletProvider: wallet.sui }),
        svc.openPositionFromDebtToken({ params: openDebt.evm, walletProvider: wallet.evm }),
        svc.openPositionFromDebtToken({ params: openDebt.icon, walletProvider: wallet.icon }),
      ] as const;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<readonly [Opened, Opened, Opened, Opened, Opened]>();
    // Both `side` variants of the params union select the same result.
    const leverage = () =>
      [
        svc.openLeveragePosition({ params: open.evm, walletProvider: wallet.evm }),
        svc.openLeveragePosition({ side: 'collateral', params: open.hub, walletProvider: wallet.hub }),
        svc.openLeveragePosition({ side: 'debt', params: openDebt.solana, walletProvider: wallet.solana }),
      ] as const;
    expectTypeOf<ReturnType<typeof leverage>>().toEqualTypeOf<readonly [Reported, Reported, Reported]>();
  });

  it('operating a position resolves by which calls it carries', () => {
    const calls = () =>
      [
        svc.submitLeveragePositionIntent({
          params: { srcChainKey: open.evm.srcChainKey, srcAddress: '', calls: [directCall, intentCall] },
          walletProvider: wallet.evm,
        }),
        svc.runLeveragePositionOperation({
          params: { srcChainKey: open.near.srcChainKey, srcAddress: '', calls: [directCall] },
          walletProvider: wallet.near,
        }),
        svc.operatePosition({
          params: { srcChainKey: open.hub.srcChainKey, srcAddress: '', calls: [evmTx] },
          walletProvider: wallet.hub,
        }),
      ] as const;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<
      readonly [
        Promise<Result<LeveragePositionIntentResult, LeverageYieldSwapError>>,
        Promise<Result<TxHashPair, LeverageYieldSwapError>>,
        Promise<Result<TxHashPair, LeverageYieldSwapError>>,
      ]
    >();
  });

  it('rejects wrong wallets, modes, params variants and unbranded calls', () => {
    const calls = () => [
      // @ts-expect-error — the walletProvider must match the source chain.
      svc.createVaultIntent({ params: vault.evm, walletProvider: wallet.solana }),
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.createVaultIntent({ params: vault.evm, raw: true, walletProvider: wallet.evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      svc.createVaultIntent({ params: vault.evm }),
      // @ts-expect-error — a non-literal boolean cannot pick a branch in an object literal.
      svc.createVaultIntent({ params: vault.evm, raw: isRaw }),
      // @ts-expect-error — vault approval runs on the hub; an ICON wallet cannot sign it.
      svc.approve({ vault: open.evm.borrowToken, amount: 1n, walletProvider: wallet.icon }),
      // @ts-expect-error — the vault swap is signed only.
      svc.vaultSwap({ params: vault.evm, raw: true }),
      // @ts-expect-error — the walletProvider must match the funding chain.
      svc.approvePositionFunding({ ...funding.icon, walletProvider: wallet.evm }),
      // @ts-expect-error — side: 'debt' needs the debt-token params (collateral, totalInput).
      svc.openLeveragePosition({ side: 'debt', params: open.evm, walletProvider: wallet.evm }),
      svc.submitLeveragePositionIntent({
        // @ts-expect-error — an unbranded transaction cannot ride in an intent batch.
        params: { srcChainKey: open.evm.srcChainKey, srcAddress: '', calls: [evmTx] },
        walletProvider: wallet.evm,
      }),
      svc.runLeveragePositionOperation({
        // @ts-expect-error — an intent call on the route-only path would never be reported.
        params: { srcChainKey: open.evm.srcChainKey, srcAddress: '', calls: [intentCall] },
        walletProvider: wallet.evm,
      }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
