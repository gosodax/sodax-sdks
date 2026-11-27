import { ChainKeys, type XrpDestinationReadiness } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import { resolveXrpGate, type XrpCheckResult } from './xrpGate.js';

const XRP = ChainKeys.XRP_MAINNET;

const resolved = <T>(data: T): XrpCheckResult<T> => ({ isLoading: false, isError: false, data });
const loading = <T>(): XrpCheckResult<T> => ({ isLoading: true, isError: false, data: undefined });
const errored = <T>(): XrpCheckResult<T> => ({ isLoading: false, isError: true, data: undefined });
const idle = <T>(): XrpCheckResult<T> => ({ isLoading: false, isError: false, data: undefined });

const refused = (reason: Extract<XrpDestinationReadiness, { ready: false }>['reason']): XrpDestinationReadiness => ({
  ready: false,
  reason,
});

const gate = (
  chainKey: typeof XRP | undefined,
  inputs: {
    readinessCheck?: XrpCheckResult<XrpDestinationReadiness>;
    reserveCheck?: XrpCheckResult<boolean>;
    requiresTrustline?: boolean;
  } = {},
) =>
  resolveXrpGate(chainKey, {
    readinessCheck: inputs.readinessCheck ?? resolved({ ready: true }),
    reserveCheck: inputs.reserveCheck ?? idle(),
    requiresTrustline: inputs.requiresTrustline ?? true,
  });

const OPEN = {
  isXrpIssuedToken: true,
  needsTrustline: false,
  needsFunding: false,
  blockedReason: undefined,
  checkFailed: false,
  blocksAction: false,
};

describe('resolveXrpGate — what it leaves alone', () => {
  it.each([[ChainKeys.STELLAR_MAINNET], [undefined]])('is inert for %s', chainKey => {
    expect(gate(chainKey as undefined, { readinessCheck: refused('no_trustline') as never })).toMatchObject({
      isXrpIssuedToken: false,
      blocksAction: false,
    });
  });

  it('is inert for native XRP, which needs no trustline', () => {
    expect(gate(XRP, { requiresTrustline: false, readinessCheck: loading() })).toMatchObject({
      isXrpIssuedToken: false,
      blocksAction: false,
    });
  });
});

describe('resolveXrpGate — an XRPL issued token', () => {
  it('lets the swap through once the destination can receive', () => {
    expect(gate(XRP)).toEqual(OPEN);
  });

  it('fails closed while the readiness read is loading, and reports a failed read', () => {
    expect(gate(XRP, { readinessCheck: loading() })).toEqual({ ...OPEN, blocksAction: true });
    expect(gate(XRP, { readinessCheck: errored() })).toEqual({ ...OPEN, checkFailed: true, blocksAction: true });
  });

  it.each([
    'no_trustline',
    'trustline_limit',
  ] as const)('asks for a trustline on %s when the account can pay for it', reason => {
    expect(gate(XRP, { readinessCheck: resolved(refused(reason)), reserveCheck: resolved(true) })).toEqual({
      ...OPEN,
      needsTrustline: true,
      blocksAction: true,
    });
  });

  it('asks for funding when the account cannot pay for the trustline', () => {
    expect(gate(XRP, { readinessCheck: resolved(refused('no_trustline')), reserveCheck: resolved(false) })).toEqual({
      ...OPEN,
      needsFunding: true,
      blocksAction: true,
    });
  });

  it('fails closed while the reserve read is pending, and reports a failed one', () => {
    const readinessCheck = resolved(refused('no_trustline'));
    expect(gate(XRP, { readinessCheck, reserveCheck: idle() })).toEqual({ ...OPEN, blocksAction: true });
    expect(gate(XRP, { readinessCheck, reserveCheck: loading() })).toEqual({ ...OPEN, blocksAction: true });
    expect(gate(XRP, { readinessCheck, reserveCheck: errored() })).toEqual({
      ...OPEN,
      checkFailed: true,
      blocksAction: true,
    });
  });

  // Every other refusal takes one branch: one account-level and one trustline-named reason stand for the rest.
  it.each([
    'account_not_found',
    'trustline_frozen',
  ] as const)('blocks with the reason on %s, which no trustline change fixes', reason => {
    // The reserve is irrelevant here, so even an affordable account gets no trustline action.
    expect(gate(XRP, { readinessCheck: resolved(refused(reason)), reserveCheck: resolved(true) })).toEqual({
      ...OPEN,
      blockedReason: reason,
      blocksAction: true,
    });
  });
});
