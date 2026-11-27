import { ChainKeys, type StellarAccountStatus } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import { resolveStellarGate, type StellarCheckResult } from './stellarGate.js';

const STELLAR = ChainKeys.STELLAR_MAINNET;

const resolved = <T>(data: T): StellarCheckResult<T> => ({ isLoading: false, isError: false, data });
const loading = <T>(): StellarCheckResult<T> => ({ isLoading: true, isError: false, data: undefined });
const errored = <T>(): StellarCheckResult<T> => ({ isLoading: false, isError: true, data: undefined });
const idle = <T>(): StellarCheckResult<T> => ({ isLoading: false, isError: false, data: undefined });

const status = (overrides: Partial<StellarAccountStatus> = {}): StellarAccountStatus => ({
  exists: true,
  nativeBalanceStroops: 10_000_000n,
  availableBalanceStroops: 10_000_000n,
  canAffordTrustline: true,
  trustlineMinXlmStroops: 5_100_000n,
  ...overrides,
});

const gate = (
  chainKey: typeof STELLAR | undefined,
  inputs: {
    statusCheck?: StellarCheckResult<StellarAccountStatus>;
    trustlineCheck?: StellarCheckResult<boolean>;
    isNativeToken?: boolean;
  } = {},
) =>
  resolveStellarGate(chainKey, {
    statusCheck: inputs.statusCheck ?? resolved(status()),
    trustlineCheck: inputs.trustlineCheck ?? resolved(true),
    isNativeToken: inputs.isNativeToken ?? false,
  });

describe('resolveStellarGate — non-Stellar destinations', () => {
  it.each([[ChainKeys.SONIC_MAINNET], [undefined]])('is inert for %s, even when every check failed', chainKey => {
    expect(gate(chainKey as undefined, { statusCheck: errored(), trustlineCheck: errored() })).toEqual({
      isStellar: false,
      needsActivation: false,
      needsFunding: false,
      needsTrustline: false,
      checkFailed: false,
      blocksAction: false,
    });
  });
});

describe('resolveStellarGate — unknown account state blocks without accusing', () => {
  it.each([
    ['a loading status read', { statusCheck: loading<StellarAccountStatus>() }],
    ['an idle/disabled status read', { statusCheck: idle<StellarAccountStatus>() }],
    ['an idle/disabled trustline read', { trustlineCheck: idle<boolean>() }],
  ])('blocks without claiming a prerequisite or a failure for %s', (_label, inputs) => {
    // Unknown state is neither a missing prerequisite nor a failed check.
    expect(gate(STELLAR, inputs)).toEqual({
      isStellar: true,
      needsActivation: false,
      needsFunding: false,
      needsTrustline: false,
      checkFailed: false,
      blocksAction: true,
    });
  });

  it.each([
    ['the status read', { statusCheck: errored<StellarAccountStatus>() }],
    ['the trustline read', { trustlineCheck: errored<boolean>() }],
  ])('reports checkFailed when %s errors, so the UI can offer a retry', (_label, inputs) => {
    const result = gate(STELLAR, inputs);
    expect(result.checkFailed).toBe(true);
    expect(result.blocksAction).toBe(true);
    expect(result.needsActivation).toBe(false);
    expect(result.needsFunding).toBe(false);
    expect(result.needsTrustline).toBe(false);
  });
});

describe('resolveStellarGate — stage ordering', () => {
  it('reports activation first for a non-existent account, and nothing downstream', () => {
    const result = gate(STELLAR, {
      statusCheck: resolved(status({ exists: false, nativeBalanceStroops: 0n, canAffordTrustline: false })),
      trustlineCheck: resolved(false),
    });
    expect(result).toEqual({
      isStellar: true,
      needsActivation: true,
      needsFunding: false,
      needsTrustline: false,
      checkFailed: false,
      blocksAction: true,
    });
  });

  it('reports funding for a freshly activated 0-XLM account, NOT a trustline', () => {
    const result = gate(STELLAR, {
      statusCheck: resolved(status({ nativeBalanceStroops: 0n, canAffordTrustline: false })),
      trustlineCheck: resolved(false),
    });
    expect(result).toEqual({
      isStellar: true,
      needsActivation: false,
      needsFunding: true,
      needsTrustline: false,
      checkFailed: false,
      blocksAction: true,
    });
  });

  it('reports a trustline only once the account exists and can pay for one', () => {
    const result = gate(STELLAR, { trustlineCheck: resolved(false) });
    expect(result).toEqual({
      isStellar: true,
      needsActivation: false,
      needsFunding: false,
      needsTrustline: true,
      checkFailed: false,
      blocksAction: true,
    });
  });

  it('clears once the trustline exists, even for a broke account that could not afford a new one', () => {
    // Receiving through an existing trustline requires no recipient reserve or fee.
    const broke = status({ nativeBalanceStroops: 0n, availableBalanceStroops: 0n, canAffordTrustline: false });
    expect(gate(STELLAR, { statusCheck: resolved(broke), trustlineCheck: resolved(true) })).toEqual({
      isStellar: true,
      needsActivation: false,
      needsFunding: false,
      needsTrustline: false,
      checkFailed: false,
      blocksAction: false,
    });
  });
});

describe('resolveStellarGate — native XLM skips funding and trustline', () => {
  it('does not gate an activated 0-XLM account on funding when receiving native XLM', () => {
    // Native XLM needs no trustline or recipient fee, so funding cannot gate receipt.
    const result = gate(STELLAR, {
      statusCheck: resolved(status({ nativeBalanceStroops: 0n, canAffordTrustline: false })),
      trustlineCheck: resolved(false),
      isNativeToken: true,
    });
    expect(result.needsFunding).toBe(false);
    expect(result.needsTrustline).toBe(false);
    expect(result.blocksAction).toBe(false);
  });

  it('still requires the account to EXIST before it can receive native XLM', () => {
    const result = gate(STELLAR, {
      statusCheck: resolved(status({ exists: false, canAffordTrustline: false })),
      isNativeToken: true,
    });
    expect(result.needsActivation).toBe(true);
    expect(result.blocksAction).toBe(true);
  });
});
