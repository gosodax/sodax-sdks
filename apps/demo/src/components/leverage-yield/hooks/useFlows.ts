import { useCallback } from 'react';
import {
  type CreateIntentResponseV2,
  type GetWalletProviderType,
  type LeverageYieldVault,
  type SpokeChainKey,
  type XToken,
  useLeverageYieldApiApproveAndBroadcast,
  useLeverageYieldApiCreateDepositIntent,
  useLeverageYieldApiCreateWithdrawIntent,
  useLeverageYieldApiSubmitTx,
  useLeverageYieldDeposit,
  useLeverageYieldVaultSwap,
  useLeverageYieldWithdraw,
  useSodaxContext,
  useSwapApprove,
} from '@sodax/dapp-kit';
import { getXChainType } from '@sodax/wallet-sdk-react';
import { toIntentRequest } from '@/components/swaps-api/lib/mappers';
import { signAndBroadcastSwapsApiTx } from '@/components/swaps-api/lib/signAndBroadcast';
import { mayHaveBroadcast } from '../lib/errors';
import { DEPOSIT_PARTNER_FEE } from '../lib/fees';
import { withTxListener } from '../lib/withTxListener';
import { useTransport } from '../transport';
import { useFlowState } from './useFlowState';

type WalletProvider = GetWalletProviderType<SpokeChainKey>;

/**
 * Outcome of an SDK vaultSwap. Success hands completion to the live intent status: on the client-relay path the call
 * resolves once the solver accepts the intent, before the fill. A failure after a possible broadcast is flagged
 * `maybeSent` unless the hash is already known: EVM sends always pass `withTxListener`, other wallets never do.
 */
function settleVaultSwap(
  result: Awaited<ReturnType<ReturnType<typeof useLeverageYieldVaultSwap>['mutateAsyncSafe']>>,
  srcChainKey: SpokeChainKey,
  patch: ReturnType<typeof useFlowState>['patch'],
): void {
  if (!result.ok) {
    if (getXChainType(srcChainKey) !== 'EVM' && mayHaveBroadcast(result.error)) patch({ maybeSent: true });
    throw result.error;
  }
  patch({ step: 'processing', srcTxHash: result.value.intentDeliveryInfo.srcTxHash, handedOff: true });
}

export type DepositInput = {
  vault: LeverageYieldVault;
  srcChainKey: SpokeChainKey;
  srcAddress: string;
  token: XToken;
  inputAmount: bigint;
  /** From the quote, after slippage. Never 0. */
  minShares: bigint;
  walletProvider: WalletProvider;
};

export type WithdrawInput = {
  vault: LeverageYieldVault;
  /** Chain the shares are held under (the chain the deposit came from). The user signs here. */
  srcChainKey: SpokeChainKey;
  srcAddress: string;
  dstChainKey: SpokeChainKey;
  /** Receives the output on `dstChainKey`: the connected wallet there. */
  recipient: string;
  outputToken: XToken;
  shares: bigint;
  /** From the quote, after slippage. Never 0. */
  minAmountOut: bigint;
  walletProvider: WalletProvider;
};

/** Deposit flow for the page's transport. Both hooks run; only the active one is ever started. */
export function useDepositFlow() {
  const { transport } = useTransport();
  const sdk = useSdkDeposit();
  const api = useApiDeposit();
  return transport === 'api' ? api : sdk;
}

export function useWithdrawFlow() {
  const { transport } = useTransport();
  const sdk = useSdkWithdraw();
  const api = useApiWithdraw();
  return transport === 'api' ? api : sdk;
}

/**
 * SDK deposit: build payload → approve the input token if needed → vaultSwap (sign, submit, solver fill).
 * The payload is built at confirm time: its deadline is ~5 minutes out, so one built early can expire mid-review.
 */
