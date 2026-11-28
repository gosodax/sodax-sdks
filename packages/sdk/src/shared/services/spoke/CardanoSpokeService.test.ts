import { blake2b } from '@noble/hashes/blake2b';
import { ChainKeys, IndeterminateOutcomeError } from '@sodax/types';
import { Keypair } from '@stellar/stellar-sdk';
import { bytesToHex, concat, hexToBytes, keccak256, toHex, type Hex } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sodax } from '../../entities/Sodax.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import { CARDANO_ADDRESSES, CARDANO_CIP8 } from './cardano-test-vectors.js';
import { HUB_WALLET, depositParamsFor } from './spoke-test-fixtures.js';
import { cardanoDepositAuxiliaryData } from './cardano-tx.js';
import { cardanoAddressFromRecipientBytes } from './cardano-utils.js';

const sodax = new Sodax();
const cardano = sodax.spoke.cardano;

const CARDANO = ChainKeys.CARDANO_MAINNET;
const NATIVE_ADA = '0x0000000000000000000000000000000000000000';
const RESERVE = sodax.config.getChainConfig(CARDANO).addresses.reserve;
const depositSigner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const OWNER = cardanoAddressFromRecipientBytes(
  `0x61${bytesToHex(blake2b(depositSigner.rawPublicKey(), { dkLen: 28 })).slice(2)}`,
);
const AMOUNT = 5_000_000n;
const MEMO = MpcRelayApiService.computePayloadHash(HUB_WALLET, '0x');
const AUX_LENGTH = cardanoDepositAuxiliaryData(MEMO).length;

type KoiosState = {
  utxos: Record<string, unknown>[];
  balance: unknown[];
  status: unknown[];
  /** A path to answer with HTTP 500. */
  failOn?: string;
};
let koios: KoiosState;
let calls: { path: string; body: unknown }[];

const utxoRow = (n: number, value: bigint, assets: unknown = null) => ({
  tx_hash: n.toString(16).padStart(64, 'b'),
  tx_index: n,
  value: value.toString(),
  address: OWNER,
  asset_list: assets,
  reference_script: null,
  is_spent: false,
});

function stubKoios(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.slice(url.indexOf('/api/v1') + '/api/v1'.length);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      const answer = (json: unknown) => new Response(JSON.stringify(json));
      if (koios.failOn && path.startsWith(koios.failOn)) return new Response('boom', { status: 500 });
      if (path.startsWith('/address_utxos')) return answer(path.includes('offset=0') ? koios.utxos : []);
      if (path.startsWith('/tip')) return answer([{ abs_slot: 100_000_000, block_height: 1, block_time: 1 }]);
      if (path.startsWith('/cli_protocol_params')) {
        return answer({ txFeePerByte: 44, txFeeFixed: 155381, utxoCostPerByte: 4310, maxTxSize: 16384 });
      }
      if (path.startsWith('/address_info')) return answer(koios.balance);
      if (path.startsWith('/tx_status')) return answer(koios.status);
      return new Response('unexpected', { status: 404 });
    }),
  );
}

const ownerWitness = (hash: string) =>
  `825820${depositSigner.rawPublicKey().toString('hex')}5840${depositSigner.sign(Buffer.from(hash, 'hex')).toString('hex')}`;
const oneWitness = (hash: string) => `a100d9010281${ownerWitness(hash)}`;
const otherWitness = `825820${'33'.repeat(32)}5840${'44'.repeat(64)}`;
const twoWitnesses = (hash: string) => `a10082${ownerWitness(hash)}${otherWitness}`;

/** The tx hash of an unsigned `[body, {}, true, aux]` transaction, as the wallet computes it. */
function hashOfUnsigned(unsignedHex: string): string {
  const unsigned = hexToBytes(`0x${unsignedHex}`);
  // `84` ‖ body ‖ `a0` ‖ `f5` ‖ aux.
  const body = unsigned.slice(1, unsigned.length - AUX_LENGTH - 2);
  return bytesToHex(blake2b(body, { dkLen: 32 })).slice(2);
}

let signedByWallet: string | undefined;
const walletFor = (witness: string | ((hash: string) => string) = oneWitness, submitted?: string) => {
  let unsignedHash = '';
  return {
    chainType: 'CARDANO',
    getWalletAddress: vi.fn(async () => OWNER),
    signTransaction: vi.fn(async (unsigned: string) => {
      unsignedHash = hashOfUnsigned(unsigned);
      return typeof witness === 'function' ? witness(unsignedHash) : witness;
    }),
    submitTransaction: vi.fn(async (signed: string) => {
      signedByWallet = signed;
      return submitted ?? unsignedHash;
    }),
    signData: vi.fn(),
  };
};

