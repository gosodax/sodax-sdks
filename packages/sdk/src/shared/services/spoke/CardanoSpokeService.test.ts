import { blake2b } from '@noble/hashes/blake2b';
import { ChainKeys } from '@sodax/types';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sodax } from '../../entities/Sodax.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import { CARDANO_ADDRESSES, CARDANO_CIP8 } from './cardano-test-vectors.js';
import { cardanoDepositAuxiliaryData } from './cardano-tx.js';
import { cardanoAddressFromRecipientBytes } from './cardano-utils.js';

const sodax = new Sodax();
const cardano = sodax.spoke.cardano;

const CARDANO = ChainKeys.CARDANO_MAINNET;
const NATIVE_ADA = '0x0000000000000000000000000000000000000000';
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Hex;
const RESERVE = sodax.config.getChainConfig(CARDANO).addresses.reserve;
const OWNER = CARDANO_ADDRESSES.baseMainnet.bech32;
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

/** A witness set holding one vkey witness, as a wallet returns it (no set tag). */
const ONE_WITNESS = `a1008182${`5820${'11'.repeat(32)}`}${`5840${'22'.repeat(64)}`}`;
/** The same shape with two vkey witnesses: a wallet that adds a key the fee was not sized for. */
const TWO_WITNESSES = `a1008282${`5820${'11'.repeat(32)}`}${`5840${'22'.repeat(64)}`}${`5820${'33'.repeat(32)}`}${`5840${'44'.repeat(64)}`}`;

/** The tx hash of an unsigned `[body, {}, true, aux]` transaction, as the wallet computes it. */
function hashOfUnsigned(unsignedHex: string): string {
  const unsigned = hexToBytes(`0x${unsignedHex}`);
  // `84` ‖ body ‖ `a0` ‖ `f5` ‖ aux.
  const body = unsigned.slice(1, unsigned.length - AUX_LENGTH - 2);
  return bytesToHex(blake2b(body, { dkLen: 32 })).slice(2);
}

let signedByWallet: string | undefined;
const walletFor = (witness = ONE_WITNESS, submitted?: string) => {
  let unsignedHash = '';
  return {
    chainType: 'CARDANO',
    getWalletAddress: vi.fn(async () => OWNER),
    signTransaction: vi.fn(async (unsigned: string) => {
      unsignedHash = hashOfUnsigned(unsigned);
      return witness;
    }),
    submitTransaction: vi.fn(async (signed: string) => {
      signedByWallet = signed;
      return submitted ?? unsignedHash;
    }),
    signData: vi.fn(),
  };
};

const depositParams = (wallet: ReturnType<typeof walletFor>, extra: object = {}) =>
  ({
    srcChainKey: CARDANO,
    srcAddress: OWNER,
    to: HUB_WALLET,
    token: NATIVE_ADA,
    amount: AMOUNT,
    data: '0x' as Hex,
    walletProvider: wallet,
    ...extra,
  }) as never;