function useSdkDeposit() {
  const { sodax } = useSodaxContext();
  const { apiConfig } = useTransport();
  const { mutateAsyncSafe: buildDeposit } = useLeverageYieldDeposit();
  const { mutateAsyncSafe: approve } = useSwapApprove();
  const { mutateAsyncSafe: vaultSwap } = useLeverageYieldVaultSwap();
  const { state, patch, run } = useFlowState();

  const deposit = useCallback(
    ({ vault, srcChainKey, srcAddress, token, inputAmount, minShares, walletProvider }: DepositInput) =>
      run(async () => {
        if (minShares <= 0n) throw new Error('Minimum received must be greater than 0.');
        const built = await buildDeposit({
          vault: vault.vault,
          srcChainKey,
          srcAddress,
          inputToken: token.address,
          inputAmount,
          minOutputAmount: minShares,
          partnerFee: DEPOSIT_PARTNER_FEE,
        });
        if (!built.ok) throw built.error;
        const payload = built.value;

        const allowance = await sodax.swaps.isAllowanceValid({ params: payload.params, raw: false, walletProvider });
        if (!allowance.ok) throw allowance.error;
        if (!allowance.value) {
          patch({ step: 'approving' });
          const approved = await approve({
            params: payload.params,
            walletProvider: withTxListener(walletProvider, hash => patch({ approveTxHash: hash })),
          });
          if (!approved.ok) throw approved.error;
          // The deposit simulates against the new allowance, so the approval must be mined first.
          const receipt = await sodax.spoke.waitForTxReceipt({ txHash: String(approved.value), chainKey: srcChainKey });
          if (!receipt.ok || receipt.value.status !== 'success') {
            throw new Error('The approval transaction failed on-chain. Check your gas balance and try again.');
          }
        }

        patch({ step: 'signing' });
        const result = await vaultSwap({
          ...payload,
          walletProvider: withTxListener(walletProvider, hash => patch({ step: 'processing', srcTxHash: hash })),
          // Per-action key from Sodax Settings; omitted when unset so the backend legs use the instance key.
          ...(apiConfig?.apiKey ? { extras: { apiKey: apiConfig.apiKey } } : {}),
        });
        settleVaultSwap(result, srcChainKey, patch);
      }),
    [sodax, apiConfig, buildDeposit, approve, vaultSwap, patch, run],
  );

  return { state, deposit };
}

/**
 * SDK withdraw: build payload → vaultSwap. No approval: the payload has `hubWalletSwap: true`, so the user signs one
 * `sendMessage` on `srcChainKey` authorising the hub wallet to spend its lsoda* shares.
 */
function useSdkWithdraw() {
  const { apiConfig } = useTransport();
  const { mutateAsyncSafe: buildWithdraw } = useLeverageYieldWithdraw();
  const { mutateAsyncSafe: vaultSwap } = useLeverageYieldVaultSwap();
  const { state, patch, run } = useFlowState();

  const withdraw = useCallback(
    (input: WithdrawInput) =>
      run(async () => {
        if (input.minAmountOut <= 0n) throw new Error('Minimum received must be greater than 0.');
        const built = await buildWithdraw({
          vault: input.vault.vault,
          srcChainKey: input.srcChainKey,
          srcAddress: input.srcAddress,
          dstChainKey: input.dstChainKey,
          outputToken: input.outputToken.address,
          inputAmount: input.shares,
          minOutputAmount: input.minAmountOut,
          recipient: input.recipient,
        });
        if (!built.ok) throw built.error;

        patch({ step: 'signing' });
        const result = await vaultSwap({
          ...built.value,
          walletProvider: withTxListener(input.walletProvider, hash => patch({ step: 'processing', srcTxHash: hash })),
          ...(apiConfig?.apiKey ? { extras: { apiKey: apiConfig.apiKey } } : {}),
        });
        settleVaultSwap(result, input.srcChainKey, patch);
      }),
    [apiConfig, buildWithdraw, vaultSwap, patch, run],
  );

  return { state, withdraw };
}

/**
 * API path: the API builds unsigned transactions; the wallet signs them, then `/submit-tx` relays to Sonic.
 *   deposit:  check allowance → approve (API builds, wallet signs) → create intent → sign → submit-tx
 *   withdraw:                                                         create intent → sign → submit-tx
 */
