import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOOKS_DIR = resolve(fileURLToPath(import.meta.url), '..');

/**
 * Manifest of every mutation hook. `nativeThrow: true` marks hooks whose underlying SDK methods
 * throw natively (Bound Exchange APIs) and so don't need `unwrapResult`.
 *
 * To add a new mutation hook, add its path here. The friction is intentional — it forces explicit
 * registration so the contract is enforced from day one.
 */
const HOOKS: Array<{ path: string; nativeThrow?: true }> = [
  { path: 'bitcoin/useEnsureRadfiAccessToken.ts', nativeThrow: true },
  { path: 'bitcoin/useFundTradingWallet.ts', nativeThrow: true },
  { path: 'bitcoin/useRadfiAuth.ts', nativeThrow: true },
  { path: 'bitcoin/useRadfiWithdraw.ts', nativeThrow: true },
  { path: 'bitcoin/useRenewUtxos.ts', nativeThrow: true },
  { path: 'bridge/useBridge.ts' },
  { path: 'bridge/useBridgeApprove.ts' },
  { path: 'bridge/useBridgeWithApproval.ts' },
  { path: 'dex/useClaimRewards.ts' },
  { path: 'dex/useDecreaseLiquidity.ts' },
  { path: 'dex/useDexApprove.ts' },
  { path: 'dex/useDexDeposit.ts' },
  { path: 'dex/useDexWithdraw.ts' },
  { path: 'dex/useSupplyLiquidity.ts' },
  { path: 'leverageYield/useRunLeveragePositionOperation.ts' },
  { path: 'leverageYield/useLeverageYieldDeposit.ts' },
  { path: 'leverageYield/useLeverageYieldNotifySolver.ts' },
  { path: 'leverageYield/useLeverageYieldVaultSwap.ts' },
  { path: 'leverageYield/useLeverageYieldVaultSwapWithApproval.ts' },
  { path: 'leverageYield/useLeverageYieldWithdraw.ts' },
  { path: 'leverageYield/useApproveLeveragePositionFunding.ts' },
  { path: 'leverageYield/useOpenLeveragePosition.ts' },
  { path: 'leverageYield/useSubmitLeveragePositionIntent.ts' },
  { path: 'leverageYieldApi/useLeverageYieldApiApprove.ts' },
  { path: 'leverageYieldApi/useLeverageYieldApiApproveAndBroadcast.ts' },
  { path: 'leverageYieldApi/useLeverageYieldApiCancelIntent.ts' },
  { path: 'leverageYieldApi/useLeverageYieldApiCreateDepositIntent.ts' },
  { path: 'leverageYieldApi/useLeverageYieldApiCreateWithdrawIntent.ts' },
  { path: 'leverageYieldApi/useLeverageYieldApiSubmitIntent.ts' },
  { path: 'leverageYieldApi/useLeverageYieldApiSubmitTx.ts' },
  { path: 'migrate/useMigrateBaln.ts' },
  { path: 'migrate/useMigrateIcxToSoda.ts' },
  { path: 'migrate/useMigratebnUSD.ts' },
  { path: 'migrate/useMigrationApprove.ts' },
  { path: 'migrate/useRevertMigrateSodaToIcx.ts' },
  { path: 'mm/useBorrow.ts' },
  { path: 'mm/useMMApprove.ts' },
  { path: 'mm/useRepay.ts' },
  { path: 'mm/useSupply.ts' },
  { path: 'mm/useWithdraw.ts' },
  { path: 'partner/useApproveToken.ts' },
  { path: 'partner/useFeeClaimSwap.ts' },
  { path: 'partner/useFeeClaimWithdraw.ts' },
  { path: 'partner/usePartnerCancelIntent.ts' },
  { path: 'partner/useSetSwapPreference.ts' },
  { path: 'recovery/useWithdrawHubAsset.ts' },
  { path: 'shared/useEstablishTrustline.ts', nativeThrow: true },
  { path: 'shared/useEstablishXrpTrustline.ts' },
  { path: 'shared/useEstimateGas.ts' },
  { path: 'shared/useRegisterNearStorage.ts', nativeThrow: true },
  { path: 'sponsoring/useActivateStellarAccount.ts' },
  { path: 'staking/useCancelUnstake.ts' },
  { path: 'staking/useClaim.ts' },
  { path: 'staking/useInstantUnstake.ts' },
  { path: 'staking/useInstantUnstakeApprove.ts' },
  { path: 'staking/useStake.ts' },
  { path: 'staking/useStakeApprove.ts' },
  { path: 'staking/useUnstake.ts' },
  { path: 'staking/useUnstakeApprove.ts' },
  { path: 'swap/useCancelLimitOrder.ts' },
  { path: 'swap/useCancelSwap.ts' },
  { path: 'swap/useCreateLimitOrder.ts' },
  { path: 'swap/useSwap.ts' },
  { path: 'swap/useSwapApprove.ts' },
  { path: 'swap/useSwapWithApproval.ts' },
  { path: 'swapsApi/useSwapsApiApprove.ts' },
  { path: 'swapsApi/useSwapsApiApproveAndBroadcast.ts' },
  { path: 'swapsApi/useSwapsApiBroadcastWithApproval.ts' },
  { path: 'swapsApi/useSwapsApiCancelIntent.ts' },
  { path: 'swapsApi/useSwapsApiCreateIntent.ts' },
  { path: 'swapsApi/useSwapsApiCreateLimitOrder.ts' },
  { path: 'swapsApi/useSwapsApiSubmitIntent.ts' },
  { path: 'swapsApi/useSwapsApiSubmitTx.ts' },
  { path: 'bridgeApi/useBridgeApiApprove.ts' },
  { path: 'bridgeApi/useBridgeApiApproveAndBroadcast.ts' },
  { path: 'bridgeApi/useBridgeApiCreateBridgeIntent.ts' },
  { path: 'bridgeApi/useBridgeApiSubmitTx.ts' },
];

