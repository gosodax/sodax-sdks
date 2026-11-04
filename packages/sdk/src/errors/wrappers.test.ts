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
import { approveFailed, intentCreationFailed, withErrorContext } from './wrappers.js';

describe('intentCreationFailed (wallet rejection classification)', () => {
  it('classifies a viem UserRejectedRequestError instance as USER_REJECTED', () => {
    const wallet = new UserRejectedRequestError(new Error('User denied transaction signature.'));
    const err = intentCreationFailed('staking', wallet);
    expect(err.code).toBe('USER_REJECTED');
    expect(err.feature).toBe('staking');
    expect(err.cause).toBe(wallet);
  });

  it('classifies any object with name === "UserRejectedRequestError" as USER_REJECTED', () => {
    const err = intentCreationFailed('swap', { name: 'UserRejectedRequestError', message: 'anything' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies EIP-1193 code 4001 as USER_REJECTED', () => {
    const err = intentCreationFailed('moneyMarket', { code: 4001, message: 'reject' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies a declined EIP-5792 account upgrade (5750) as USER_REJECTED', () => {
    const declined = new AtomicReadyWalletRejectedUpgradeError(new Error('upgrade rejected'));
    expect(intentCreationFailed('swap', declined).code).toBe('USER_REJECTED');
    expect(intentCreationFailed('swap', { code: 5750, message: 'upgrade' }).code).toBe('USER_REJECTED');
  });

  it('classifies a declined upgrade as USER_REJECTED when sendCalls wraps it', () => {
    const wrapped = new TransactionExecutionError(
      new AtomicReadyWalletRejectedUpgradeError(new Error('upgrade rejected')),
      { account: null },
    );
    expect(intentCreationFailed('swap', wrapped).code).toBe('USER_REJECTED');
  });

  it('does not treat "atomicity not supported" (5760) as a rejection', () => {
    const unsupported = new AtomicityNotSupportedError(new Error('no atomicity'));
    expect(intentCreationFailed('swap', unsupported).code).toBe('INTENT_CREATION_FAILED');
  });

  it('classifies ethers ACTION_REJECTED as USER_REJECTED', () => {
    const err = intentCreationFailed('bridge', { code: 'ACTION_REJECTED' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies ICON Hana CANCEL_SIGNING as USER_REJECTED', () => {
    const err = intentCreationFailed('migration', { code: 'CANCEL_SIGNING' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies ICON Hana CANCEL_JSON-RPC as USER_REJECTED', () => {
    const err = intentCreationFailed('migration', { code: 'CANCEL_JSON-RPC' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies ICON numeric code -31002 as USER_REJECTED', () => {
    const err = intentCreationFailed('migration', { code: -31002 });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies Solana WalletSignTransactionError + "User rejected" message as USER_REJECTED', () => {
    const err = intentCreationFailed('swap', {
      name: 'WalletSignTransactionError',
      message: 'User rejected the request',
    });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies Phantom-style "Transaction was rejected" message as USER_REJECTED', () => {
    const err = intentCreationFailed('swap', new Error('Transaction was rejected by the user.'));
    expect(err.code).toBe('USER_REJECTED');
  });

  it('does NOT classify "Transaction rejected by node" (network failure, no `was`) as USER_REJECTED', () => {
    // The `was` in `/transaction was rejected/i` is mandatory so chain-level / RPC-level
    // rejections that don't include "was" stay as INTENT_CREATION_FAILED (not a user cancel).
    const err = intentCreationFailed('swap', new Error('Transaction rejected by node'));
    expect(err.code).toBe('INTENT_CREATION_FAILED');
  });

  it('classifies "User aborted" message (some mobile wallets) as USER_REJECTED', () => {
    const err = intentCreationFailed('swap', new Error('User aborted signing.'));
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies "popup closed by user" message (Stacks Connect) as USER_REJECTED', () => {
    const err = intentCreationFailed('migration', new Error('Popup closed by user'));
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies shortMessage field (viem layout) as USER_REJECTED', () => {
    const err = intentCreationFailed('staking', { shortMessage: 'User rejected the request.' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies details field (viem layout) as USER_REJECTED', () => {
    const err = intentCreationFailed('staking', {
      details: 'MetaMask Tx Signature: User denied transaction signature.',
    });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('does NOT classify a network error as USER_REJECTED', () => {
    const err = intentCreationFailed('swap', new Error('Network request failed'));
    expect(err.code).toBe('INTENT_CREATION_FAILED');
  });

  it('does NOT classify "insufficient funds" as USER_REJECTED', () => {
    const err = intentCreationFailed('moneyMarket', new Error('insufficient funds for gas'));
    expect(err.code).toBe('INTENT_CREATION_FAILED');
  });

  it('does NOT classify EVM revert (code -32000) as USER_REJECTED', () => {
    const err = intentCreationFailed('bridge', { code: -32000, message: 'execution reverted' });
    expect(err.code).toBe('INTENT_CREATION_FAILED');
  });

  it('does NOT classify undefined/null cause as USER_REJECTED', () => {
    expect(intentCreationFailed('swap', undefined).code).toBe('INTENT_CREATION_FAILED');
    expect(intentCreationFailed('swap', null).code).toBe('INTENT_CREATION_FAILED');
  });
});

describe('approveFailed (wallet rejection classification)', () => {
  it('classifies viem rejection as USER_REJECTED, otherwise APPROVE_FAILED', () => {
    expect(approveFailed('staking', { code: 4001 }).code).toBe('USER_REJECTED');
    expect(approveFailed('staking', new Error('execution reverted')).code).toBe('APPROVE_FAILED');
  });
});

describe('isSodaxError early-out (prevents message-content false positives)', () => {
  it('does NOT reclassify a SodaxError("VALIDATION_FAILED") with rejection-shaped message', async () => {
    // Construct a SodaxError whose message contains 'user rejected' text. Without the early-out,
    // the regex `/user rejected/i` would match and `intentCreationFailed` would re-emit
    // USER_REJECTED — silently changing the code from VALIDATION_FAILED.
    const { SodaxError } = await import('./SodaxError.js');
    const upstream = new SodaxError('VALIDATION_FAILED', 'user rejected by invariant', { feature: 'staking' });

    const err = intentCreationFailed('staking', upstream);

    // The wrapper still proceeds via the default branch (not USER_REJECTED) — the SodaxError
    // taxonomy is trusted over message content. The reviewer's call-site `isXxxCreateIntentError`
    // guard is what forwards the original SodaxError unchanged; this test only verifies that the
    // wrapper itself does not silently reclassify a non-rejection SodaxError.
    expect(err.code).toBe('INTENT_CREATION_FAILED');
    expect(err.cause).toBe(upstream);
  });

  it('still recognises a SodaxError("USER_REJECTED") as a rejection', async () => {
    const { SodaxError } = await import('./SodaxError.js');
    const upstream = new SodaxError('USER_REJECTED', 'User rejected the request', { feature: 'swap' });

    const err = intentCreationFailed('swap', upstream);

    // Already-classified USER_REJECTED stays USER_REJECTED (the canonical call-site forward via
    // isXxxCreateIntentError handles this more efficiently, but the wrapper alone preserves the
    // code rather than mutating it).
    expect(err.code).toBe('USER_REJECTED');
  });
});

describe('USER_REJECTED clean message', () => {
  it('uses a hardcoded "User rejected the request" message, not the cause.message', () => {
    // viem's UserRejectedRequestError message is a multi-line dump with Request Arguments + Version.
    // The wrapper must NOT inherit that as the SodaxError.message — Sentry/Datadog titles must stay clean.
    const noisyCause = new UserRejectedRequestError(
      new Error(
        'User rejected the request.\n\nRequest Arguments:\n  from: 0xabc\n  to: 0xdef\n  data: 0x1234...\n\nDetails: User rejected the request.\nVersion: viem@2.29.2',
      ),
    );

    const err = intentCreationFailed('staking', noisyCause);

    expect(err.code).toBe('USER_REJECTED');
    expect(err.message).toBe('User rejected the request');
    expect(err.message).not.toContain('Request Arguments');
    expect(err.message).not.toContain('Version: viem');

    // The raw cause is still preserved for debugging.
    expect(err.cause).toBe(noisyCause);
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
