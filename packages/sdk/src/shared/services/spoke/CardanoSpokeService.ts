import {
  type CardanoChainKey,
  type CardanoGasEstimate,
  type CardanoRawTransaction,
  type CardanoRawTransactionReceipt,
  type CardanoSpokeChainConfig,
  ChainKeys,
  getMpcRelayChainInfo,
  IndeterminateOutcomeError,
  type Result,
  type TxReturnType,
} from '@sodax/types';
import { bytesToHex, hexToBytes, isAddress, type Hex } from 'viem';
import type { ConfigService } from '../../config/ConfigService.js';
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
import { pollUntil } from '../../utils/pollUntil.js';
import { resolveTimeoutMs } from '../../utils/resolveTimeoutMs.js';
import { retry } from '../../utils/shared-utils.js';
import {
  computePayloadHash,
  getDeposit,
  getDepositAddress,
  getWithdrawal,
  notify,
  submitFreshWithdrawWithBackoff,
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
  cardanoMinUtxo,
  cardanoTxHash,
  verifyCardanoPaymentWitness,
} from './cardano-tx.js';
import {
  cardanoDepositMetadata,
  cardanoIdentityBytes,
  cardanoSignDataFields,
  cardanoSignDataPayload,
  parseCardanoAddress,
} from './cardano-utils.js';
import { computeSignedMessageHash, randomWithdrawNonce } from './mpc-message.js';

