import React, { type ReactNode } from 'react';
import { ChainKeys, isNativeToken, type LeverageYieldVault, type SpokeChainKey, type XToken } from '@sodax/dapp-kit';
import { chainName } from './chains';
import type { StepStatus } from '../Stepper';
import { TxLink } from '../TxLink';
import type { FlowState } from '../hooks/useFlowState';
import type { ProgressRow } from './progress';
import { vaultTitle } from './vaults';

/**
 * "What will happen": the route of a deposit or withdraw as stepper rows. Before the user confirms there is no
 * `progress`, so every row is pending and shows a hint; once the flow runs, rows go live and tx links replace hints.
 */

type Step = { label: string; status: StepStatus; detail?: ReactNode };
type Progress = { rows: Record<ProgressRow, StepStatus>; fillTxHash?: string };

const PREVIEW: Record<ProgressRow, StepStatus> = {
  approve: 'pending',
  sign: 'pending',
  deliver: 'pending',
  fill: 'pending',
};

function deliverStep(chainKey: SpokeChainKey, status: StepStatus): Step {
  return chainKey === ChainKeys.SONIC_MAINNET
    ? { label: 'Registered on Sonic', status, detail: 'Recorded on Sonic, the hub network' }
    : { label: 'Delivered to Sonic', status, detail: 'SODAX carries your order cross-network' };
}

function fillDetail(progress: Progress | undefined, hint: string): ReactNode {
  return progress?.fillTxHash ? <TxLink chainKey={ChainKeys.SONIC_MAINNET} hash={progress.fillTxHash} /> : hint;
}

export function depositSteps({
  vault,
  token,
  chainKey,
  progress,
  state,
}: {
  vault: LeverageYieldVault;
  token: XToken;
  chainKey: SpokeChainKey;
  progress?: Progress;
  state?: FlowState;
}): Step[] {
  const rows = progress?.rows ?? PREVIEW;
  const steps: Step[] = [];
  // Native tokens (ETH, S) need no approval.
  if (!isNativeToken(chainKey, token)) {
    steps.push({
      label: `Approve ${token.symbol}`,
      status: rows.approve,
      detail: state?.approveTxHash ? (
        <TxLink chainKey={chainKey} hash={state.approveTxHash} />
      ) : (
        'Skipped if SODAX already has permission'
      ),
    });
  }
  steps.push(
    {
      label: `Sign on ${chainName(chainKey)}`,
      status: rows.sign,
      detail: state?.srcTxHash ? <TxLink chainKey={chainKey} hash={state.srcTxHash} /> : 'One signature in your wallet',
    },
    deliverStep(chainKey, rows.deliver),
    {
      label: 'Solvers fill it',
      status: rows.fill,
      detail: fillDetail(progress, `${token.symbol} becomes ${vaultTitle(vault)} shares in your SODAX hub wallet`),
    },
  );
  return steps;
}

export function withdrawSteps({
  heldUnder,
  dstChainKey,
  outputSymbol,
  progress,
  state,
}: {
  /** The network the shares are held under: the user signs there. */
  heldUnder: SpokeChainKey;
  dstChainKey: SpokeChainKey;
  outputSymbol: string;
  progress?: Progress;
  state?: FlowState;
}): Step[] {
  const rows = progress?.rows ?? PREVIEW;
  return [
    {
      label: `Sign on ${chainName(heldUnder)}`,
      status: rows.sign,
      detail: state?.srcTxHash ? (
        <TxLink chainKey={heldUnder} hash={state.srcTxHash} />
      ) : (
        'One signature in your wallet, no approval'
      ),
    },
    deliverStep(heldUnder, rows.deliver),
    {
      label: `Solvers send ${outputSymbol} to ${chainName(dstChainKey)}`,
      status: rows.fill,
      detail: fillDetail(progress, `Your shares are sold for ${outputSymbol}`),
    },
  ];
}