const adaDepositParams = depositParamsFor({
  srcChainKey: CARDANO,
  srcAddress: OWNER,
  amount: AMOUNT,
  walletProvider: undefined,
});
const depositParams = (wallet: ReturnType<typeof walletFor>, extra: object = {}) =>
  adaDepositParams(NATIVE_ADA, { walletProvider: wallet, ...extra });

const registration = (overrides: object = {}) => ({
  ok: true as const,
  value: {
    depositMethod: 'memo' as const,
    reserveAddress: RESERVE,
    memo: MEMO,
    payloadHash: MEMO,
    path: 'm',
    hubWallet: HUB_WALLET,
    ...overrides,
  },
});

beforeEach(() => {
  calls = [];
  signedByWallet = undefined;
  koios = { utxos: [utxoRow(0, 20_000_000n)], balance: [], status: [] };
  stubKoios();
  vi.spyOn(MpcRelayApiService, 'getDepositAddress').mockResolvedValue(registration() as never);
  vi.spyOn(MpcRelayApiService, 'notify').mockResolvedValue({ ok: true, value: { accepted: true } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('CardanoSpokeService.deposit', () => {
  it('builds the payment, has the wallet sign and submit it, notifies the relay and returns the tx hash', async () => {
    const wallet = walletFor();

    const txHash = await cardano.deposit(depositParams(wallet));

    expect(txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(MpcRelayApiService.getDepositAddress).toHaveBeenCalledWith(expect.anything(), OWNER, '1815', '0x');
    expect(wallet.signTransaction).toHaveBeenCalledOnce();
    expect(wallet.submitTransaction).toHaveBeenCalledOnce();
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '1815', txHash);
    // The wallet is handed hex CBOR with no 0x, as CIP-30 takes it, and submits the transaction it signed.
    expect(wallet.signTransaction.mock.calls[0]?.[0]).toMatch(/^84a5/);
    expect(signedByWallet).toMatch(/^84a5/);
  });

  it('returns the transfer descriptor in raw mode without reading the chain or touching the wallet', async () => {
    const wallet = walletFor();

    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValue(
      registration({ memo: `0x${MEMO.slice(2).toUpperCase()}` }),
    );
    const tx = await cardano.deposit(depositParams(wallet, { raw: true }));

    expect(tx).toEqual({
      from: OWNER,
      to: RESERVE,
      value: AMOUNT,
      data: MEMO.slice(2).toLowerCase(),
      token: NATIVE_ADA,
    });
    expect(calls).toEqual([]);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it('spends only the pure-ADA UTXO, never the larger one that carries a native token', async () => {
    koios.utxos = [
      utxoRow(0, 90_000_000n, [{ policy_id: 'aa', asset_name: 'bb', quantity: '1' }]),
      utxoRow(1, 20_000_000n),
    ];
    const wallet = walletFor();

    await cardano.deposit(depositParams(wallet));

    const unsigned = wallet.signTransaction.mock.calls[0]?.[0] ?? '';
    expect(unsigned).toContain(`5820${(1).toString(16).padStart(64, 'b')}01`);
    expect(unsigned).not.toContain((0).toString(16).padStart(64, 'b'));
  });

  it('refuses when the account has no pure-ADA funds for the payment, the fee and a change output', async () => {
    koios.utxos = [utxoRow(0, 1_000_000n)];

    await expect(cardano.deposit(depositParams(walletFor()))).rejects.toThrow(
      new RegExp(`${OWNER}.*insufficient pure-ADA funds`),
    );
  });

  it('refuses a token, a non-positive or over-400-ADA amount and a bad source before registering or signing', async () => {
    const wallet = walletFor();
    const cases: [object, RegExp][] = [
      [{ token: '0x1234567890123456789012345678901234567890' }, /native ADA only/],
      [{ amount: 0n }, /must be positive/],
      [{ amount: 400_000_001n }, /400 ADA/],
      [{ srcAddress: CARDANO_ADDRESSES.enterpriseTestnet.bech32 }, /not mainnet/],
      [{ srcAddress: 'not-an-address' }, /invalid Cardano bech32/],
    ];

    for (const [extra, message] of cases) {
      await expect(cardano.deposit(depositParams(wallet, extra))).rejects.toThrow(message);
    }
    expect(MpcRelayApiService.getDepositAddress).not.toHaveBeenCalled();
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it('refuses a registration it cannot trust, signing nothing', async () => {
    const cases: [object, RegExp][] = [
      // A reserve other than the configured one, however well-formed.
      [{ reserveAddress: CARDANO_ADDRESSES.enterpriseMainnet.bech32 }, /is not the configured reserve/],
      [{ memo: `0x${'ab'.repeat(32)}` }, /does not commit to this deposit's payload/],
      [{ hubWallet: '0x2222222222222222222222222222222222222222' }, /derives hub wallet/],
      [{ depositMethod: 'address', depositAddress: RESERVE }, /expected memo/],
      [{ cardanoMetadata: { '674': { msg: ['00'.repeat(32)] } } }, /does not match the metadata/],
    ];
    const wallet = walletFor();

    for (const [override, message] of cases) {
      vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValue(registration(override) as never);
      await expect(cardano.deposit(depositParams(wallet))).rejects.toThrow(message);
    }
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it('refuses to broadcast an unsized extra witness, another payment key, or a signature over another tx', async () => {
    const cases: [string | ((hash: string) => string), RegExp][] = [
      [twoWitnesses, /larger witness set than one key/],
      [`a10081${otherWitness}`, /owner's payment key/],
      [() => oneWitness('00'.repeat(32)), /invalid signature/],
    ];

    for (const [witness, message] of cases) {
      const wallet = walletFor(witness);
      await expect(cardano.deposit(depositParams(wallet))).rejects.toThrow(message);
      expect(wallet.submitTransaction).not.toHaveBeenCalled();
    }
  });

  it('re-encodes a valid indefinite or tagged witness set in the sized encoding before submitting', async () => {
    for (const witnessSet of [
      (hash: string) => `a100819f${ownerWitness(hash).slice(2)}ff`,
      (hash: string) => `bf00d901029f${ownerWitness(hash)}ffff`,
    ]) {
      const wallet = walletFor(witnessSet);

      const txHash = await cardano.deposit(depositParams(wallet));

      expect(signedByWallet).toContain(oneWitness(String(txHash)));
      expect(wallet.submitTransaction).toHaveBeenCalledOnce();
    }
  });

  it('turns a lost wallet submission into an indeterminate outcome carrying the SDK hash, and notifies it', async () => {
    const failures: [string, Error][] = [
      ['DOMException', new DOMException('connection lost', 'NetworkError')],
      ['read-only Error', Object.defineProperty(new Error('connection lost'), 'message', { writable: false })],
    ];
    for (const [label, failure] of failures) {
      vi.mocked(MpcRelayApiService.notify).mockClear();
      const wallet = walletFor();
      const originalMessage = Object.getOwnPropertyDescriptor(failure, 'message');
      wallet.submitTransaction.mockRejectedValueOnce(failure);

      const error = await cardano.deposit(depositParams(wallet)).catch((error: unknown) => error);
      const txHash = hashOfUnsigned(wallet.signTransaction.mock.calls[0]?.[0] ?? '');

      expect(error, label).toBeInstanceOf(IndeterminateOutcomeError);
      expect(error, label).not.toBe(failure);
      // The wallet's own error is left as it was thrown.
      expect(failure, label).not.toHaveProperty('txHash');
      expect(Object.getOwnPropertyDescriptor(failure, 'message'), label).toEqual(originalMessage);
      expect(error, label).toMatchObject({
        cause: failure,
        txHash,
        message: expect.stringMatching(/settle .* do not send again/i),
      });
      expect(MpcRelayApiService.notify, label).toHaveBeenCalledWith(expect.anything(), '1815', txHash);
    }

    // When the notify fails too, the error still carries the hash and the failed notify is logged.
    vi.useFakeTimers();
    const relayError = new Error('relay 503');
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: relayError });
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    const failure = new Error('connection lost');
    const wallet = walletFor();
    wallet.submitTransaction.mockRejectedValueOnce(failure);

    const pending = cardano.deposit(depositParams(wallet)).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    const txHash = hashOfUnsigned(wallet.signTransaction.mock.calls[0]?.[0] ?? '');

    expect(error).toBeInstanceOf(IndeterminateOutcomeError);
    expect(error).toMatchObject({ cause: failure, txHash });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/relay notify failed after a wallet submit error/), {
      txHash,
      error: expect.anything(),
    });
  });

  it('passes a CIP-30 refusal through un-notified, but notifies both hashes when the wallet reports another', async () => {
    const refusing = walletFor();
    const refusal = { code: 1, info: 'wallet refuses to send' };
    refusing.submitTransaction.mockRejectedValueOnce(refusal);

    await expect(cardano.deposit(depositParams(refusing))).rejects.toBe(refusal);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();

    const submitted = 'cd'.repeat(32);
    const wallet = walletFor(oneWitness, submitted);
    const error = await cardano.deposit(depositParams(wallet)).catch((error: unknown) => error);
    const txHash = hashOfUnsigned(wallet.signTransaction.mock.calls[0]?.[0] ?? '');

    expect(error).toMatchObject({
      message: expect.stringMatching(/settle .* do not send again/i),
      txHash,
      walletTxHash: submitted,
    });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '1815', txHash);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '1815', submitted);
  });

  it('signs and submits a deposit of exactly 400 ADA', async () => {
    koios.utxos = [utxoRow(0, 410_000_000n)];
    const wallet = walletFor();

    await expect(cardano.deposit(depositParams(wallet, { amount: 400_000_000n }))).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(wallet.signTransaction).toHaveBeenCalledOnce();
    expect(wallet.submitTransaction).toHaveBeenCalledOnce();
  });

  it('still resolves to the tx hash when the relay cannot be notified, leaving the re-notify to settlement', async () => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const pending = cardano.deposit(depositParams(walletFor()));
    await vi.runAllTimersAsync();

    // The funds are already on the network: the hash is what settlement waits on and re-notifies.
    expect(await pending).toMatch(/^[0-9a-f]{64}$/);
    expect(vi.mocked(MpcRelayApiService.notify).mock.calls.length).toBeGreaterThan(1);
  });

  it('fails the deposit, signing nothing, when Koios cannot be read or returns a foreign UTXO', async () => {
    const wallet = walletFor();
    koios.failOn = '/cli_protocol_params';
    await expect(cardano.deposit(depositParams(wallet))).rejects.toThrow(/koios \/cli_protocol_params: HTTP 500/);

    koios.failOn = undefined;
    koios.utxos = [{ ...utxoRow(0, 20_000_000n), address: CARDANO_ADDRESSES.enterpriseMainnet.bech32 }];
    await expect(cardano.deposit(depositParams(wallet))).rejects.toThrow(/belongs to a different address/);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });
});

describe('CardanoSpokeService reads', () => {
  const balanceParams = { srcChainKey: CARDANO, srcAddress: OWNER, token: NATIVE_ADA } as never;

  it('reads the account balance in lovelace, and zero for an address Koios has never seen', async () => {
    koios.balance = [{ address: OWNER, balance: '42000000' }];
    expect(await cardano.getDeposit(balanceParams)).toBe(42_000_000n);

    koios.balance = [];
    expect(await cardano.getDeposit(balanceParams)).toBe(0n);
  });

  it('prices a typical one-input deposit at the current parameters', async () => {
    const { fee } = await cardano.estimateGas({} as never);

    // 44 lovelace/byte over roughly 330 bytes, plus the 155,381 base fee.
    expect(fee).toBeGreaterThan(165_000n);
    expect(fee).toBeLessThan(180_000n);
  });

  it('waits for a transaction to be in a block, then reports its depth', async () => {
    vi.useFakeTimers();
    const hash = 'ab'.repeat(32);
    koios.status = [{ tx_hash: hash, num_confirmations: null }];
    const pending = cardano.waitForTransactionReceipt({
      srcChainKey: CARDANO,
      txHash: `0x${hash.toUpperCase()}`,
      pollingIntervalMs: 1_000,
      maxTimeoutMs: 10_000,
    } as never);

    await vi.advanceTimersByTimeAsync(2_000);
    koios.status = [{ tx_hash: hash, num_confirmations: 3 }];
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await pending).toEqual({
      ok: true,
      value: { status: 'success', receipt: { tx_hash: hash, num_confirmations: 3 } },
    });
  });

  it('caps a slow Koios request at the receipt deadline', async () => {
    vi.useFakeTimers();
    const hash = 'ab'.repeat(32);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: string, init: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(
              () => resolve(new Response(JSON.stringify([{ tx_hash: hash, num_confirmations: 3 }]))),
              5_000,
            );
            init.signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );
    const settled = vi.fn();
    const pending = cardano
      .waitForTransactionReceipt({
        chainKey: CARDANO,
        txHash: hash,
        pollingIntervalMs: 100,
        maxTimeoutMs: 1_000,
      })
      .then(settled);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.objectContaining({ status: 'timeout' }) }),
    );
    await pending;
  });

  it('reports a timeout, not a failure, when the transaction never reaches a block', async () => {
    vi.useFakeTimers();
    const hash = 'ab'.repeat(32);
    koios.status = [{ tx_hash: hash, num_confirmations: null }];
    const pending = cardano.waitForTransactionReceipt({
      srcChainKey: CARDANO,
      txHash: hash,
      pollingIntervalMs: 1_000,
      maxTimeoutMs: 3_000,
    } as never);

    await vi.advanceTimersByTimeAsync(10_000);

    const result = await pending;
    expect(result.ok && result.value.status).toBe('timeout');
  });
});

