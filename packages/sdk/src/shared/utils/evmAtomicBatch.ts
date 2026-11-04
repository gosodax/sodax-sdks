import type { EvmAtomicBatchSupport, IEvmWalletProvider } from '@sodax/types';

/** An EVM wallet provider that implements all three optional EIP-5792 batch methods. */
export type AtomicBatchEvmWalletProvider = IEvmWalletProvider &
  Required<Pick<IEvmWalletProvider, 'getAtomicBatchSupport' | 'sendAtomicBatch' | 'waitForBatch'>>;

/**
 * Whether `walletProvider` implements the EIP-5792 batch methods. They are optional on
 * `IEvmWalletProvider`, so a provider without them is sent separate transactions instead.
 *
 * Deliberately NOT re-exported: an internal guard, not SDK surface. `approvalBatch.ts` is the public policy.
 */
export function canSendAtomicBatch(walletProvider: IEvmWalletProvider): walletProvider is AtomicBatchEvmWalletProvider {
  return (
    typeof walletProvider.getAtomicBatchSupport === 'function' &&
    typeof walletProvider.sendAtomicBatch === 'function' &&
    typeof walletProvider.waitForBatch === 'function'
  );
}

/** The wallet's atomic-batch support on `chainId`. A wallet that cannot answer counts as unsupported. */
export async function readAtomicBatchSupport(
  walletProvider: AtomicBatchEvmWalletProvider,
  chainId: number,
): Promise<EvmAtomicBatchSupport> {
  try {
    return await walletProvider.getAtomicBatchSupport(chainId);
  } catch {
    return 'unsupported';
  }
}

/** EIP-1193 / EIP-5792 codes for a batch the wallet turns down before signing; user rejections (4001, 5750) are not. */
const BATCH_REFUSED_CODES: ReadonlySet<number> = new Set([4200, -32601, 5700, 5710, 5740, 5760]);
const MAX_CAUSE_DEPTH = 5;

// EIP-5792: the wallet could have upgraded the account to execute atomically, but the user declined.
const UPGRADE_DECLINED_CODE = 5750;

/** Whether `error` (or a cause, as viem wraps RPC errors) says the wallet refused the batch outright. */
export function isAtomicBatchRefused(error: unknown): boolean {
  return hasErrorCode(error, code => BATCH_REFUSED_CODES.has(code));
}

/** Whether `error` (or a cause) is the user declining the account upgrade a `'ready'` wallet asked for. */
export function isAccountUpgradeDeclined(error: unknown): boolean {
  return hasErrorCode(error, code => code === UPGRADE_DECLINED_CODE);
}

function hasErrorCode(error: unknown, matches: (code: number) => boolean): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === 'object' && current !== null; depth++) {
    const code = 'code' in current ? current.code : undefined;
    if (typeof code === 'number' && matches(code)) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
