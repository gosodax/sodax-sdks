import {
  type CardanoChainKey,
  type CardanoGasEstimate,
  type CardanoRawTransaction,
  type CardanoRawTransactionReceipt,
  type CardanoSpokeChainConfig,
  ChainKeys,
  getMpcRelayChainInfo,
  type Result,
  type TxReturnType,
} from '@sodax/types';
import { bytesToHex, hexToBytes, isAddress, type Hex } from 'viem';
import type { ConfigService } from '../../config/ConfigService.js';
import { retry } from '../../utils/shared-utils.js';
import type {
  DepositParams,
  EstimateGasParams,
  GetBalanceParams,
  GetBalancesParams,
  GetDepositParams,
  SendMessageParams,
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
} from '../../types/spoke-types.js';
import {
  computePayloadHash,
  getDeposit,
  getDepositAddress,
  getWithdrawal,
  notify,
  submitWithdraw,
  toDepositId,
  toHubReleaseId,
  waitForDeposit,
  waitForHubRelease,
  waitForWithdrawal,
  type DepositRecord,
  type HubRelease,
  type MpcRelaySettlement,
  type NotifyResponse,
  type WithdrawalRecord,
  type WithdrawalSettledOn,
} from '../mpcRelay/MpcRelayApiService.js';
import { createBalanceCollector, settleWalletBalances, type WalletBalanceMap } from './balance-utils.js';
import { createKoiosClient } from './cardano-koios.js';
import {
  CARDANO_TTL_SECONDS,
  EMPTY_WITNESS_SET,
  assembleCardanoTx,
  buildCardanoDeposit,
  cardanoMinFee,
  cardanoTxHash,
} from './cardano-tx.js';
import {
  cardanoDepositMetadata,
  cardanoIdentityBytes,
  cardanoSignDataFields,
  cardanoSignDataPayload,
  parseCardanoAddress,
} from './cardano-utils.js';
import { computeSignedMessageHash, randomWithdrawNonce } from './mpc-message.js';

/**
 * Floor for an MPC-relay settlement wait, applied over the caller's own timeout: the relay waits for 15
 * confirmations (about 5 minutes) before it attests, then submits to NEAR and mints on the hub.
 */
const CARDANO_SETTLEMENT_FLOOR_MS = 900_000;

/** How often to re-notify the relay while waiting for a deposit; `/notify` is idempotent. */
const RENOTIFY_INTERVAL_MS = 30_000;

/** A deposit is built with the reserve payment first, so the relay keys it on output index 0. */
const DEPOSIT_OUTPUT_INDEX = 0;

/** A relay tx hash in the bare lowercase form the verifier keys deposits on. */
const canonicalTxHash = (txHash: string): string => txHash.replace(/^0x/i, '').toLowerCase();

/** CIP-30 takes and returns hex CBOR without a `0x`. */
const toWalletHex = (bytes: Uint8Array): string => bytesToHex(bytes).slice(2);
const fromWalletHex = (hex: string): Uint8Array => hexToBytes(`0x${hex.replace(/^0x/i, '')}`);

/**
 * Spoke service for Cardano (native ADA). Deposits ride the **MPC relay** in memo mode: one payment to the shared
 * reserve at output 0, carrying the payload hash as CIP-20 label-674 metadata. A CIP-30 wallet signs and submits
 * but does not build transactions, so the service builds the body from the account's pure-ADA UTXOs (read from
 * Koios) and the wallet only adds its witness.
 *
 * Withdrawals use scheme 7: a CIP-30 `signData` over the text `0x<message hash>`, submitted with the wallet's
 * COSE_Sign1 and COSE_Key. A Cardano account is identified by the 28-byte hash of its payment key.
 *
 * @see MpcRelayApiService for the relay REST flow.
 */
export class CardanoSpokeService implements MpcRelaySettlement {
  private readonly config: ConfigService;

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live: `ConfigService` can swap in backend-fetched config after construction.
  private get chainConfig(): CardanoSpokeChainConfig {
    return this.config.getChainConfig(ChainKeys.CARDANO_MAINNET);
  }