describe('CardanoSpokeService.sendMessage', () => {
  // An account whose payment key is the CIP-8 vector's, so the vector's COSE_Key proves the sender.
  const SIGNER_ADDRESS = cardanoAddressFromRecipientBytes(`0x61${CARDANO_CIP8.paymentHash.slice(2)}`);

  /** A COSE_Sign1 `[protected, {}, payload, 64-byte signature]` over whatever payload the wallet is asked to sign. */
  const coseSign1Over = (payloadHex: Hex) =>
    `84${'40'}${'a0'}${'5842'}${payloadHex.slice(2)}${'5840'}${'77'.repeat(64)}`;

  const walletSigning = (payloadFor: (asked: Hex) => Hex = asked => asked) => ({
    chainType: 'CARDANO',
    getWalletAddress: vi.fn(async () => SIGNER_ADDRESS),
    signTransaction: vi.fn(),
    submitTransaction: vi.fn(),
    signData: vi.fn(async (asked: Hex) => ({
      signature: coseSign1Over(payloadFor(asked)),
      key: CARDANO_CIP8.coseSigner,
    })),
  });

  const messageParams = (walletProvider: unknown, extra: object = {}) =>
    ({
      srcChainKey: CARDANO,
      srcAddress: SIGNER_ADDRESS,
      dstAddress: HUB_WALLET,
      payload: '0xdeadbeef',
      walletProvider,
      ...extra,
    }) as never;

  it('has the wallet signData the 0x<hash> payload and submits the scheme-7 withdraw with its COSE fields', async () => {
    const submit = vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
      ok: true,
      value: { accepted: true, trackingId: `0x${'ee'.repeat(32)}` },
    });
    const wallet = walletSigning();

    const trackingId = await cardano.sendMessage(messageParams(wallet));

    expect(trackingId).toBe(`0x${'ee'.repeat(32)}`);
    // The payload is the ASCII text `0x<64 hex>`: 66 bytes.
    expect(wallet.signData.mock.calls[0]?.[0]).toHaveLength(2 + 66 * 2);
    const request = submit.mock.calls[0]?.[1];
    expect(request?.scheme).toBe(7);
    expect(request?.message).toMatchObject({
      to: HUB_WALLET,
      data: '0xdeadbeef',
      chainId: '1815',
      sender: CARDANO_CIP8.paymentHash,
    });
    expect(request?.signature).toBe(`0x${'77'.repeat(64)}`);
    expect(request?.cardanoSignData?.coseKey).toBe(`0x${CARDANO_CIP8.coseSigner}`);
  });

  it('refuses a signature over a different payload or from a key other than the sender, submitting nothing', async () => {
    const submit = vi.spyOn(MpcRelayApiService, 'submitWithdraw');
    await expect(cardano.sendMessage(messageParams(walletSigning(() => `0x${'30'.repeat(66)}`)))).rejects.toThrow(
      /payload other than/,
    );

    // The account is a different key than the one the wallet signs with.
    const other = cardanoAddressFromRecipientBytes(CARDANO_ADDRESSES.enterpriseMainnet.hex);
    await expect(cardano.sendMessage(messageParams(walletSigning(), { srcAddress: other }))).rejects.toThrow(
      /signed with payment key hash/,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses raw mode and a hub wallet that is not a 20-byte address', async () => {
    const wallet = walletSigning();

    await expect(cardano.sendMessage(messageParams(wallet, { raw: true }))).rejects.toThrow(
      /raw mode is not supported/,
    );
    await expect(cardano.sendMessage(messageParams(wallet, { dstAddress: '0x1234' }))).rejects.toThrow(
      /invalid hub wallet/,
    );
    expect(wallet.signData).not.toHaveBeenCalled();
  });

  it('reuses the signed request after a 429', async () => {
    vi.useFakeTimers();
    const trackingIdOf = (body: string) => {
      const { message } = JSON.parse(body);
      return keccak256(concat([CARDANO_CIP8.paymentHash, toHex(BigInt(message.nonce), { size: 8 })]));
    };
    const send = vi.fn(async (_url: string, init?: RequestInit) => {
      if (send.mock.calls.length === 1) return new Response(null, { status: 429 });
      return Response.json({ accepted: true, trackingId: trackingIdOf(String(init?.body)) });
    });
    vi.stubGlobal('fetch', send);
    const wallet = walletSigning();
    const pending = cardano.sendMessage(messageParams(wallet)).then(
      value => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, error }),
    );

    await vi.runAllTimersAsync();
    const result = await pending;
    const bodies = send.mock.calls.map(([, init]) => String(init?.body));
    expect(bodies).toHaveLength(2);
    expect(new Set(bodies).size).toBe(1);
    expect(wallet.signData).toHaveBeenCalledOnce();
    const body = bodies[0];
    if (body === undefined) throw new Error('withdraw request was not sent');
    expect(result).toEqual({ ok: true, value: trackingIdOf(body) });
  });

  it('surfaces a relay rejection', async () => {
    vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
      ok: false,
      error: new Error('mpc-relay: withdraw rejected: bad'),
    });

    await expect(cardano.sendMessage(messageParams(walletSigning()))).rejects.toThrow(/withdraw rejected/);
  });
});

