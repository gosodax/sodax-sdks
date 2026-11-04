/**
 * Tests for BitcoinSpokeService — the single Bitcoin spoke chain.
 *
 * Pattern: mirrors SuiSpokeService.test.ts (issue #109) collapsed to one chain. Unlike Sui's
 * SuiClient, Bitcoin's "RPC" is an Esplora-style HTTP API — the SUT calls `fetch(...)` directly,
 * so this file stubs `globalThis.fetch` per-test (with `vi.stubGlobal`) instead of spying on a
 * client method. The Bound Exchange trading-wallet flow is a second collaborator; `radfi.*` instance
 * methods are spied per-test.
 *
 * Real config data is used wherever possible — every address, RPC URL, polling interval, Bound Exchange
 * config field, and `walletMode` is sourced from `spokeChainConfig[BITCOIN_MAINNET]`. Only user
 * identities (`USER_ADDR`, `HUB_WALLET`), UTXOs, and txids are fabricated.
 *
 * Mocking strategy:
 *   - `globalThis.fetch` is stubbed per-test via `vi.stubGlobal` to intercept Esplora URLs.
 *     A URL-router dispatches to per-endpoint responses (UTXO, fee-estimate, tx, broadcast).
 *   - `sleep` (shared-utils.js) is module-mocked to a no-op so `waitForTransactionReceipt`
 *     polling tests finish instantly.
 *   - The `RadfiProvider` instance attached to `sodax.spoke.bitcoin.radfi` is spied per-test
 *     (`getTradingWallet`, `createWithdrawTransaction`, `requestRadfiSignature`).
 *   - `bitcoinjs-lib` is NOT mocked — real PSBT and script construction runs; only network
 *     interactions are stubbed at the `fetch` boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Hex,
  type IBitcoinWalletProvider,
  type XToken,
} from '@sodax/types';
import { keccak256, stringToBytes } from 'viem';
import { invariant } from '../../utils/tiny-invariant.js';

// --- hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sleep: vi.fn(),
}));

vi.mock('../../utils/shared-utils.js', async () => {
  const actual = await vi.importActual<object>('../../utils/shared-utils.js');
  return { ...actual, sleep: mocks.sleep };
});

import { Sodax } from '../../entities/Sodax.js';
import { BitcoinSpokeService } from './BitcoinSpokeService.js';
import type { SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const btcSpoke = sodax.spoke.bitcoin;

const BTC = ChainKeys.BITCOIN_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET;

const btcConfig = spokeChainConfig[BTC];
const BTC_ASSET_MGR = btcConfig.addresses.assetManager;
const BTC_RPC_URL = btcConfig.rpcUrl;
const BTC_POLLING_MS = btcConfig.pollingConfig.pollingIntervalMs;
const BTC_TIMEOUT_MS = btcConfig.pollingConfig.maxTimeoutMs;

// A real-ish Native SegWit (bc1q / P2WPKH) address used for tests. NOT the asset manager.
const USER_ADDR = 'bc1q5q3xczsl9zlt0gjys5khjknfp40zfdmkme9ene';
// A real-ish Taproot (bc1p / P2TR) address — exercises the BIP322 branch from a Schnorr-key type.
const TAPROOT_ADDR = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const HUB_WALLET = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const DST_ADDR = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const TRADING_ADDR = 'bc1ptradingwallettradingwallettradingwallet000000000000000';
const TX_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const mockBtcProvider = {
  chainType: 'BITCOIN',
  signTransaction: vi.fn(),
  signEcdsaMessage: vi.fn(),
  signBip322Message: vi.fn(),
  sendBitcoin: vi.fn(),
  getWalletAddress: vi.fn(),
  getPublicKey: vi.fn(),
} as unknown as IBitcoinWalletProvider;

// fetch-router: install via vi.stubGlobal in beforeEach so individual tests can override the
// handler. The default returns 404 (which is how the SUT treats "tx not yet seen").
type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const defaultHandler: FetchHandler = () => new Response(null, { status: 404 });
let activeHandler: FetchHandler;

const setFetch = (handler: FetchHandler) => {
  activeHandler = handler;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sleep.mockResolvedValue(undefined);
  activeHandler = defaultHandler;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => Promise.resolve(activeHandler(url, init))),
  );
  for (const k of Object.keys(mockBtcProvider) as (keyof IBitcoinWalletProvider)[]) {
    const v = mockBtcProvider[k];
    if (typeof v === 'function' && 'mockReset' in (v as object)) {
      (v as ReturnType<typeof vi.fn>).mockReset();
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Helper: build a JSON response.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const text = (body: string, status = 200) => new Response(body, { status });

// =========================================================================
// 1. constructor
// =========================================================================

describe('BitcoinSpokeService — constructor', () => {
  it('exposes the spoke instance on sodax.spoke.bitcoin with the expected method surface', () => {
    expect(btcSpoke).toBeInstanceOf(BitcoinSpokeService);
    expect(typeof btcSpoke.getBtcNetwork).toBe('function');
    expect(typeof btcSpoke.getBalance).toBe('function');
    expect(typeof btcSpoke.fetchUTXOs).toBe('function');
    expect(typeof btcSpoke.fetchRawTransaction).toBe('function');
    expect(typeof btcSpoke.getFeeRateEstimate).toBe('function');
    expect(typeof btcSpoke.estimateGas).toBe('function');
    expect(typeof btcSpoke.getDeposit).toBe('function');
    expect(typeof btcSpoke.getEffectiveWalletAddress).toBe('function');
    expect(typeof btcSpoke.getTradingWalletAddress).toBe('function');
    expect(typeof btcSpoke.fundTradingWallet).toBe('function');
    expect(typeof btcSpoke.deposit).toBe('function');
    expect(typeof btcSpoke.sendMessage).toBe('function');
    expect(typeof btcSpoke.encodeWithdrawalData).toBe('function');
    expect(typeof btcSpoke.waitForTransactionReceipt).toBe('function');
  });

  it('walletMode defaults to TRADING per chain config', () => {
    expect(btcSpoke.walletMode).toBe('TRADING');
  });

  it('exposes the per-chain rpcUrl and radfi provider', () => {
    expect(btcSpoke.rpcUrl).toBe(BTC_RPC_URL);
    expect(btcSpoke.radfi).toBeDefined();
  });
});

// =========================================================================
// 2. getBtcNetwork — mainnet → bitcoin.networks.bitcoin
// =========================================================================

describe('BitcoinSpokeService.getBtcNetwork', () => {
  it('returns mainnet network for BITCOIN_MAINNET', async () => {
    const bitcoin = await import('bitcoinjs-lib');
    expect(btcSpoke.getBtcNetwork(BTC)).toBe(bitcoin.networks.bitcoin);
  });
});

// =========================================================================
// 3. fetchUTXOs / fetchRawTransaction — URL composition + non-ok throw
// =========================================================================

describe('BitcoinSpokeService.fetchUTXOs', () => {
  it('fetches `${rpcUrl}/address/{addr}/utxo` and returns the JSON array', async () => {
    const utxos = [{ txid: 'aa', vout: 0, value: 1000, status: { confirmed: true } }];
    setFetch(url => {
      expect(url).toBe(`${BTC_RPC_URL}/address/${USER_ADDR}/utxo`);
      return json(utxos);
    });
    expect(await btcSpoke.fetchUTXOs(USER_ADDR)).toEqual(utxos);
  });

  it('throws when the response is not ok', async () => {
    setFetch(() => new Response(null, { status: 500, statusText: 'Server Error' }));
    await expect(btcSpoke.fetchUTXOs(USER_ADDR)).rejects.toThrow(/Failed to fetch UTXOs/);
  });
});

describe('BitcoinSpokeService.fetchRawTransaction', () => {
  it('fetches `${rpcUrl}/tx/{txid}/hex` and returns the raw text', async () => {
    setFetch(url => {
      expect(url).toBe(`${BTC_RPC_URL}/tx/${TX_HASH}/hex`);
      return text('deadbeef');
    });
    expect(await btcSpoke.fetchRawTransaction(TX_HASH)).toBe('deadbeef');
  });

  it('throws when the response is not ok', async () => {
    setFetch(() => new Response(null, { status: 404, statusText: 'Not Found' }));
    await expect(btcSpoke.fetchRawTransaction(TX_HASH)).rejects.toThrow(/Failed to fetch transaction/);
  });
});

// =========================================================================
// 4. getBalance — BTC summation + non-BTC throw
// =========================================================================

describe('BitcoinSpokeService.getBalance', () => {
  it("sums UTXO values for native BTC (empty token, '0x', or 'BTC')", async () => {
    setFetch(() =>
      json([
        { txid: 'a', vout: 0, value: 100, status: { confirmed: true } },
        { txid: 'b', vout: 1, value: 250, status: { confirmed: false } },
      ]),
    );
    expect(await btcSpoke.getBalance('BTC', USER_ADDR)).toBe(350n);
    expect(await btcSpoke.getBalance('', USER_ADDR)).toBe(350n);
    expect(await btcSpoke.getBalance('0x', USER_ADDR)).toBe(350n);
  });

  it('throws for non-BTC tokens (not implemented)', async () => {
    await expect(btcSpoke.getBalance('USDT', USER_ADDR)).rejects.toThrow(/not yet implemented/);
  });
});

// =========================================================================
// 4b. getWalletBalance / getWalletBalances — user wallet balance (native only)
// =========================================================================

describe('BitcoinSpokeService.getWalletBalance / getWalletBalances', () => {
  // Real config tokens, never synthesised: a fixture whose address exists in no token list would
  // classify itself as native and prove nothing about what production actually passes here.
  const BTC_TOKEN = btcConfig.supportedTokens.BTC as XToken;
  const BUSD_TOKEN = btcConfig.supportedTokens.BUSD as XToken;

  it("sums the user's UTXO values for native BTC", async () => {
    setFetch(() =>
      json([
        { txid: 'a', vout: 0, value: 100, status: { confirmed: true } },
        { txid: 'b', vout: 1, value: 250, status: { confirmed: false } },
      ]),
    );
    const result = await btcSpoke.getWalletBalance({
      srcChainKey: BTC,
      srcAddress: USER_ADDR,
      token: BTC_TOKEN,
    });
    expect(result).toBe(350n);
  });

  it('returns 0n for non-native tokens (Rune balances are not in the UTXO endpoint)', async () => {
    const result = await btcSpoke.getWalletBalance({
      srcChainKey: BTC,
      srcAddress: USER_ADDR,
      token: BUSD_TOKEN,
    });
    expect(result).toBe(0n);
  });

  it('getWalletBalances maps each token address to its balance', async () => {
    setFetch(() => json([{ txid: 'a', vout: 0, value: 500, status: { confirmed: true } }]));
    const result = await btcSpoke.getWalletBalances({
      srcChainKey: BTC,
      srcAddress: USER_ADDR,
      tokens: [BTC_TOKEN, BUSD_TOKEN],
    });
    expect(result).toEqual({
      [BTC_TOKEN.address]: 500n,
      [BUSD_TOKEN.address]: 0n,
    });
  });

  it('getWalletBalances isolates a failing read as a logged 0n instead of discarding the batch', async () => {
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn');
    setFetch(url =>
      // Only the native BTC read hits the network; the Rune token never reaches fetch, so this
      // fails exactly one token of the batch and leaves a successful read behind.
      url.endsWith('/utxo')
        ? (({ ok: false, statusText: 'Too Many Requests' }) as unknown as Response)
        : new Response(null, { status: 404 }),
    );

    const result = await btcSpoke.getWalletBalances({
      srcChainKey: BTC,
      srcAddress: USER_ADDR,
      tokens: [BTC_TOKEN, BUSD_TOKEN],
    });

    // A failed read reports 0n, which is indistinguishable from a real zero in the map — the log
    // is the only signal, so assert it fired or the failure could regress into a silent zero.
    expect(result[BTC_TOKEN.address]).toBe(0n);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({ chainKey: BTC, token: BTC_TOKEN.address }),
    );
    // ...while the structurally-zero Rune entry still resolves, unlogged.
    expect(result[BUSD_TOKEN.address]).toBe(0n);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('getWalletBalances rejects when every read in the batch failed', async () => {
    // An all-zero map from a dead RPC would read as "this wallet is empty on every asset", so the
    // one case the flat map cannot express safely must throw rather than resolve.
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn');
    setFetch(() => ({ ok: false, statusText: 'Too Many Requests' }) as unknown as Response);

    await expect(
      btcSpoke.getWalletBalances({
        srcChainKey: BTC,
        srcAddress: USER_ADDR,
        tokens: [BTC_TOKEN],
      }),
    ).rejects.toThrow(/every balance read failed on bitcoin/);

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// 5. getFeeRateEstimate — happy + fallback branches
// =========================================================================

describe('BitcoinSpokeService.getFeeRateEstimate', () => {
  it('returns the per-target fee from the API response', async () => {
    setFetch(() => json({ 1: 50, 6: 12, 144: 3 }));
    expect(await btcSpoke.getFeeRateEstimate(6)).toBe(12);
  });

  it('falls back to default (3) when target is missing from response', async () => {
    setFetch(() => json({ 1: 50 })); // no key 6
    expect(await btcSpoke.getFeeRateEstimate(6)).toBe(3);
  });

  it('falls back to default (3) when fetch is not ok', async () => {
    setFetch(() => new Response(null, { status: 500 }));
    expect(await btcSpoke.getFeeRateEstimate()).toBe(3);
  });

  it('falls back to default (3) when fetch throws', async () => {
    setFetch(() => {
      throw new Error('network down');
    });
    expect(await btcSpoke.getFeeRateEstimate()).toBe(3);
  });
});

// =========================================================================
// 6. estimateGas — vsize × fee rate
// =========================================================================

describe('BitcoinSpokeService.estimateGas', () => {
  it('returns vsize × fee rate as a bigint', async () => {
    setFetch(() => json({ 6: 5 }));
    const result = await btcSpoke.estimateGas({
      chainKey: BTC,
      tx: {
        from: USER_ADDR as Hex,
        to: BTC_ASSET_MGR as Hex,
        value: 0n,
        // 5 bytes ('aabbccddee' → 5 bytes) × fee rate 5 = 25n
        data: 'aabbccddee',
      },
    });
    expect(result).toBe(25n);
  });

  it('throws when tx is a string (raw mode not supported here)', async () => {
    await expect(btcSpoke.estimateGas({ chainKey: BTC, tx: 'whatever' })).rejects.toThrow(/string tx not supported/);
  });
});

// =========================================================================
// 7. getDeposit — sums UTXOs for the asset manager address
// =========================================================================

describe('BitcoinSpokeService.getDeposit', () => {
  it('sums UTXOs at the asset manager address', async () => {
    setFetch(url => {
      expect(url).toBe(`${BTC_RPC_URL}/address/${BTC_ASSET_MGR}/utxo`);
      return json([
        { txid: 'a', vout: 0, value: 1_000, status: { confirmed: true } },
        { txid: 'b', vout: 1, value: 500, status: { confirmed: true } },
      ]);
    });

    const result = await btcSpoke.getDeposit({
      srcChainKey: BTC,
      srcAddress: USER_ADDR,
      token: 'BTC',
    });
    expect(result).toBe(1_500n);
  });
});

// =========================================================================
// 8. getEffectiveWalletAddress / getTradingWalletAddress / fundTradingWallet
// =========================================================================

describe('BitcoinSpokeService.getEffectiveWalletAddress', () => {
  it('TRADING mode → returns the trading-wallet address from Bound Exchange', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);

    expect(await btcSpoke.getEffectiveWalletAddress(USER_ADDR)).toBe(TRADING_ADDR);
  });

  it('USER (non-TRADING) mode → returns the personal address unchanged', async () => {
    // Mutate walletMode for this test only; restore in finally.
    const original = btcSpoke.walletMode;
    Object.defineProperty(btcSpoke, 'walletMode', { value: 'USER', configurable: true });
    try {
      expect(await btcSpoke.getEffectiveWalletAddress(USER_ADDR)).toBe(USER_ADDR);
    } finally {
      Object.defineProperty(btcSpoke, 'walletMode', { value: original, configurable: true });
    }
  });
});

describe('BitcoinSpokeService.getTradingWalletAddress', () => {
  it('always returns the trading address from Bound Exchange', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);
    expect(await btcSpoke.getTradingWalletAddress(USER_ADDR)).toBe(TRADING_ADDR);
  });
});

describe('BitcoinSpokeService.getOnDemandRelayIdentity', () => {
  // The spoke result for an on-demand borrow/withdraw is the signed payload JSON. The relay submits it
  // under the literal "withdraw" tx_hash but tracks the packet under `od:` + keccak256 of the ASCII
  // payload_hex characters — polling must use that derived id, not "withdraw".
  it('submits under "withdraw" and derives the poll id from keccak256 of the payload_hex chars', () => {
    const payloadHex = '7b22737263';
    const tx = JSON.stringify({ payload_hex: payloadHex, signature: 'AUBsig' });

    const identity = btcSpoke.getOnDemandRelayIdentity(tx);

    expect(identity.srcTxHash).toBe('withdraw');
    expect(identity.data).toEqual({ payload_hex: payloadHex, signature: 'AUBsig' });
    expect(identity.pollTxHash).toBe(`od:${keccak256(stringToBytes(payloadHex)).slice(2)}`);
  });

  it('strips a leading 0x from payload_hex before hashing (bare-hex chars only)', () => {
    // Real payloads are bare hex (Buffer.toString('hex')), but if a payload_hex ever carries a 0x
    // prefix the poll id must hash the same bare-hex chars — otherwise polling never matches the
    // relay-tracked id. This pins the strip branch the production payloads don't exercise.
    const bareHex = '7b22737263';
    const tx = JSON.stringify({ payload_hex: `0x${bareHex}` });

    expect(btcSpoke.getOnDemandRelayIdentity(tx).pollTxHash).toBe(`od:${keccak256(stringToBytes(bareHex)).slice(2)}`);
  });
});

describe('BitcoinSpokeService.fundTradingWallet', () => {
  it('sends BTC to the trading-wallet address via walletProvider.sendBitcoin', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);
    (mockBtcProvider.sendBitcoin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await btcSpoke.fundTradingWallet(50_000n, USER_ADDR, mockBtcProvider);
    expect(result).toBe(TX_HASH);
    expect(mockBtcProvider.sendBitcoin).toHaveBeenCalledWith(TRADING_ADDR, 50_000n);
  });
});

// =========================================================================
// 9. encodeWithdrawalData / sendMessage — TRADING flow, signature branches
// =========================================================================

describe('BitcoinSpokeService.encodeWithdrawalData', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof BTC, Raw>>,
  ): SendMessageParams<typeof BTC, Raw> & { walletMode?: 'USER' | 'TRADING' } =>
    ({
      srcAddress: USER_ADDR,
      srcChainKey: BTC,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockBtcProvider,
      ...overrides,
    }) as SendMessageParams<typeof BTC, Raw> & { walletMode?: 'USER' | 'TRADING' };

  it('TRADING raw=true → substitutes srcAddress with trading address and returns JSON payload with no signature', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);

    const result = await btcSpoke.encodeWithdrawalData(sendMessageParams<true>({ raw: true }));

    expect(typeof result).toBe('string');
    const parsed = JSON.parse(result as unknown as string);
    expect(parsed).toHaveProperty('payload_hex');
    expect(typeof parsed.payload_hex).toBe('string');
    expect(parsed.signature).toBeUndefined();
    expect(parsed.public_key).toBeUndefined();
  });

  it('TRADING raw=false on P2WPKH/P2TR → signs via BIP322 (base64) and attaches the public key', async () => {
    // USER_ADDR is a bc1q (P2WPKH) address; Taproot (bc1p) takes the same branch. P2WPKH/P2TR sign
    // via BIP322 — wallets return base64, sent as-is — and the public key is sent alongside it
    // because BIP322 signatures are not public-key-recoverable.
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);
    (mockBtcProvider.signBip322Message as ReturnType<typeof vi.fn>).mockResolvedValueOnce('EjQ=');
    (mockBtcProvider.getPublicKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce('02abcdef');

    const result = await btcSpoke.encodeWithdrawalData(sendMessageParams<false>({ raw: false }));

    const parsed = JSON.parse(result as unknown as string);
    expect(parsed.signature).toBe('EjQ='); // browser wallets return base64 — passed through
    expect(parsed.public_key).toBe('02abcdef');
    expect(mockBtcProvider.signBip322Message).toHaveBeenCalledTimes(1);
    expect(mockBtcProvider.signEcdsaMessage).not.toHaveBeenCalled();
  });

  it('TRADING raw=false on P2TR (bc1p) → signs via BIP322 (Schnorr key) and attaches the public key', async () => {
    // Taproot keys are Schnorr/x-only — ECDSA cannot sign for them — so P2TR routes to BIP322 like
    // P2WPKH. Pins the bc1p → BIP322 routing explicitly (the case above uses a bc1q/P2WPKH address)
    // and checks the payload's address_type, which is what the relay reads to verify the signature.
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);
    (mockBtcProvider.signBip322Message as ReturnType<typeof vi.fn>).mockResolvedValueOnce('EjQ=');
    (mockBtcProvider.getPublicKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce('02abcdef');

    const result = await btcSpoke.encodeWithdrawalData(
      sendMessageParams<false>({ raw: false, srcAddress: TAPROOT_ADDR }),
    );

    const parsed = JSON.parse(result as unknown as string);
    expect(parsed.signature).toBe('EjQ=');
    expect(parsed.public_key).toBe('02abcdef');
    expect(mockBtcProvider.signBip322Message).toHaveBeenCalledTimes(1);
    expect(mockBtcProvider.signEcdsaMessage).not.toHaveBeenCalled();
    // address_type travels inside payload_hex — the relay reads it to pick the verification scheme.
    const payloadJson = JSON.parse(Buffer.from(parsed.payload_hex, 'hex').toString());
    expect(payloadJson.address_type).toBe('P2TR');
  });

  it('TRADING raw=false on legacy P2PKH/P2SH → signs via ECDSA and attaches the public key', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);
    // 1A1z… is a P2PKH (legacy) address → ECDSA. A hex signature (private-key wallet) is encoded to base64.
    (mockBtcProvider.signEcdsaMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce('deadbeef');
    (mockBtcProvider.getPublicKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce('02abcdef');

    const result = await btcSpoke.encodeWithdrawalData(
      sendMessageParams<false>({ raw: false, srcAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' }),
    );

    const parsed = JSON.parse(result as unknown as string);
    expect(parsed.signature).toBe('3q2+7w=='); // hex "deadbeef" → base64
    expect(parsed.public_key).toBe('02abcdef');
    expect(mockBtcProvider.signEcdsaMessage).toHaveBeenCalledTimes(1);
    expect(mockBtcProvider.signBip322Message).not.toHaveBeenCalled();
  });

  it('TRADING + getTradingWallet rejection → throws (no silent personal-address fallback)', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockRejectedValueOnce(new Error('radfi 503'));

    // In TRADING mode a failed trading-wallet lookup must surface, not silently fall back to the
    // personal address — that would emit a payload whose src_address disagrees with the
    // trading-derived hub wallet the relay actually targets.
    await expect(btcSpoke.encodeWithdrawalData(sendMessageParams<true>({ raw: true }))).rejects.toThrow('radfi 503');
  });

  it('TRADING raw=false without getPublicKey support → throws (the relay needs the pubkey to verify)', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);
    // BIP322 signatures are not public-key-recoverable, so a provider that cannot surface the public
    // key must fail loudly rather than emit a payload the relay can never verify.
    const providerWithoutPublicKey = {
      ...mockBtcProvider,
      getPublicKey: undefined,
    } as unknown as IBitcoinWalletProvider;

    await expect(
      btcSpoke.encodeWithdrawalData(sendMessageParams<false>({ raw: false, walletProvider: providerWithoutPublicKey })),
    ).rejects.toThrow('Wallet provider does not support getPublicKey');
  });

  it('sendMessage delegates to encodeWithdrawalData', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);

    const result = await btcSpoke.sendMessage(sendMessageParams<true>({ raw: true }));
    expect(typeof result).toBe('string');
    expect(() => JSON.parse(result as unknown as string)).not.toThrow();
  });

  it('pins getIntentRelayChainId(SONIC) === 146n', () => {
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
  });
});

// =========================================================================
// 10. deposit — TRADING happy path, raw, unsupported token, USER+raw blocked
// =========================================================================

describe('BitcoinSpokeService.signAndSubmitRawTransaction', () => {
  // Client-side completion of the TRADING deposit: sign the Bound-built PSBT then have Bound
  // co-sign + broadcast. Mirrors the second half of deposit(raw:false).
  const RAW_TX = { from: USER_ADDR, to: BTC_ASSET_MGR, value: 50_000n, data: 'cHNidA==' };
  const RELAY = { address: HUB_WALLET, payload: '0x' as Hex };

  it('signs the PSBT (finalize=false) then submits to Bound, returning the broadcast txid', async () => {
    (mockBtcProvider.signTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce('signedhex');
    const sigSpy = vi.spyOn(btcSpoke.radfi, 'requestRadfiSignature').mockResolvedValueOnce(TX_HASH as never);

    const result = await btcSpoke.signAndSubmitRawTransaction({
      rawTx: RAW_TX,
      walletProvider: mockBtcProvider,
      relayData: RELAY,
      accessToken: 'user-token',
    });

    expect(result).toBe(TX_HASH);
    expect(mockBtcProvider.signTransaction).toHaveBeenCalledWith('cHNidA==', false);
    expect(sigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userAddress: USER_ADDR, relayData: RELAY }),
      'user-token',
    );
  });

  it('defaults the access token to the radfi session token when none is supplied', async () => {
    (mockBtcProvider.signTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce('signedhex');
    const sigSpy = vi.spyOn(btcSpoke.radfi, 'requestRadfiSignature').mockResolvedValueOnce(TX_HASH as never);

    await btcSpoke.signAndSubmitRawTransaction({ rawTx: RAW_TX, walletProvider: mockBtcProvider });

    expect(sigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userAddress: USER_ADDR }),
      btcSpoke.radfi.accessToken,
    );
  });

  it('throws when not in TRADING wallet mode', async () => {
    const original = btcSpoke.walletMode;
    Object.defineProperty(btcSpoke, 'walletMode', { value: 'USER', configurable: true });
    try {
      await expect(
        btcSpoke.signAndSubmitRawTransaction({ rawTx: RAW_TX, walletProvider: mockBtcProvider }),
      ).rejects.toThrow(/requires TRADING wallet mode/);
    } finally {
      Object.defineProperty(btcSpoke, 'walletMode', { value: original, configurable: true });
    }
  });

  it('throws a clear error when the raw tx is missing data/from (Bitcoin is not schema-validated)', async () => {
    const sigSpy = vi.spyOn(btcSpoke.radfi, 'requestRadfiSignature');

    await expect(
      btcSpoke.signAndSubmitRawTransaction({
        rawTx: { from: USER_ADDR, to: BTC_ASSET_MGR, value: 50_000n, data: '' },
        walletProvider: mockBtcProvider,
      }),
    ).rejects.toThrow(/rawTx\.data \(PSBT\) and rawTx\.from are required/);

    expect(mockBtcProvider.signTransaction).not.toHaveBeenCalled();
    expect(sigSpy).not.toHaveBeenCalled();
  });
});

describe('BitcoinSpokeService.deposit', () => {
  // The TRADING flow needs both createWithdrawTransaction (returns a base64 PSBT) and the
  // optional requestRadfiSignature (returns the broadcast txid). For raw=true we skip both
  // requestRadfiSignature and walletProvider.signTransaction.

  it('TRADING raw=true → returns rawTx with the base64 PSBT (no signing)', async () => {
    vi.spyOn(btcSpoke.radfi, 'createWithdrawTransaction').mockResolvedValueOnce({
      base64Psbt: 'cHNidA==',
    } as never);

    // The SUT identifies tokens by `address`, not symbol. BTC's address is '0:0'.
    const BTC_TOKEN = btcConfig.supportedTokens.BTC.address;
    const result = await btcSpoke.deposit<true>({
      srcChainKey: BTC,
      srcAddress: USER_ADDR,
      to: HUB_WALLET,
      token: BTC_TOKEN,
      amount: 50_000n,
      data: '0x' as Hex,
      raw: true,
    });

    expect(result).toMatchObject({
      from: USER_ADDR,
      to: BTC_ASSET_MGR,
      value: 50_000n,
      data: 'cHNidA==',
    });
  });

  it('TRADING raw=false → sign + radfi signature + returns the final txid', async () => {
    vi.spyOn(btcSpoke.radfi, 'createWithdrawTransaction').mockResolvedValueOnce({
      base64Psbt: 'cHNidA==',
    } as never);
    (mockBtcProvider.signTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce('signedhex');
    const sigSpy = vi.spyOn(btcSpoke.radfi, 'requestRadfiSignature').mockResolvedValueOnce(TX_HASH as never);

    const BTC_TOKEN = btcConfig.supportedTokens.BTC.address;
    const result = await btcSpoke.deposit({
      srcChainKey: BTC,
      srcAddress: USER_ADDR,
      to: HUB_WALLET,
      token: BTC_TOKEN,
      amount: 50_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockBtcProvider,
    });

    expect(result).toBe(TX_HASH);
    expect(mockBtcProvider.signTransaction).toHaveBeenCalledWith('cHNidA==', false);
    // relayData ({ hub wallet address, full payload }) is forwarded so Bound Exchange can
    // auto-resubmit a stuck relay: address === deposit `to`, payload === deposit `data`.
    expect(sigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ relayData: { address: HUB_WALLET, payload: '0x' } }),
      expect.anything(),
    );
  });

  it('TRADING with unsupported token → throws "Unsupported token: …"', async () => {
    await expect(
      btcSpoke.deposit<true>({
        srcChainKey: BTC,
        srcAddress: USER_ADDR,
        to: HUB_WALLET,
        token: 'NOT_A_TOKEN',
        amount: 50_000n,
        data: '0x' as Hex,
        raw: true,
      }),
    ).rejects.toThrow(/Unsupported token/);
  });

  it('USER (non-TRADING) raw=true → throws "Raw mode is not supported…"', async () => {
    const original = btcSpoke.walletMode;
    Object.defineProperty(btcSpoke, 'walletMode', { value: 'USER', configurable: true });
    try {
      await expect(
        btcSpoke.deposit<true>({
          srcChainKey: BTC,
          srcAddress: USER_ADDR,
          to: HUB_WALLET,
          token: 'BTC',
          amount: 50_000n,
          data: '0x' as Hex,
          raw: true,
        }),
      ).rejects.toThrow(/Raw mode is not supported/);
    } finally {
      Object.defineProperty(btcSpoke, 'walletMode', { value: original, configurable: true });
    }
  });

  it('USER + no UTXOs → throws "No UTXOs available for deposit"', async () => {
    const original = btcSpoke.walletMode;
    Object.defineProperty(btcSpoke, 'walletMode', { value: 'USER', configurable: true });
    setFetch(() => json([])); // empty UTXOs at user address
    try {
      await expect(
        btcSpoke.deposit({
          srcChainKey: BTC,
          srcAddress: USER_ADDR,
          to: HUB_WALLET,
          token: 'BTC',
          amount: 50_000n,
          data: '0x' as Hex,
          raw: false,
          walletProvider: mockBtcProvider,
        }),
      ).rejects.toThrow(/No UTXOs available/);
    } finally {
      Object.defineProperty(btcSpoke, 'walletMode', { value: original, configurable: true });
    }
  });

  it('USER + all UTXOs mempool-spent → throws "No UTXOs available for deposit"', async () => {
    // fetchMempoolSpentOutpoints returns both UTXOs as spent — the filter leaves nothing.
    const original = btcSpoke.walletMode;
    Object.defineProperty(btcSpoke, 'walletMode', { value: 'USER', configurable: true });
    setFetch(url => {
      if (url.endsWith('/utxo')) {
        return json([
          { txid: 'aa', vout: 0, value: 30_000, status: { confirmed: true } },
          { txid: 'bb', vout: 1, value: 30_000, status: { confirmed: true } },
        ]);
      }
      if (url.endsWith('/txs/mempool')) {
        // Both UTXOs already spent in mempool
        return json([
          {
            vin: [
              { txid: 'aa', vout: 0 },
              { txid: 'bb', vout: 1 },
            ],
          },
        ]);
      }
      return new Response(null, { status: 404 });
    });
    try {
      await expect(
        btcSpoke.deposit({
          srcChainKey: BTC,
          srcAddress: USER_ADDR,
          to: HUB_WALLET,
          token: 'BTC',
          amount: 50_000n,
          data: '0x' as Hex,
          raw: false,
          walletProvider: mockBtcProvider,
        }),
      ).rejects.toThrow(/No UTXOs available/);
    } finally {
      Object.defineProperty(btcSpoke, 'walletMode', { value: original, configurable: true });
    }
  });

  it('USER + one UTXO mempool-spent → buildDepositPsbt receives only the unspent UTXO', async () => {
    // fetchMempoolSpentOutpoints marks 'aa:0' as spent; 'bb:1' is clean.
    // buildDepositPsbt is stubbed to prevent real PSBT construction.
    const original = btcSpoke.walletMode;
    Object.defineProperty(btcSpoke, 'walletMode', { value: 'USER', configurable: true });
    setFetch(url => {
      if (url.endsWith('/utxo')) {
        return json([
          { txid: 'aa', vout: 0, value: 30_000, status: { confirmed: true } },
          { txid: 'bb', vout: 1, value: 30_000, status: { confirmed: true } },
        ]);
      }
      if (url.endsWith('/txs/mempool')) {
        return json([{ vin: [{ txid: 'aa', vout: 0 }] }]); // only 'aa:0' is spent
      }
      return new Response(null, { status: 404 });
    });
    const BTC_TOKEN = btcConfig.supportedTokens.BTC.address;
    const buildSpy = vi.spyOn(btcSpoke, 'buildDepositPsbt').mockResolvedValueOnce({ data: 'fakePsbt' } as never);
    vi.spyOn(btcSpoke, 'signAndBroadcastTransaction').mockResolvedValueOnce(TX_HASH);
    try {
      await btcSpoke.deposit({
        srcChainKey: BTC,
        srcAddress: USER_ADDR,
        to: HUB_WALLET,
        token: BTC_TOKEN,
        amount: 20_000n,
        data: '0x' as Hex,
        raw: false,
        walletProvider: mockBtcProvider,
      });
      // buildDepositPsbt receives only the UTXOs that survived the filter
      const receivedUtxos = buildSpy.mock.calls[0]?.[6];
      invariant(receivedUtxos, 'buildDepositPsbt was not called');
      expect(receivedUtxos).toHaveLength(1);
      expect(receivedUtxos[0]).toMatchObject({ txid: 'bb', vout: 1 });
    } finally {
      Object.defineProperty(btcSpoke, 'walletMode', { value: original, configurable: true });
    }
  });

  it('USER + mempool endpoint non-ok → all UTXOs pass through (mempool check is non-blocking)', async () => {
    // fetchMempoolSpentOutpoints returns empty Set when the endpoint is unavailable —
    // the deposit must not be blocked by a mempool API outage.
    const original = btcSpoke.walletMode;
    Object.defineProperty(btcSpoke, 'walletMode', { value: 'USER', configurable: true });
    setFetch(url => {
      if (url.endsWith('/utxo')) {
        return json([{ txid: 'cc', vout: 0, value: 80_000, status: { confirmed: true } }]);
      }
      if (url.endsWith('/txs/mempool')) {
        return new Response(null, { status: 503 }); // mempool endpoint down
      }
      return new Response(null, { status: 404 });
    });
    const BTC_TOKEN = btcConfig.supportedTokens.BTC.address;
    const buildSpy = vi.spyOn(btcSpoke, 'buildDepositPsbt').mockResolvedValueOnce({ data: 'fakePsbt' } as never);
    vi.spyOn(btcSpoke, 'signAndBroadcastTransaction').mockResolvedValueOnce(TX_HASH);
    try {
      await btcSpoke.deposit({
        srcChainKey: BTC,
        srcAddress: USER_ADDR,
        to: HUB_WALLET,
        token: BTC_TOKEN,
        amount: 20_000n,
        data: '0x' as Hex,
        raw: false,
        walletProvider: mockBtcProvider,
      });
      // All UTXOs (including the one that could have been filtered) are forwarded
      const receivedUtxos = buildSpy.mock.calls[0]?.[6];
      invariant(receivedUtxos, 'buildDepositPsbt was not called');
      expect(receivedUtxos).toHaveLength(1);
      expect(receivedUtxos[0]).toMatchObject({ txid: 'cc', vout: 0 });
    } finally {
      Object.defineProperty(btcSpoke, 'walletMode', { value: original, configurable: true });
    }
  });
});

// =========================================================================
// 11. waitForTransactionReceipt — confirmed / unconfirmed / 404 / transient
// =========================================================================

describe('BitcoinSpokeService.waitForTransactionReceipt', () => {
  it('confirmed tx → status:success with the JSON receipt', async () => {
    const receipt = { txid: TX_HASH, status: { confirmed: true, block_height: 800_000 } };
    setFetch(() => json(receipt));

    const result = await btcSpoke.waitForTransactionReceipt({ chainKey: BTC, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt).toEqual(receipt);
  });

  it('unconfirmed until deadline → status:timeout', async () => {
    setFetch(() => json({ txid: TX_HASH, status: { confirmed: false } }));

    const result = await btcSpoke.waitForTransactionReceipt({
      chainKey: BTC,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
  });

  it('persistent 404 until deadline → status:timeout', async () => {
    setFetch(() => new Response(null, { status: 404 }));

    const result = await btcSpoke.waitForTransactionReceipt({
      chainKey: BTC,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error.message).toContain(TX_HASH);
  });

  it('transient throw → recovers on next poll', async () => {
    let calls = 0;
    setFetch(() => {
      calls++;
      if (calls === 1) throw new Error('connection refused');
      return json({ txid: TX_HASH, status: { confirmed: true } });
    });

    const result = await btcSpoke.waitForTransactionReceipt({
      chainKey: BTC,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1000,
    });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(mocks.sleep).toHaveBeenCalled();
  });

  it('config-driven defaults: pollingConfig pins polling=60_000ms / timeout=3_600_000ms', () => {
    expect(BTC_POLLING_MS).toBe(60_000);
    expect(BTC_TIMEOUT_MS).toBe(3_600_000);
  });

  it('forwards caller-supplied pollingIntervalMs to sleep on each poll', async () => {
    setFetch(() => new Response(null, { status: 404 }));

    await btcSpoke.waitForTransactionReceipt({
      chainKey: BTC,
      txHash: TX_HASH,
      pollingIntervalMs: 7,
      maxTimeoutMs: 1,
    });

    expect(mocks.sleep).toHaveBeenCalledWith(7);
  });
});
