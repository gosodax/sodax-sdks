/**
 * Tests for the wallet-rejection classifying wrappers.
 *
 * The detector itself (`isWalletRejection`) is private to `wrappers.ts`, so we exercise it
 * indirectly through `intentCreationFailed` (the wrapper most service catch blocks use): if the
 * cause is a recognised rejection shape, the returned error has `code === 'USER_REJECTED'`;
 * otherwise it falls back to the wrapper's own code (`INTENT_CREATION_FAILED`).
 *
 * Coverage matrix:
 * - viem:    UserRejectedRequestError (name), EIP-1193 code 4001, ethers ACTION_REJECTED,
 *            EIP-5792 declined account upgrade (AtomicReadyWalletRejectedUpgradeError, 5750)
 * - ICON:    CANCEL_SIGNING / CANCEL_JSON-RPC string codes, numeric -31002
 * - generic: text patterns ('user rejected', 'user denied', 'transaction rejected', 'user abort',
 *            'popup closed', 'rejected by user', 'request rejected', case-insensitive)
 * - misses:  non-rejection errors (network, validation) must NOT classify as USER_REJECTED
 */

import {
  AtomicityNotSupportedError,
  AtomicReadyWalletRejectedUpgradeError,
  TransactionExecutionError,
  UserRejectedRequestError,
} from 'viem';
import { describe, expect, it } from 'vitest';
import { SodaxError } from './SodaxError.js';
import { IndeterminateOutcomeError, isIndeterminateOutcomeError } from './IndeterminateOutcomeError.js';
import { approveFailed, intentCreationFailed, withErrorContext } from './wrappers.js';

describe('intentCreationFailed (wallet rejection classification)', () => {
  it('classifies EVM rejection shapes (viem class/name, 4001, ethers ACTION_REJECTED) as USER_REJECTED with a clean message', () => {
    // viem's UserRejectedRequestError message is a multi-line dump with Request Arguments + Version.
    // The wrapper must NOT inherit that as the SodaxError.message — Sentry/Datadog titles must stay clean.
    const noisyCause = new UserRejectedRequestError(
      new Error(
        'User rejected the request.\n\nRequest Arguments:\n  from: 0xabc\n  to: 0xdef\n  data: 0x1234...\n\nDetails: User rejected the request.\nVersion: viem@2.29.2',
      ),
    );
    const err = intentCreationFailed('staking', noisyCause);
    expect(err.code).toBe('USER_REJECTED');
    expect(err.feature).toBe('staking');
    expect(err.message).toBe('User rejected the request');
    expect(err.message).not.toContain('Request Arguments');
    expect(err.message).not.toContain('Version: viem');
    // The raw cause is still preserved for debugging.
    expect(err.cause).toBe(noisyCause);

    expect(intentCreationFailed('swap', { name: 'UserRejectedRequestError', message: 'anything' }).code).toBe(
      'USER_REJECTED',
    );
    expect(intentCreationFailed('moneyMarket', { code: 4001, message: 'reject' }).code).toBe('USER_REJECTED');
    expect(intentCreationFailed('bridge', { code: 'ACTION_REJECTED' }).code).toBe('USER_REJECTED');
  });

  it('classifies a declined EIP-5792 account upgrade (5750) as USER_REJECTED, even when sendCalls wraps it', () => {
    const declined = new AtomicReadyWalletRejectedUpgradeError(new Error('upgrade rejected'));
    expect(intentCreationFailed('swap', declined).code).toBe('USER_REJECTED');
    expect(intentCreationFailed('swap', { code: 5750, message: 'upgrade' }).code).toBe('USER_REJECTED');
    const wrapped = new TransactionExecutionError(
      new AtomicReadyWalletRejectedUpgradeError(new Error('upgrade rejected')),
      { account: null },
    );
    expect(intentCreationFailed('swap', wrapped).code).toBe('USER_REJECTED');
  });

  it('classifies ICON Hana CANCEL_SIGNING / CANCEL_JSON-RPC and numeric -31002 as USER_REJECTED', () => {
    expect(intentCreationFailed('migration', { code: 'CANCEL_SIGNING' }).code).toBe('USER_REJECTED');
    expect(intentCreationFailed('migration', { code: 'CANCEL_JSON-RPC' }).code).toBe('USER_REJECTED');
    expect(intentCreationFailed('migration', { code: -31002 }).code).toBe('USER_REJECTED');
  });

  it('classifies rejection text in a named wallet error, message, shortMessage or details as USER_REJECTED', () => {
    // Solana WalletSignTransactionError, Phantom, mobile wallets, Stacks Connect, then viem layouts.
    expect(
      intentCreationFailed('swap', { name: 'WalletSignTransactionError', message: 'User rejected the request' }).code,
    ).toBe('USER_REJECTED');
    expect(intentCreationFailed('swap', new Error('Transaction was rejected by the user.')).code).toBe('USER_REJECTED');
    expect(intentCreationFailed('swap', new Error('User aborted signing.')).code).toBe('USER_REJECTED');
    expect(intentCreationFailed('migration', new Error('Popup closed by user')).code).toBe('USER_REJECTED');
    expect(intentCreationFailed('staking', { shortMessage: 'User rejected the request.' }).code).toBe('USER_REJECTED');
    expect(
      intentCreationFailed('staking', { details: 'MetaMask Tx Signature: User denied transaction signature.' }).code,
    ).toBe('USER_REJECTED');
  });

  it('does NOT classify non-rejections (5760, node rejection, network, gas, revert, nullish) as USER_REJECTED', () => {
    const unsupported = new AtomicityNotSupportedError(new Error('no atomicity'));
    expect(intentCreationFailed('swap', unsupported).code).toBe('INTENT_CREATION_FAILED');
    // The `was` in `/transaction was rejected/i` is mandatory so chain-level / RPC-level
    // rejections that don't include "was" stay as INTENT_CREATION_FAILED (not a user cancel).
    expect(intentCreationFailed('swap', new Error('Transaction rejected by node')).code).toBe('INTENT_CREATION_FAILED');
    expect(intentCreationFailed('swap', new Error('Network request failed')).code).toBe('INTENT_CREATION_FAILED');
    expect(intentCreationFailed('moneyMarket', new Error('insufficient funds for gas')).code).toBe(
      'INTENT_CREATION_FAILED',
    );
    expect(intentCreationFailed('bridge', { code: -32000, message: 'execution reverted' }).code).toBe(
      'INTENT_CREATION_FAILED',
    );
    expect(intentCreationFailed('swap', undefined).code).toBe('INTENT_CREATION_FAILED');
    expect(intentCreationFailed('swap', null).code).toBe('INTENT_CREATION_FAILED');
  });
});