/** Floor over the caller's settlement timeout: the relay waits 15 confirmations (~5 min), then submits to NEAR and mints. */
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
 * Cardano (ADA) spoke: deposits ride the MPC relay in memo mode (CIP-20 label-674 metadata, reserve at output 0); the
 * service builds from pure-ADA UTXOs and the CIP-30 wallet only witnesses. Withdrawals use scheme 7 (CIP-30 `signData`).
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
   * Deposit ADA via the MPC relay. After the wallet submits, a failed notify warns and still resolves to the hash; an
   * uncertain broadcast error carries the SDK `txHash` (and `walletTxHash` if the wallet reports a different one).
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
    if (amount > 400_000_000n) {
      throw new Error('[CardanoSpokeService.deposit] amount exceeds the 400 ADA single-deposit cap');
    }
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

    // The payment is irreversible, so the reserve is pinned rather than warned about: a tampered relay response must not redirect it.
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
        data: memo.slice(2).toLowerCase(),
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
    const verifiedWitness = verifyCardanoPaymentWitness(witnessSet, owner.paymentHash, built.txId);
    const signed = assembleCardanoTx(built.bodyCbor, verifiedWitness, built.auxiliaryData);
    const needed = cardanoMinFee(signed.length, protocolParams);
    // Invariant: the verified witness is re-encoded at the size the fee was priced for.
    if (built.body.fee < needed) {
      throw new Error(
        `[CardanoSpokeService.deposit] signed tx needs fee ${needed} lovelace but was built with ${built.body.fee}; not submitting`,
      );
    }

    const txHash = cardanoTxHash(built);
    let submitted: string;
    try {
      submitted = canonicalTxHash(await walletProvider.submitTransaction(toWalletHex(signed)));
    } catch (error) {
      // CIP-30 TxSendError.Refused means the wallet declined to send the transaction.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 1 &&
        'info' in error &&
        typeof error.info === 'string'
      ) {
        throw error;
      }
      const notifiedAfterThrow = await this.submitDeposit(txHash);
      if (!notifiedAfterThrow.ok) {
        this.config.logger.warn('[CardanoSpokeService.deposit] relay notify failed after a wallet submit error', {
          txHash,
          error: notifiedAfterThrow.error,
        });
      }
      throw new IndeterminateOutcomeError(`Settle txHash ${txHash} and do not send again.`, { cause: error, txHash });
    }
    const notified = await this.submitDeposit(txHash);
    if (submitted !== txHash) {
      const walletNotified = await this.submitDeposit(submitted);
      if (!walletNotified.ok) {
        this.config.logger.warn('[CardanoSpokeService.deposit] wallet hash relay notify failed', {
          walletTxHash: submitted,
          error: walletNotified.error,
        });
      }
      throw Object.assign(
        new IndeterminateOutcomeError(
          `[CardanoSpokeService.deposit] wallet submitted tx ${submitted}, but the built tx is ${txHash}. Settle txHash ${txHash} and do not send again.`,
          {
            cause: notified.ok ? undefined : notified.error,
            txHash,
          },
        ),
        { walletTxHash: submitted },
      );
    }
    if (!notified.ok) {
      this.config.logger.warn(
        '[CardanoSpokeService.deposit] relay notify failed; settle or submitMpcDeposit re-notifies it',
        {
          txHash,
          error: notified.error,
        },
      );
    }
    return submitted satisfies string as TxReturnType<CardanoChainKey, R>;
  }

  /** Notify the relay of a submitted deposit with retries; a failure keeps the tx hash, the only handle to re-notify. */
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

  /** `retry` reacts to a throw while `notify` reports failure in its Result, so rethrow it. */
  private async retryNotify(send: () => Promise<Result<NotifyResponse>>): Promise<void> {
    await retry(async () => {
      const res = await send();
      if (!res.ok) throw res.error;
    });
  }

  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    const hash = canonicalTxHash(txHash);
    // The relay waits for confirmations and never re-checks a notification that arrived first.
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, this.chainId, hash);
    }, RENOTIFY_INTERVAL_MS);
    try {
      return await waitForDeposit(this.relayApiUrl, toDepositId(this.chainId, hash, DEPOSIT_OUTPUT_INDEX), {
        timeout: Math.max(resolveTimeoutMs(timeout, 0), CARDANO_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } finally {
      clearInterval(renotify);
    }
  }

  public async getDepositRecord(txHash: string): Promise<Result<DepositRecord>> {
    return getDeposit(this.relayApiUrl, toDepositId(this.chainId, canonicalTxHash(txHash), DEPOSIT_OUTPUT_INDEX));
  }

  /** In lovelace; Cardano is ADA only, so `token` does not choose anything. */
  public async getDeposit(params: GetDepositParams<CardanoChainKey>): Promise<bigint> {
    return this.koios.getBalance(params.srcAddress);
  }

  public async getWalletBalance(params: GetBalanceParams<CardanoChainKey>): Promise<bigint> {
    return this.getDeposit({
      srcChainKey: params.srcChainKey,
      srcAddress: params.srcAddress,
      token: params.token.address,
    });
  }

  /** Keyed by `token.address`. */
  public async getWalletBalances(params: GetBalancesParams<CardanoChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  /** Fee (lovelace) of a typical one-input deposit at current protocol parameters; more spread-out UTXOs pay slightly more. */
  public async estimateGas(_params: EstimateGasParams<CardanoChainKey>): Promise<CardanoGasEstimate> {
    const reserve = parseCardanoAddress(this.chainConfig.addresses.reserve);
    const params = await this.koios.getProtocolParams();
    const minimum = cardanoMinUtxo({ address: reserve.bytes, lovelace: 1_000_000n }, params.coinsPerUtxoByte);
    const built = buildCardanoDeposit({
      utxos: [{ txHash: '0'.repeat(64), index: 0, lovelace: 1_000_000_000_000n }],
      reserveAddress: reserve.bytes,
      changeAddress: new Uint8Array(57),
      amount: minimum > 1_000_000n ? minimum : 1_000_000n,
      memoHex: `0x${'00'.repeat(32)}`,
      params,
      ttlSlot: 0n,
    });
    return { fee: built.body.fee };
  }

  /** Withdraw / borrow (hub→Cardano) via the MPC relay (scheme 7 `signData`); resolves to the `trackingId`. Raw mode is unsupported. */
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

    const request = {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature: fields.signature,
      scheme: getMpcRelayChainInfo(ChainKeys.CARDANO_MAINNET).withdrawScheme,
      cardanoSignData: fields.cardanoSignData,
    };
    const trackingId = await submitFreshWithdrawWithBackoff(async () => {
      const res = await submitWithdraw(this.relayApiUrl, request);
      if (!res.ok) throw res.error;
      return res.value.trackingId;
    });
    return trackingId satisfies string as TxReturnType<CardanoChainKey, Raw>;
  }

  public async getWithdrawalRecord(trackingId: string): Promise<Result<WithdrawalRecord>> {
    return getWithdrawal(this.relayApiUrl, trackingId);
  }

  public async waitForWithdrawal(
    trackingId: string,
    timeout?: number,
    until?: WithdrawalSettledOn,
  ): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      until,
      timeout: Math.max(resolveTimeoutMs(timeout, 0), CARDANO_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /** Notify the relay of a hub tx releasing to Cardano; it has no hub watcher and learns of it only through `/notify`. */
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

  /** Wait until a notified release is paid, re-notifying: the verifier waits on hub confirmations and may drop an early notify. */
  public async waitForHubRelease(release: HubRelease, timeout?: number): Promise<Result<DepositRecord>> {
    const { hubChainId, hubTxHash } = release;
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, hubChainId, hubTxHash, 'withdrawal');
    }, RENOTIFY_INTERVAL_MS);
    try {
      return await waitForHubRelease(this.relayApiUrl, release, {
        timeout: Math.max(resolveTimeoutMs(timeout, 0), CARDANO_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } finally {
      clearInterval(renotify);
    }
  }

  public async getHubReleaseRecord(release: HubRelease): Promise<Result<DepositRecord>> {
    return getDeposit(this.relayApiUrl, toHubReleaseId(release));
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<CardanoChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<CardanoChainKey>>> {
    const txHash = canonicalTxHash(params.txHash);
    const polling = this.chainConfig.pollingConfig;
    const receipt = await pollUntil(
      async (remainingMs): Promise<CardanoRawTransactionReceipt | undefined> => {
        if (remainingMs <= 0) return undefined;
        try {
          const depth = await this.koios.getTxDepth(txHash, remainingMs);
          if (depth !== null) return { tx_hash: txHash, num_confirmations: depth };
        } catch (error) {
          this.config.logger.debug('[CardanoSpokeService.waitForTransactionReceipt] poll error', { error });
        }
        return undefined;
      },
      {
        intervalMs: resolveTimeoutMs(params.pollingIntervalMs, polling.pollingIntervalMs),
        timeoutMs: resolveTimeoutMs(params.maxTimeoutMs, polling.maxTimeoutMs),
      },
    );
    if (receipt) return { ok: true, value: { status: 'success', receipt } };
    return { ok: true, value: { status: 'timeout', error: new Error(`cardano tx ${txHash} not in a block in time`) } };
  }
}