const registration = (overrides: object = {}) => ({
  ok: true as const,
  value: {
    depositMethod: 'memo',
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
    expect(wallet.signTransaction).toHaveBeenCalledOnce();
    expect(wallet.submitTransaction).toHaveBeenCalledOnce();
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '1815', txHash);
    // The wallet is handed hex CBOR with no 0x, as CIP-30 takes it, and submits the transaction it signed.
    expect(wallet.signTransaction.mock.calls[0]?.[0]).toMatch(/^84a5/);
    expect(signedByWallet).toMatch(/^84a5/);
  });

  it('registers the deposit under the account address on the Cardano relay id', async () => {
    await cardano.deposit(depositParams(walletFor()));

    expect(MpcRelayApiService.getDepositAddress).toHaveBeenCalledWith(expect.anything(), OWNER, '1815', '0x');
  });

  it('returns the transfer descriptor in raw mode without reading the chain or touching the wallet', async () => {
    const wallet = walletFor();

    const tx = await cardano.deposit(depositParams(wallet, { raw: true }));

    expect(tx).toEqual({ from: OWNER, to: RESERVE, value: AMOUNT, data: MEMO, token: NATIVE_ADA });
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

  it('refuses a token payment, which the reserve never credits', async () => {
    await expect(
      cardano.deposit(depositParams(walletFor(), { token: '0x1234567890123456789012345678901234567890' })),
    ).rejects.toThrow(/native ADA only/);
  });

  it('refuses a non-positive amount before registering anything', async () => {
    await expect(cardano.deposit(depositParams(walletFor(), { amount: 0n }))).rejects.toThrow(/must be positive/);
    expect(MpcRelayApiService.getDepositAddress).not.toHaveBeenCalled();
  });

  it.each([
    ['a testnet address', CARDANO_ADDRESSES.enterpriseTestnet.bech32, /not mainnet/],
    ['garbage', 'not-an-address', /invalid Cardano bech32/],
  ])('refuses %s as the source before registering anything', async (_label, srcAddress, message) => {
    await expect(cardano.deposit(depositParams(walletFor(), { srcAddress }))).rejects.toThrow(message);
    expect(MpcRelayApiService.getDepositAddress).not.toHaveBeenCalled();
  });

  it('refuses to pay a reserve that is not the configured one, however well-formed', async () => {
    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValue(
      registration({ reserveAddress: CARDANO_ADDRESSES.enterpriseMainnet.bech32 }) as never,
    );
    const wallet = walletFor();

    await expect(cardano.deposit(depositParams(wallet))).rejects.toThrow(/is not the configured reserve/);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a memo that does not commit to the payload',
      { memo: `0x${'ab'.repeat(32)}` },
      /does not commit to this deposit's payload/,
    ],
    [
      'a hub wallet other than the one targeted',
      { hubWallet: '0x2222222222222222222222222222222222222222' },
      /derives hub wallet/,
    ],
    ['an address-mode registration', { depositMethod: 'address', depositAddress: RESERVE }, /expected memo/],
    [
      'metadata that does not match the memo',
      { cardanoMetadata: { '674': { msg: ['00'.repeat(32)] } } },
      /does not match the metadata/,
    ],
  ])('refuses %s, signing nothing', async (_label, override, message) => {
    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValue(registration(override) as never);
    const wallet = walletFor();

    await expect(cardano.deposit(depositParams(wallet))).rejects.toThrow(message);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it('refuses to submit when the wallet adds a witness the fee was not sized for', async () => {
    const wallet = walletFor(TWO_WITNESSES);

    await expect(cardano.deposit(depositParams(wallet))).rejects.toThrow(/larger witness set than one key/);
    expect(wallet.submitTransaction).not.toHaveBeenCalled();
  });

  it('reports both hashes when the wallet submitted a different transaction than the one built', async () => {
    const other = 'cd'.repeat(32);

    await expect(cardano.deposit(depositParams(walletFor(ONE_WITNESS, other)))).rejects.toThrow(
      new RegExp(`wallet submitted tx ${other}, but the built tx is [0-9a-f]{64}`),
    );
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
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

  it('fails the deposit, signing nothing, when Koios cannot be read', async () => {
    koios.failOn = '/cli_protocol_params';
    const wallet = walletFor();

    await expect(cardano.deposit(depositParams(wallet))).rejects.toThrow(/koios \/cli_protocol_params: HTTP 500/);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it('refuses a Koios UTXO that belongs to a different address', async () => {
    koios.utxos = [{ ...utxoRow(0, 20_000_000n), address: CARDANO_ADDRESSES.enterpriseMainnet.bech32 }];

    await expect(cardano.deposit(depositParams(walletFor()))).rejects.toThrow(/belongs to a different address/);
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

  it('refuses a wallet that signed a different payload, submitting nothing', async () => {
    const submit = vi.spyOn(MpcRelayApiService, 'submitWithdraw');
    const wallet = walletSigning(() => `0x${'30'.repeat(66)}`);

    await expect(cardano.sendMessage(messageParams(wallet))).rejects.toThrow(/payload other than/);
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses a signature from a key other than the account sending', async () => {
    const submit = vi.spyOn(MpcRelayApiService, 'submitWithdraw');
    const wallet = walletSigning();
    // The account is a different key than the one the wallet signs with.
    const other = cardanoAddressFromRecipientBytes(CARDANO_ADDRESSES.enterpriseMainnet.hex);

    await expect(cardano.sendMessage(messageParams(wallet, { srcAddress: other }))).rejects.toThrow(
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

  it('submitDeposit notifies the bare lowercase hash on the Cardano relay id, without polling', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit');

    expect(await cardano.submitDeposit(`0x${HASH.toUpperCase()}`)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '1815', HASH);
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

  it('keys a deposit on output index 0, which is where the reserve payment is built', async () => {
    const read = vi.spyOn(MpcRelayApiService, 'getDeposit').mockResolvedValue(record);

    await cardano.getDepositRecord(`0x${HASH}`);

    expect(read.mock.calls[0]?.[1]).toBe(`1815-${HASH}-0`);
  });

  it('submitHubRelease notifies the hub tx as a withdrawal on the hub chain id', async () => {
    expect(await cardano.submitHubRelease(HUB_RELEASE)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '146', '0xhub', 'withdrawal');
  });

  it('reads a hub release and a withdrawal once each, notifying nothing', async () => {
    vi.spyOn(MpcRelayApiService, 'getDeposit').mockResolvedValue(record);
    vi.spyOn(MpcRelayApiService, 'getWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: '0xtrack', status: 'submitted' },
    });

    expect(await cardano.getHubReleaseRecord(HUB_RELEASE)).toBe(record);
    expect((await cardano.getWithdrawalRecord('0xtrack')).ok).toBe(true);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('waitForWithdrawal passes the stage to stop on through to the relay poll, with the Cardano floor', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: '0xtrack', status: 'burned' },
    });

    await cardano.waitForWithdrawal('0xtrack', 1_000, 'burned');

    expect(wait).toHaveBeenCalledWith(
      expect.anything(),
      '0xtrack',
      expect.objectContaining({ until: 'burned', timeout: 900_000 }),
    );
  });
});