describe('intentCreationFailed recovery context', () => {
  it('retains recovery details from an indeterminate-outcome cause', () => {
    const feature = 'bridge';
    const recovery = { deadline: 42 };
    const original = new Error('User rejected the request');
    const cause = Object.freeze(
      new IndeterminateOutcomeError(original.message, {
        cause: original,
        txHash: '0x123',
        trackingId: '0x456',
        recovery,
      }),
    );
    const error = intentCreationFailed(feature, cause, { field: 'amount' });
    expect(error).toMatchObject({
      code: 'INTENT_CREATION_FAILED',
      feature,
      context: { field: 'amount', srcTxHash: '0x123', trackingId: '0x456', recovery },
    });
    expect(error.cause).toBe(cause);
    expect(error.context?.recovery).toBe(recovery);
  });

  it('recognizes the error shape without relying on the SDK class identity', () => {
    const foreign = new Error('submit reply lost', { cause: undefined });
    foreign.name = 'IndeterminateOutcomeError';
    expect(isIndeterminateOutcomeError(foreign)).toBe(true);
    expect(isIndeterminateOutcomeError(Object.assign(foreign, { trackingId: 5 }))).toBe(false);
  });
});

describe('approveFailed (wallet rejection classification)', () => {
  it('classifies viem rejection as USER_REJECTED, otherwise APPROVE_FAILED', () => {
    expect(approveFailed('staking', { code: 4001 }).code).toBe('USER_REJECTED');
    expect(approveFailed('staking', new Error('execution reverted')).code).toBe('APPROVE_FAILED');
  });
});

describe('isSodaxError early-out (prevents message-content false positives)', () => {
  it('trusts a SodaxError code over its message: VALIDATION_FAILED stays unclassified, USER_REJECTED stays a rejection', () => {
    // Without the early-out, `/user rejected/i` would match this message and silently re-emit
    // USER_REJECTED, changing the code from VALIDATION_FAILED.
    const validation = new SodaxError('VALIDATION_FAILED', 'user rejected by invariant', { feature: 'staking' });
    const err = intentCreationFailed('staking', validation);
    expect(err.code).toBe('INTENT_CREATION_FAILED');
    expect(err.cause).toBe(validation);

    const rejected = new SodaxError('USER_REJECTED', 'User rejected the request', { feature: 'swap' });
    expect(intentCreationFailed('swap', rejected).code).toBe('USER_REJECTED');
  });
});

describe('withErrorContext', () => {
  it('merges context over the original while keeping code, message, feature and cause', () => {
    const cause = new Error('root');
    const original = new SodaxError('APPROVE_FAILED', 'Approve failed', {
      feature: 'swap',
      cause,
      context: { phase: 'approve', srcChainKey: 'bsc' },
    });

    const merged = withErrorContext(original, { action: 'swapWithApproval', srcChainKey: '0x38.bsc' });

    expect(merged.code).toBe('APPROVE_FAILED');
    expect(merged.message).toBe('Approve failed');
    expect(merged.feature).toBe('swap');
    expect(merged.cause).toBe(cause);
    expect(merged.context).toEqual({ phase: 'approve', srcChainKey: '0x38.bsc', action: 'swapWithApproval' });
  });
});