// One test per hook; `expect.soft` reports every broken rule by name instead of stopping at the first.
describe('mutation hook contract', () => {
  it.each(HOOKS)('$path', ({ path, nativeThrow }) => {
    const src = readFileSync(resolve(HOOKS_DIR, path), 'utf8');
    const keyIdx = src.search(/mutationKey:\s*\[/);
    const spreadIdx = src.indexOf('...mutationOptions');
    const fnIdx = src.search(/\bmutationFn:/);

    expect.soft(src, 'uses useSafeMutation').toMatch(/useSafeMutation</);
    // Negative lookbehind excludes useSafeMutation; catches a regression to bare useMutation.
    expect.soft(src, 'does not use bare useMutation').not.toMatch(/(?<!Safe)useMutation</);
    expect.soft(src, 'returns SafeUseMutationResult').toMatch(/SafeUseMutationResult</);
    expect.soft(keyIdx, 'sets a default mutationKey').toBeGreaterThan(-1);
    expect.soft(spreadIdx, 'spreads mutationOptions').toBeGreaterThan(-1);
    expect.soft(keyIdx, 'sets mutationKey before the mutationOptions spread').toBeLessThan(spreadIdx);
    expect
      .soft(src.match(/mutationKey:\s*\[\s*'([^']+)'/)?.[1], 'mutationKey first segment matches feature directory')
      .toBe(path.split('/')[0]);
    expect.soft(fnIdx, 'defines mutationFn after the mutationOptions spread').toBeGreaterThan(spreadIdx);
    // Hand-rolling one balance key leaves the other balance hook (useBalances vs useXBalances) stale.
    expect
      .soft(src, 'routes balance invalidation through invalidateBalances')
      .not.toMatch(/invalidateQueries\(\{\s*queryKey:\s*\[\s*'shared',\s*'x?[bB]alances'/);
    if (!nativeThrow) expect.soft(src, 'translates SDK Result via unwrapResult').toMatch(/unwrapResult\(/);
  });
});
