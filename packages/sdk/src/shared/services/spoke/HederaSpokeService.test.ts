/**
 * Tests for `HederaSpokeService` — HTS token associations. The rule that matters: only an existing
 * association makes an account ready, because the relay's delivery cannot pay for an automatic one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, type IEvmWalletProvider } from '@sodax/types';
import { isIndeterminateOutcomeError } from '../../../errors/IndeterminateOutcomeError.js';
import { Sodax } from '../../entities/Sodax.js';
import { HEDERA_DEFAULT_MIRROR_NODE_URL, hederaTokenId } from './HederaSpokeService.js';

const sodax = new Sodax();
const hedera = sodax.spoke.hedera;

const HBAR = '0x0000000000000000000000000000000000000000';
/** Hedera USDC, HTS token 0.0.456858. */
const USDC = '0x000000000000000000000000000000000006f89a';
const USDC_ID = '0.0.456858';
const BNUSD = '0x0000000000000000000000000000000000a0286a';
const ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678';
const TX_HASH = `0x${'ab'.repeat(32)}` as const;
const MIRROR = 'https://mainnet-public.mirrornode.hedera.com';

type MirrorAnswer = { status: number; body?: unknown } | (() => { status: number; body?: unknown });

let requested: string[];

/** Stands in for the mirror node: answers the account and token-relationship reads by URL. */
function stubMirror({ account, tokens }: { account: MirrorAnswer; tokens: MirrorAnswer }) {
  const fetchMock = vi.fn(async (url: string) => {
    requested.push(url);
    const route = url.includes('/tokens?') ? tokens : account;
    const { status, body } = typeof route === 'function' ? route() : route;
    // The service reads only ok, status and json() from a Response.
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const accountWithSlots = (max_automatic_token_associations: number) => ({
  status: 200,
  body: { account: '0.0.1234', deleted: false, max_automatic_token_associations },
});
const relationship = (fields: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    tokens: [
      { token_id: USDC_ID, automatic_association: false, freeze_status: 'UNFROZEN', kyc_status: 'GRANTED', ...fields },
    ],
    links: { next: null },
  },
});
const noRelationship = { status: 200, body: { tokens: [], links: { next: null } } };

beforeEach(() => {
  requested = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('hederaTokenId', () => {
  it('maps a long-zero address to its 0.0.N token id', () => {
    expect(hederaTokenId(USDC)).toBe(USDC_ID);
    expect(hederaTokenId(BNUSD)).toBe(`0.0.${0xa0286a}`);
  });

  it('accepts a checksummed or upper-case address', () => {
    expect(hederaTokenId(USDC.toUpperCase().replace('0X', '0x'))).toBe(USDC_ID);
  });

  it('returns undefined for the zero address, a contract address and a non-address', () => {
    expect(hederaTokenId(HBAR)).toBeUndefined();
    expect(hederaTokenId('0x0df73542cC68bDC01b361d231c60F726B0e0bC05')).toBeUndefined();
    expect(hederaTokenId('0.0.456858')).toBeUndefined();
  });
});

describe('HederaSpokeService.requiresAssociation', () => {
  it('is true for every listed HTS token and false for HBAR', () => {
    const tokens = Object.values(sodax.config.getChainConfig(ChainKeys.HEDERA_MAINNET).supportedTokens);
    expect(tokens.length).toBeGreaterThan(1);
    for (const token of tokens) {
      expect(hedera.requiresAssociation(token.address)).toBe(token.address !== HBAR);
    }
  });

  it('is false for a token Hedera does not list', () => {
    expect(hedera.requiresAssociation('0x00000000000000000000000000000000000fffff')).toBe(false);
  });
});

describe('HederaSpokeService.checkDestination', () => {
  it('reports HBAR ready without reading the mirror node', async () => {
    const fetchMock = stubMirror({ account: { status: 404 }, tokens: { status: 404 } });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: HBAR })).resolves.toEqual({ ready: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the account and its relationship for exactly that token from the configured mirror node', async () => {
    stubMirror({ account: accountWithSlots(0), tokens: relationship() });

    await hedera.checkDestination({ address: ACCOUNT, token: USDC });

    expect(requested.sort()).toEqual([
      `${MIRROR}/api/v1/accounts/${ACCOUNT}`,
      `${MIRROR}/api/v1/accounts/${ACCOUNT}/tokens?token.id=${USDC_ID}`,
    ]);
  });

  it('reports an associated, unfrozen, KYC-granted account ready', async () => {
    stubMirror({ account: accountWithSlots(0), tokens: relationship() });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toEqual({ ready: true });
  });

  it('reports ready for a token with neither a freeze nor a KYC key', async () => {
    stubMirror({
      account: accountWithSlots(0),
      tokens: relationship({ freeze_status: 'NOT_APPLICABLE', kyc_status: 'NOT_APPLICABLE' }),
    });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toEqual({ ready: true });
  });

  it('reports ready for a relationship that was itself created by an automatic association', async () => {
    stubMirror({ account: accountWithSlots(-1), tokens: relationship({ automatic_association: true }) });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toEqual({ ready: true });
  });

  it.each([
    ['unlimited (-1)', -1],
    ['free (10)', 10],
    ['no (0)', 0],
  ])('reports not_associated for an account with %s automatic slots and no relationship', async (_label, slots) => {
    stubMirror({ account: accountWithSlots(slots), tokens: noRelationship });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toEqual({
      ready: false,
      reason: 'not_associated',
    });
  });

  it('ignores a relationship for a different token', async () => {
    stubMirror({
      account: accountWithSlots(-1),
      tokens: { status: 200, body: { tokens: [{ token_id: '0.0.1', freeze_status: 'UNFROZEN' }] } },
    });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toEqual({
      ready: false,
      reason: 'not_associated',
    });
  });

  it('reports not_associated when the relationship body is malformed', async () => {
    stubMirror({ account: accountWithSlots(0), tokens: { status: 200, body: { tokens: 'nope' } } });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toEqual({
      ready: false,
      reason: 'not_associated',
    });
  });

  it('reports account_missing for an address with no Hedera account', async () => {
    stubMirror({ account: { status: 404 }, tokens: { status: 404 } });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toEqual({
      ready: false,
      reason: 'account_missing',
    });
  });

  it('reports account_missing for a deleted account', async () => {
    stubMirror({ account: { status: 200, body: { account: '0.0.1234', deleted: true } }, tokens: relationship() });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toEqual({
      ready: false,
      reason: 'account_missing',
    });
  });

  it('reports frozen for a relationship the token has frozen', async () => {
    stubMirror({ account: accountWithSlots(0), tokens: relationship({ freeze_status: 'FROZEN' }) });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toEqual({
      ready: false,
      reason: 'frozen',
    });
  });

  it('reports kyc_not_granted for a relationship without a KYC grant', async () => {
    stubMirror({ account: accountWithSlots(0), tokens: relationship({ kyc_status: 'REVOKED' }) });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toEqual({
      ready: false,
      reason: 'kyc_not_granted',
    });
  });

  it('reports frozen before kyc_not_granted', async () => {
    stubMirror({
      account: accountWithSlots(0),
      tokens: relationship({ freeze_status: 'FROZEN', kyc_status: 'REVOKED' }),
    });

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).resolves.toMatchObject({
      reason: 'frozen',
    });
  });

  it.each([
    ['account', { account: { status: 503 }, tokens: relationship() }],
    ['relationship', { account: accountWithSlots(0), tokens: { status: 500 } }],
  ])('throws when the mirror node fails the %s read', async (_label, answers) => {
    stubMirror(answers);

    await expect(hedera.checkDestination({ address: ACCOUNT, token: USDC })).rejects.toThrow(/HTTP 5\d\d/);
  });

  it('throws when a mirror-node read times out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );

    const check = hedera.checkDestination({ address: ACCOUNT, token: USDC });
    const settled = expect(check).rejects.toThrow(/timed out after 15000ms/);
    await vi.advanceTimersByTimeAsync(15_000);
    await settled;
  });

  it('throws on a token Hedera does not list, and on an invalid address', async () => {
    stubMirror({ account: accountWithSlots(0), tokens: relationship() });

    await expect(
      hedera.checkDestination({ address: ACCOUNT, token: '0x00000000000000000000000000000000000fffff' }),
    ).rejects.toThrow(/unknown Hedera token/);
    await expect(hedera.checkDestination({ address: '0.0.1234', token: USDC })).rejects.toThrow(/invalid Hedera EVM/);
  });

  it('uses the configured mirror node URL, without a trailing slash', async () => {
    const config = sodax.config.getChainConfig(ChainKeys.HEDERA_MAINNET);
    vi.spyOn(sodax.config, 'getChainConfig').mockReturnValue({ ...config, mirrorNodeUrl: 'https://mirror.example/' });
    stubMirror({ account: accountWithSlots(0), tokens: relationship() });

    await hedera.checkDestination({ address: ACCOUNT, token: USDC });

    expect(requested.every(url => url.startsWith('https://mirror.example/api/v1/accounts/'))).toBe(true);
  });

  it('falls back to the public mainnet mirror node when the config names none', async () => {
    const { mirrorNodeUrl: _omitted, ...config } = sodax.config.getChainConfig(ChainKeys.HEDERA_MAINNET);
    vi.spyOn(sodax.config, 'getChainConfig').mockReturnValue(config);
    stubMirror({ account: accountWithSlots(0), tokens: relationship() });

    await hedera.checkDestination({ address: ACCOUNT, token: USDC });

    expect(requested.every(url => url.startsWith(`${HEDERA_DEFAULT_MIRROR_NODE_URL}/api/v1/`))).toBe(true);
  });
});