describe('CardanoSpokeService — relay submit and read', () => {
  const HUB_RELEASE = { dstChainKey: CARDANO, hubChainId: '146', hubTxHash: '0xhub', logIndex: 3 } as const;
  const HASH = 'ab'.repeat(32);
  const record = { ok: true as const, value: { depositId: 'id', status: 'pending' as const, createdAt: 0, txs: {} } };

  it('submitDeposit notifies the bare lowercase hash on the Cardano relay id, and submitHubRelease the hub tx as a withdrawal, without polling', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit');

    expect(await cardano.submitDeposit(`0x${HASH.toUpperCase()}`)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '1815', HASH);
    expect(await cardano.submitHubRelease(HUB_RELEASE)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '146', '0xhub', 'withdrawal');
    expect(wait).not.toHaveBeenCalled();
  });

  it('submitDeposit keeps the tx hash in the failure so the deposit can be re-notified', async () => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const pending = cardano.submitDeposit(HASH);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(!result.ok && (result.error as Error).message).toContain(`deposit ${HASH} was not notified`);
  });

  it('reads a deposit keyed on output 0, a hub release and a withdrawal once each, notifying nothing', async () => {
    const read = vi.spyOn(MpcRelayApiService, 'getDeposit').mockResolvedValue(record);
    await cardano.getDepositRecord(`0x${HASH}`);
    // Output index 0 is where the reserve payment is built.
    expect(read.mock.calls[0]?.[1]).toBe(`1815-${HASH}-0`);

    vi.spyOn(MpcRelayApiService, 'getWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: '0xtrack', status: 'submitted' },
    });

    expect(await cardano.getHubReleaseRecord(HUB_RELEASE)).toBe(record);
    expect((await cardano.getWithdrawalRecord('0xtrack')).ok).toBe(true);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('uses the settlement floor for NaN across the relay waits and passes the withdrawal stage through', async () => {
    const deposit = vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue(record);
    const release = vi.spyOn(MpcRelayApiService, 'waitForHubRelease').mockResolvedValue(record);
    const withdrawal = vi.spyOn(MpcRelayApiService, 'waitForWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: '0xtrack', status: 'burned' },
    });

    await cardano.waitForDeposit(HASH, Number.NaN);
    await cardano.waitForHubRelease(HUB_RELEASE, Number.NaN);
    await cardano.waitForWithdrawal('0xtrack', Number.NaN, 'burned');

    for (const wait of [deposit, release, withdrawal]) {
      expect(wait).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ timeout: 900_000 }),
      );
    }
    // The stage to stop on passes through to the relay poll.
    expect(withdrawal).toHaveBeenCalledWith(expect.anything(), '0xtrack', expect.objectContaining({ until: 'burned' }));
  });
});