function useSignAndSubmit() {
  const { apiConfig } = useTransport();
  const { mutateAsyncSafe: submitTx } = useLeverageYieldApiSubmitTx();

  return useCallback(
    async (
      operation: 'deposit' | 'withdraw',
      created: CreateIntentResponseV2,
      srcChainKey: SpokeChainKey,
      srcAddress: string,
      walletProvider: WalletProvider,
      /** Called as soon as the tx is broadcast, so a failed `/submit-tx` still leaves its hash on screen. */
      onBroadcast: (txHash: string) => void,
    ) => {
      const txHash = await signAndBroadcastSwapsApiTx({ chainKey: srcChainKey, tx: created.tx, walletProvider });
      onBroadcast(txHash);
      const submitted = await submitTx({
        request: {
          txHash,
          srcChainKey,
          walletAddress: srcAddress,
          intent: toIntentRequest(created.intent),
          relayData: created.relayData.payload,
          operation,
        },
        apiConfig,
      });
      if (!submitted.ok) throw submitted.error;
      return txHash;
    },
    [apiConfig, submitTx],
  );
}

function useApiDeposit() {
  const { sodax } = useSodaxContext();
  const { apiConfig } = useTransport();
  const { mutateAsyncSafe: approve } = useLeverageYieldApiApproveAndBroadcast();
  const { mutateAsyncSafe: createDepositIntent } = useLeverageYieldApiCreateDepositIntent();
  const signAndSubmit = useSignAndSubmit();
  const { state, patch, run } = useFlowState();

  const deposit = useCallback(
    (input: DepositInput) =>
      run(async () => {
        if (input.minShares <= 0n) throw new Error('Minimum received must be greater than 0.');
        const body = {
          vault: input.vault.vault,
          srcChainKey: input.srcChainKey,
          srcAddress: input.srcAddress,
          inputToken: input.token.address,
          inputAmount: input.inputAmount.toString(),
          minOutputAmount: input.minShares.toString(),
        };
        const allowance = await sodax.api.leverageYield.checkAllowance(body, apiConfig);
        if (!allowance.ok) throw allowance.error;
        if (!allowance.value.valid) {
          patch({ step: 'approving' });
          // The hook plans, signs, broadcasts and waits for the approval (incl. USDT-style resets).
          const approved = await approve({
            body,
            walletProvider: withTxListener(input.walletProvider, hash => patch({ approveTxHash: hash })),
            apiConfig,
          });
          if (!approved.ok) throw approved.error;
        }
        patch({ step: 'signing' });
        const created = await createDepositIntent({ body, apiConfig });
        if (!created.ok) throw created.error;
        const txHash = await signAndSubmit(
          'deposit',
          created.value,
          input.srcChainKey,
          input.srcAddress,
          input.walletProvider,
          hash => patch({ srcTxHash: hash }),
        );
        patch({ step: 'processing', srcTxHash: txHash, handedOff: true });
      }),
    [sodax, apiConfig, approve, createDepositIntent, signAndSubmit, patch, run],
  );

  return { state, deposit };
}

function useApiWithdraw() {
  const { apiConfig } = useTransport();
  const { mutateAsyncSafe: createWithdrawIntent } = useLeverageYieldApiCreateWithdrawIntent();
  const signAndSubmit = useSignAndSubmit();
  const { state, patch, run } = useFlowState();

  const withdraw = useCallback(
    (input: WithdrawInput) =>
      run(async () => {
        if (input.minAmountOut <= 0n) throw new Error('Minimum received must be greater than 0.');
        const created = await createWithdrawIntent({
          body: {
            vault: input.vault.vault,
            srcChainKey: input.srcChainKey,
            srcAddress: input.srcAddress,
            dstChainKey: input.dstChainKey,
            outputToken: input.outputToken.address,
            inputAmount: input.shares.toString(),
            minOutputAmount: input.minAmountOut.toString(),
            recipient: input.recipient,
          },
          apiConfig,
        });
        if (!created.ok) throw created.error;
        patch({ step: 'signing' });
        const txHash = await signAndSubmit(
          'withdraw',
          created.value,
          input.srcChainKey,
          input.srcAddress,
          input.walletProvider,
          hash => patch({ srcTxHash: hash }),
        );
        patch({ step: 'processing', srcTxHash: txHash, handedOff: true });
      }),
    [apiConfig, createWithdrawIntent, signAndSubmit, patch, run],
  );

  return { state, withdraw };
}