describe('HederaSpokeService.requestAssociation', () => {
  const sendTransaction = vi.fn<IEvmWalletProvider['sendTransaction']>();
  const walletProvider = {
    chainType: 'EVM',
    getWalletAddress: async () => ACCOUNT,
    sendTransaction,
    waitForTransactionReceipt: vi.fn(),
    // requestAssociation calls only sendTransaction; the rest of IEvmWalletProvider is never touched.
  } as unknown as IEvmWalletProvider;

  const mined = () =>
    vi.spyOn(sodax.spoke.evm, 'waitForTransactionReceipt').mockResolvedValue({
      ok: true,
      value: { status: 'success', receipt: {} as never },
    });

  beforeEach(() => {
    sendTransaction.mockReset().mockResolvedValue(TX_HASH);
  });

  it('returns the unsigned associate() call to the token itself in raw mode, without a wallet', async () => {
    const fetchMock = stubMirror({ account: accountWithSlots(0), tokens: noRelationship });

    const result = await hedera.requestAssociation({ srcAddress: ACCOUNT, token: USDC, raw: true });

    expect(result).toEqual({ ok: true, value: { from: ACCOUNT, to: USDC, value: 0n, data: '0x0a754de6' } });
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['HBAR', HBAR],
    ['an unlisted token', '0x00000000000000000000000000000000000fffff'],
  ])('refuses %s, which needs no association', async (_label, token) => {
    const result = await hedera.requestAssociation({ srcAddress: ACCOUNT, token, raw: true });

    expect(result.ok).toBe(false);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it('sends one associate() call for that token on Hedera and resolves to its hash once mined and indexed', async () => {
    const receiptSpy = mined();
    stubMirror({ account: accountWithSlots(0), tokens: relationship() });

    const result = await hedera.requestAssociation({ srcAddress: ACCOUNT, token: USDC, walletProvider });

    expect(result).toEqual({ ok: true, value: TX_HASH });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(sendTransaction).toHaveBeenCalledWith(
      { from: ACCOUNT, to: USDC, value: 0n, data: '0x0a754de6' },
      { expectedChainId: 295 },
    );
    expect(receiptSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chainKey: ChainKeys.HEDERA_MAINNET, txHash: TX_HASH }),
    );
  });

  it('waits for the mirror node to show the association before resolving', async () => {
    vi.useFakeTimers();
    mined();
    let reads = 0;
    stubMirror({
      account: accountWithSlots(0),
      tokens: () => (++reads < 3 ? noRelationship : relationship()),
    });

    let done = false;
    const pending = hedera.requestAssociation({ srcAddress: ACCOUNT, token: USDC, walletProvider }).then(r => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toEqual({ ok: true, value: TX_HASH });
    expect(reads).toBe(3);
  });

  it('still resolves to the hash when the mirror node has not caught up in time', async () => {
    vi.useFakeTimers();
    mined();
    stubMirror({ account: accountWithSlots(0), tokens: noRelationship });

    const pending = hedera.requestAssociation({ srcAddress: ACCOUNT, token: USDC, walletProvider });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toEqual({ ok: true, value: TX_HASH });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting through a failed mirror-node read', async () => {
    vi.useFakeTimers();
    mined();
    let reads = 0;
    stubMirror({ account: accountWithSlots(0), tokens: () => (++reads === 1 ? { status: 503 } : relationship()) });

    const pending = hedera.requestAssociation({ srcAddress: ACCOUNT, token: USDC, walletProvider });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toEqual({ ok: true, value: TX_HASH });
  });

  it('fails plainly, not indeterminately, when the association reverts', async () => {
    vi.spyOn(sodax.spoke.evm, 'waitForTransactionReceipt').mockResolvedValue({
      ok: true,
      value: { status: 'failure', error: new Error('Transaction reverted') },
    });

    const result = await hedera.requestAssociation({ srcAddress: ACCOUNT, token: USDC, walletProvider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isIndeterminateOutcomeError(result.error)).toBe(false);
    expect(String(result.error)).toMatch(new RegExp(`association ${TX_HASH} failed`));
  });

  it('fails indeterminately, carrying the hash, when the receipt times out', async () => {
    vi.spyOn(sodax.spoke.evm, 'waitForTransactionReceipt').mockResolvedValue({
      ok: true,
      value: { status: 'timeout', error: new Error('timed out') },
    });

    const result = await hedera.requestAssociation({ srcAddress: ACCOUNT, token: USDC, walletProvider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isIndeterminateOutcomeError(result.error)).toBe(true);
    expect(result.error).toMatchObject({ txHash: TX_HASH });
  });

  it('fails indeterminately when the receipt read itself errors', async () => {
    vi.spyOn(sodax.spoke.evm, 'waitForTransactionReceipt').mockResolvedValue({ ok: false, error: new Error('rpc') });

    const result = await hedera.requestAssociation({ srcAddress: ACCOUNT, token: USDC, walletProvider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isIndeterminateOutcomeError(result.error)).toBe(true);
  });

  it('fails plainly when the wallet refuses to send', async () => {
    const receiptSpy = mined();
    sendTransaction.mockRejectedValue(new Error('User rejected the request'));

    const result = await hedera.requestAssociation({ srcAddress: ACCOUNT, token: USDC, walletProvider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isIndeterminateOutcomeError(result.error)).toBe(false);
    expect(receiptSpy).not.toHaveBeenCalled();
  });
});