  private get relayApiUrl(): CardanoSpokeChainConfig['mpcRelayApiEndpoint'] {
    return this.chainConfig.mpcRelayApiEndpoint;
  }

  /** The relay's id for this chain (1815). */
  private get chainId(): string {
    return getMpcRelayChainInfo(ChainKeys.CARDANO_MAINNET).chainId.toString();
  }

  private get koios() {
    return createKoiosClient(this.chainConfig.rpcUrl);
  }

  /**
   * Deposit native ADA into the hub via the MPC relay.
   *
   * `Raw: true` returns the transfer descriptor (the reserve, the lovelace and the memo). `Raw: false` builds the
   * payment, has the wallet sign it, submits it through the wallet, notifies the relay, and resolves to the tx
   * hash. After the wallet has submitted, a failed notify warns and still resolves to the hash, so a retry cannot
   * pay twice: `settle` re-notifies it, and a caller that does not settle notifies it with `spoke.submitMpcDeposit`.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<CardanoChainKey, R>,
  ): Promise<TxReturnType<CardanoChainKey, R>> {
    const { srcAddress, token, amount, data, to } = params;
    if (token !== this.chainConfig.nativeToken) {
      throw new Error(
        '[CardanoSpokeService.deposit] Cardano deposits carry native ADA only: a token payment to the reserve is never credited',
      );
    }
    if (amount <= 0n) throw new Error(`[CardanoSpokeService.deposit] amount must be positive, got ${amount} lovelace`);
    // Refuses anything but a mainnet key-hash payment address before an ADA moves.
    const owner = parseCardanoAddress(srcAddress);

    const addr = await getDepositAddress(this.relayApiUrl, srcAddress, this.chainId, data);
    if (!addr.ok) throw addr.error;
    if (addr.value.depositMethod !== 'memo') {
      throw new Error(
        `[CardanoSpokeService.deposit] relay returned a ${addr.value.depositMethod}-mode deposit, expected memo`,
      );
    }
    const { reserveAddress, memo, hubWallet, cardanoMetadata } = addr.value;

    // The payment is irreversible, so the reserve is pinned to the configured one rather than only warned about:
    // a compromised or intercepted relay response must not be able to redirect it.
    if (reserveAddress !== this.chainConfig.addresses.reserve) {
      throw new Error(
        `[CardanoSpokeService.deposit] relay reserve ${reserveAddress} is not the configured reserve ${this.chainConfig.addresses.reserve}; refusing to pay it`,
      );
    }
    const reserve = parseCardanoAddress(reserveAddress);

    // The relay derives the hub wallet from `srcAddress`, so `to` is an assertion, not an instruction.
    if (to.toLowerCase() !== hubWallet.toLowerCase()) {
      throw new Error(
        `[CardanoSpokeService.deposit] relay derives hub wallet ${hubWallet} for ${srcAddress}, but the deposit targets ${to}`,
      );
    }
    // Verifiers attest whatever payload the relay stored under the memo, so the memo must commit to our `data`.
    const expectedMemo = computePayloadHash(hubWallet, data);
    if (memo.toLowerCase() !== expectedMemo) {
      throw new Error(
        `[CardanoSpokeService.deposit] relay memo ${memo} does not commit to this deposit's payload (expected ${expectedMemo})`,
      );
    }
    if (cardanoMetadata && JSON.stringify(cardanoMetadata) !== JSON.stringify(cardanoDepositMetadata(memo))) {
      throw new Error(
        `[CardanoSpokeService.deposit] relay metadata ${JSON.stringify(cardanoMetadata)} does not match the metadata built from memo ${memo}`,
      );
    }

    if ('raw' in params && params.raw) {
      return {
        from: srcAddress,
        to: reserveAddress,
        value: amount,
        data: memo,
        token,
      } satisfies CardanoRawTransaction as TxReturnType<CardanoChainKey, R>;
    }

    const { walletProvider } = params;
    const koios = this.koios;
    const [utxos, tipSlot, protocolParams] = await Promise.all([
      koios.getUtxos(srcAddress),
      koios.getTipSlot(),
      koios.getProtocolParams(),
    ]);
    // Only pure-ADA UTXOs are spent: a token moved into the reserve output is never credited and has no refund.
    const spendable = utxos.filter(utxo => !utxo.hasAssets && !utxo.hasReferenceScript);
    let built: ReturnType<typeof buildCardanoDeposit>;
    try {
      built = buildCardanoDeposit({
        utxos: spendable,
        reserveAddress: reserve.bytes,
        changeAddress: owner.bytes,
        amount,
        memoHex: memo,
        params: protocolParams,
        // Shelley slots are one second, so slots ahead are seconds ahead.
        ttlSlot: tipSlot + BigInt(CARDANO_TTL_SECONDS),
      });
    } catch (error) {
      throw new Error(
        `[CardanoSpokeService.deposit] ${srcAddress}: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }

    const unsigned = assembleCardanoTx(built.bodyCbor, EMPTY_WITNESS_SET, built.auxiliaryData);
    const witnessSet = fromWalletHex(await walletProvider.signTransaction(toWalletHex(unsigned)));
    const signed = assembleCardanoTx(built.bodyCbor, witnessSet, built.auxiliaryData);
    // A wallet that adds more witnesses than the one sized for makes the fee short; the ledger would reject it.
    const needed = cardanoMinFee(signed.length, protocolParams);
    if (built.body.fee < needed) {
      throw new Error(
        `[CardanoSpokeService.deposit] wallet returned a larger witness set than one key: fee ${built.body.fee} < ${needed} lovelace; not submitting`,
      );
    }

    const txHash = cardanoTxHash(built);
    const submitted = canonicalTxHash(await walletProvider.submitTransaction(toWalletHex(signed)));
    if (submitted !== txHash) {
      throw new Error(`[CardanoSpokeService.deposit] wallet submitted tx ${submitted}, but the built tx is ${txHash}`);
    }

    const notified = await this.submitDeposit(txHash);
    if (!notified.ok) {
      this.config.logger.warn(
        '[CardanoSpokeService.deposit] relay notify failed; settle or submitMpcDeposit re-notifies it',
        {
          txHash,
          error: notified.error,
        },
      );
    }
    return txHash satisfies string as TxReturnType<CardanoChainKey, R>;
  }

  /**
   * Notify the relay of a submitted deposit, without waiting for the hub mint. The funds are already on the
   * network, so it retries, and a failure keeps the tx hash: the only handle left for re-notifying the deposit.
   */
  public async submitDeposit(txHash: string): Promise<Result<void>> {
    const hash = canonicalTxHash(txHash);
    try {
      await this.retryNotify(() => notify(this.relayApiUrl, this.chainId, hash));
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: new Error(`mpc-relay: deposit ${hash} was not notified — re-notify this tx hash to settle it`, {
          cause: error,
        }),
      };
    }
  }

  /** A notify, retried: `retry` reacts to a throw and `notify` reports failure in its Result, so rethrow it. */
  private async retryNotify(send: () => Promise<Result<NotifyResponse>>): Promise<void> {
    await retry(async () => {
      const res = await send();
      if (!res.ok) throw res.error;
    });
  }

  /**
   * Wait for the hub mint to land for a Cardano deposit, via the MPC relay's deposit record.
   * `txHash` is the hash returned by {@link deposit}.
   */
  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    const hash = canonicalTxHash(txHash);
    // The relay waits for confirmations and never re-checks a notification that arrived first.
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, this.chainId, hash);
    }, RENOTIFY_INTERVAL_MS);
    try {
      return await waitForDeposit(this.relayApiUrl, toDepositId(this.chainId, hash, DEPOSIT_OUTPUT_INDEX), {
        timeout: Math.max(timeout ?? 0, CARDANO_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } finally {
      clearInterval(renotify);
    }
  }

  /** The MPC relay's current record for a Cardano deposit, read once. `txHash` is as for {@link waitForDeposit}. */
  public async getDepositRecord(txHash: string): Promise<Result<DepositRecord>> {
    return getDeposit(this.relayApiUrl, toDepositId(this.chainId, canonicalTxHash(txHash), DEPOSIT_OUTPUT_INDEX));
  }

  /** On-chain ADA balance of the account, in lovelace. Cardano is ADA only, so `token` does not choose anything. */
  public async getDeposit(params: GetDepositParams<CardanoChainKey>): Promise<bigint> {
    return this.koios.getBalance(params.srcAddress);
  }

  /** The user's own wallet balance of `token`, in lovelace — the same read as {@link getDeposit}. */
  public async getWalletBalance(params: GetBalanceParams<CardanoChainKey>): Promise<bigint> {
    return this.getDeposit({
      srcChainKey: params.srcChainKey,
      srcAddress: params.srcAddress,
      token: params.token.address,
    });
  }

  /** The user's own wallet balances of multiple tokens, keyed by `token.address`. */
  public async getWalletBalances(params: GetBalancesParams<CardanoChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  /**
   * The network fee of a typical deposit, in lovelace: one input and a base-address change output, priced at the
   * current protocol parameters. A wallet whose funds are spread over several UTXOs pays slightly more.
   */
  public async estimateGas(_params: EstimateGasParams<CardanoChainKey>): Promise<CardanoGasEstimate> {
    const reserve = parseCardanoAddress(this.chainConfig.addresses.reserve);
    const built = buildCardanoDeposit({
      utxos: [{ txHash: '0'.repeat(64), index: 0, lovelace: 1_000_000_000_000n }],
      reserveAddress: reserve.bytes,
      changeAddress: new Uint8Array(57),
      amount: 1_000_000n,
      memoHex: `0x${'00'.repeat(32)}`,
      params: await this.koios.getProtocolParams(),
      ttlSlot: 0n,
    });
    return { fee: built.body.fee };
  }

  /**
   * Withdraw / borrow (hub→Cardano) via the MPC relay's signature-mode pipeline.
   *
   * The `payload` is the hub-wallet calls to run; `dstAddress` is the hub wallet that executes them. The account
   * `signData`s the withdraw-auth hash (scheme 7), and the relay verifies → burns on the hub → MPC-signs the
   * release. Resolves to the `trackingId` to poll {@link waitForWithdrawal} with. Raw mode is not supported — there
   * is no spoke tx to return.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<CardanoChainKey, Raw>,
  ): Promise<TxReturnType<CardanoChainKey, Raw>> {
    if ('raw' in params && params.raw) {
      throw new Error('[CardanoSpokeService.sendMessage] raw mode is not supported for Cardano withdrawals');
    }
    // `data` is variable-length inside the signed digest's unframed concat, so `to` must be exactly 20 bytes.
    if (!isAddress(params.dstAddress)) {
      throw new Error(`[CardanoSpokeService.sendMessage] invalid hub wallet address: ${params.dstAddress}`);
    }

    const sender = cardanoIdentityBytes(params.srcAddress);
    const message = {
      to: params.dstAddress as Hex, // hub wallet that executes the calls
      data: params.payload,
      nonce: randomWithdrawNonce(),
      chainId: BigInt(this.chainId), // the relay's source-chain id, not the hub's
      sender,
    };
    const messageHash = computeSignedMessageHash(message);
    const dataSignature = await params.walletProvider.signData(cardanoSignDataPayload(messageHash));
    // Fails here, with a specific reason, rather than at the relay if the wallet signed the wrong payload or key.
    const fields = cardanoSignDataFields(dataSignature, messageHash, sender);

    const res = await submitWithdraw(this.relayApiUrl, {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature: fields.signature,
      scheme: getMpcRelayChainInfo(ChainKeys.CARDANO_MAINNET).withdrawScheme,
      cardanoSignData: fields.cardanoSignData,
    });
    if (!res.ok) throw res.error;

    return res.value.trackingId satisfies string as TxReturnType<CardanoChainKey, Raw>;
  }

  /** The MPC relay's current record for a withdraw-auth, read once. `trackingId` is what {@link sendMessage} returned. */
  public async getWithdrawalRecord(trackingId: string): Promise<Result<WithdrawalRecord>> {
    return getWithdrawal(this.relayApiUrl, trackingId);
  }

  /**
   * Wait for a hub→Cardano withdrawal to reach `released`, via the MPC relay.
   * `trackingId` is the value returned by {@link sendMessage}.
   */
  public async waitForWithdrawal(
    trackingId: string,
    timeout?: number,
    until?: WithdrawalSettledOn,
  ): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      until,
      timeout: Math.max(timeout ?? 0, CARDANO_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /**
   * Notify the relay of a hub tx releasing to Cardano, without waiting for the release. The relay has no hub
   * watcher and learns of the hub tx only through `/notify`.
   */
  public async submitHubRelease(release: HubRelease): Promise<Result<void>> {
    const { hubChainId, hubTxHash } = release;
    try {
      await this.retryNotify(() => notify(this.relayApiUrl, hubChainId, hubTxHash, 'withdrawal'));
      return { ok: true, value: undefined };
    } catch (error) {
      // The hub has already burned the tokens; the hash is what a retry has to re-notify.
      return {
        ok: false,
        error: new Error(`mpc-relay: hub tx ${hubTxHash} was not notified — re-notify it to release`, { cause: error }),
      };
    }
  }

  /**
   * Wait until a release {@link submitHubRelease} notified is paid. The relay's verifier also waits on hub
   * confirmations and may have dropped an early notify, so this keeps re-notifying.
   */
  public async waitForHubRelease(release: HubRelease, timeout?: number): Promise<Result<DepositRecord>> {
    const { hubChainId, hubTxHash } = release;
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, hubChainId, hubTxHash, 'withdrawal');
    }, RENOTIFY_INTERVAL_MS);
    try {
      return await waitForHubRelease(this.relayApiUrl, release, {
        timeout: Math.max(timeout ?? 0, CARDANO_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } finally {
      clearInterval(renotify);
    }
  }

  /** One read of a hub release's record through the relay, which `txs.release` marks as paid. */
  public async getHubReleaseRecord(release: HubRelease): Promise<Result<DepositRecord>> {
    return getDeposit(this.relayApiUrl, toHubReleaseId(release));
  }

  /** Poll Koios until the transaction is in a block, mapping it to the SDK shape. */
  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<CardanoChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<CardanoChainKey>>> {
    const txHash = canonicalTxHash(params.txHash);
    const pollingIntervalMs = params.pollingIntervalMs ?? this.chainConfig.pollingConfig.pollingIntervalMs;
    const maxTimeoutMs = params.maxTimeoutMs ?? this.chainConfig.pollingConfig.maxTimeoutMs;
    const maxAttempts = Math.max(1, Math.round(maxTimeoutMs / pollingIntervalMs));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const depth = await this.koios.getTxDepth(txHash);
        if (depth !== null) {
          const receipt: CardanoRawTransactionReceipt = { tx_hash: txHash, num_confirmations: depth };
          return { ok: true, value: { status: 'success', receipt } };
        }
      } catch (error) {
        this.config.logger.debug('[CardanoSpokeService.waitForTransactionReceipt] poll error', { error });
      }
      await new Promise(r => setTimeout(r, pollingIntervalMs));
    }
    return { ok: true, value: { status: 'timeout', error: new Error(`cardano tx ${txHash} not in a block in time`) } };
  }
}
