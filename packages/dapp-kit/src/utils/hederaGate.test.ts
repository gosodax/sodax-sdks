import { ChainKeys, type HederaDestinationReadiness } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import { resolveHederaGate, type HederaCheckResult } from './hederaGate.js';

const HEDERA = ChainKeys.HEDERA_MAINNET;

const resolved = <T>(data: T): HederaCheckResult<T> => ({ isLoading: false, isError: false, data });
const loading = <T>(): HederaCheckResult<T> => ({ isLoading: true, isError: false, data: undefined });
const errored = <T>(): HederaCheckResult<T> => ({ isLoading: false, isError: true, data: undefined });
const idle = <T>(): HederaCheckResult<T> => ({ isLoading: false, isError: false, data: undefined });

const gate = (
  chainKey: Parameters<typeof resolveHederaGate>[0],
  inputs: { readinessCheck?: HederaCheckResult<HederaDestinationReadiness>; requiresAssociation?: boolean } = {},
) =>
  resolveHederaGate(chainKey, {
    readinessCheck: inputs.readinessCheck ?? resolved({ ready: true }),
    requiresAssociation: inputs.requiresAssociation ?? true,
  });

const NOT_GATED = {
  isHederaHtsToken: false,
  needsAssociation: false,
  blockedReason: undefined,
  checkFailed: false,
  blocksAction: false,
};
const OPEN = { ...NOT_GATED, isHederaHtsToken: true };

describe('resolveHederaGate — what it leaves alone', () => {
  it('passes other chains and an unset chain through, whatever the check says', () => {
    expect(gate(ChainKeys.XRP_MAINNET, { readinessCheck: errored() })).toEqual(NOT_GATED);
    expect(gate(ChainKeys.ARBITRUM_MAINNET, { readinessCheck: loading() })).toEqual(NOT_GATED);
    expect(gate(undefined, { readinessCheck: resolved({ ready: false, reason: 'not_associated' }) })).toEqual(
      NOT_GATED,
    );
  });

  it('passes HBAR through, which needs no association', () => {
    expect(
      gate(HEDERA, {
        requiresAssociation: false,
        readinessCheck: resolved({ ready: false, reason: 'not_associated' }),
      }),
    ).toEqual(NOT_GATED);
  });

  it('opens for an associated account', () => {
    expect(gate(HEDERA)).toEqual(OPEN);
  });
});

describe('resolveHederaGate — what it blocks', () => {
  it('asks for the association when the account is not associated', () => {
    expect(gate(HEDERA, { readinessCheck: resolved({ ready: false, reason: 'not_associated' }) })).toEqual({
      ...OPEN,
      needsAssociation: true,
      blocksAction: true,
    });
  });

  it.each([
    'account_missing',
    'frozen',
    'kyc_not_granted',
  ] as const)('blocks a %s account with the reason and no association step', reason => {
    expect(gate(HEDERA, { readinessCheck: resolved({ ready: false, reason }) })).toEqual({
      ...OPEN,
      blockedReason: reason,
      blocksAction: true,
    });
  });

  it('fails closed while the check is loading or has not run', () => {
    expect(gate(HEDERA, { readinessCheck: loading() })).toEqual({ ...OPEN, blocksAction: true });
    expect(gate(HEDERA, { readinessCheck: idle() })).toEqual({ ...OPEN, blocksAction: true });
  });

  it('reports a failed check as checkFailed, not as a missing association', () => {
    expect(gate(HEDERA, { readinessCheck: errored() })).toEqual({ ...OPEN, checkFailed: true, blocksAction: true });
  });
});
