import { initEccLib, networks, Transaction, Psbt, payments, opcodes, script } from 'bitcoinjs-lib';
import type {
  BitcoinChainKey,
  BitcoinRawTransaction,
  BitcoinRawTransactionReceipt,
  IBitcoinWalletProvider,
  Result,
  TxReturnType,
} from '@sodax/types';
import type { RelayExtraData } from '../../types/relay-types.js';
import {
  BITCOIN_DUST_SATS,
  ChainKeys,
  detectBitcoinAddressType,
  getIntentRelayChainId,
  isNativeBitcoinToken,
  isNativeToken,
  usesBip322MessageSigning,
} from '@sodax/types';
import * as ecc from '@bitcoinerlab/secp256k1';
import { keccak256, stringToBytes } from 'viem';
import type { OnDemandRelayData } from '../../types/types.js';
import type {
  DepositParams,
  EstimateGasParams,
  GetDepositParams,
  GetBalanceParams,
  GetBalancesParams,
  SendMessageParams,
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
} from '../../types/spoke-types.js';
import { createBalanceCollector, settleWalletBalances, type WalletBalanceMap } from './balance-utils.js';
import type { ConfigService } from '../../config/ConfigService.js';
import { sleep } from '../../utils/shared-utils.js';
import { RadfiProvider } from '../../entities/btc/RadfiProvider.js';
import {
  encodeBtcPayloadToBytes,
  calcOpReturnOutputVbytes,
  estimateBitcoinTxSize,
  normalizePsbtToBase64,
  normalizeSignatureToBase64,
  type BtcPayload,
  type WalletMode,
} from '../../entities/btc/btc-utils.js';
export type { BtcPayload, WalletMode } from '../../entities/btc/btc-utils.js';

initEccLib(ecc);

export type BitcoinUTXO = {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
};

export interface BitcoinTransactionResult {
  txHash: string;
  fee: number;
  size: number;
  virtualSize: number;
}

export interface OnDemandBtcPayload {
  payload_hex: string;
  signature?: string;
  public_key?: string;
}

const BITCOIN_DEFAULT_FEE_RATE = 3;
// UTXO math (bitcoinjs-lib) is number-based; convert the canonical bigint sats value once.
const DUST_THRESHOLD = Number(BITCOIN_DUST_SATS);

export class BitcoinSpokeService {
  private readonly config: ConfigService;
  public readonly rpcUrl: string;
  public readonly radfi: RadfiProvider;
  public readonly walletMode: WalletMode;
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;

  constructor(config: ConfigService) {
    this.config = config;
    // Only mainnet is supported, so the single Bitcoin chain config is used.
    const chainConfig = config.getChainConfig(ChainKeys.BITCOIN_MAINNET);
    this.rpcUrl = chainConfig.rpcUrl;
    // Lets server-to-server callers attach Bound's `x-api-signature` HMAC header; undefined in browsers.
    this.radfi = new RadfiProvider(chainConfig.radfi, { signer: config.radfiSigner });
    this.walletMode = chainConfig.radfi.walletMode ?? 'TRADING';
    this.pollingIntervalMs = chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = chainConfig.pollingConfig.maxTimeoutMs;
  }

  public getBtcNetwork(chainId: BitcoinChainKey): networks.Network {
    return this.config.getChainConfig(chainId).network === 'MAINNET' ? networks.bitcoin : networks.testnet;
  }

  public async getBalance(tokenAddress: string, walletAddress: string): Promise<bigint> {
    if (!tokenAddress || tokenAddress === '0x' || tokenAddress === 'BTC') {
      const utxos = await this.fetchUTXOs(walletAddress);
      const totalBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
      return BigInt(totalBalance);
    }
    throw new Error('Token balance queries not yet implemented for non-BTC assets');
  }

  /** In satoshis; only native BTC is readable — Rune ids (`block:tx`) are not in Esplora UTXOs, so they read 0n. */
  public async getWalletBalance(params: GetBalanceParams<BitcoinChainKey>): Promise<bigint> {
    const { srcChainKey, srcAddress, token } = params;

    if (isNativeToken(srcChainKey, token)) {
      const utxos = await this.fetchUTXOs(srcAddress);
      return BigInt(utxos.reduce((sum, utxo) => sum + utxo.value, 0));
    }

    return 0n;
  }

  public async getWalletBalances(params: GetBalancesParams<BitcoinChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  public async fetchScriptPubKey(utxo: BitcoinUTXO): Promise<string> {
    const txHex = await this.fetchRawTransaction(utxo.txid);
    const tx = Transaction.fromHex(txHex);
    const out = tx.outs[utxo.vout];
    if (!out) {
      throw new Error(`UTXO not found: ${utxo.txid}:${utxo.vout}`);
    }
    return out.script.toString('hex');
  }

  /** The address for hub wallet derivation and relay submission: the trading wallet in TRADING mode. Use it everywhere. */
  public async getEffectiveWalletAddress(personalAddress: string): Promise<string> {
    if (this.walletMode === 'TRADING') {
      const tradingWallet = await this.radfi.getTradingWallet(personalAddress);
      return tradingWallet.tradingAddress;
    }
    return personalAddress;
  }

  /** The trading wallet address for `personalAddress`. */
  public async getTradingWalletAddress(personalAddress: string): Promise<string> {
    const tradingWallet = await this.radfi.getTradingWallet(personalAddress);
    return tradingWallet.tradingAddress;
  }

  public async getFeeRateEstimate(targetBlocks = 6): Promise<number> {
    try {
      const response = await fetch(`${this.rpcUrl}/fee-estimates`);
      if (!response.ok) {
        return BITCOIN_DEFAULT_FEE_RATE;
      }
      const feeEstimates = await response.json();
      return feeEstimates[targetBlocks] ?? BITCOIN_DEFAULT_FEE_RATE;
    } catch {
      return BITCOIN_DEFAULT_FEE_RATE;
    }
  }

  /** Estimated fee in satoshis. */
  public async estimateGas(params: EstimateGasParams<BitcoinChainKey>): Promise<bigint> {
    if (typeof params.tx === 'string') {
      throw new Error('[BitcoinSpokeService.estimateGas] string tx not supported');
    }
    const txBytes = Buffer.from(params.tx.data, 'hex');
    const vsize = Math.ceil(txBytes.length);
    const feeRate = await this.getFeeRateEstimate();
    const feeRateBigInt = typeof feeRate === 'bigint' ? feeRate : BigInt(Math.ceil(feeRate));
    return BigInt(vsize) * feeRateBigInt;
  }

  public async getDeposit(params: GetDepositParams<BitcoinChainKey>): Promise<bigint> {
    const assetManagerAddress = this.config.getChainConfig(params.srcChainKey).addresses.assetManager;
    const utxos = await this.fetchUTXOs(assetManagerAddress);
    const totalBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0);

    return BigInt(totalBalance);
  }

  /** Fund the Bound Exchange trading wallet with BTC from the user's personal wallet; returns the funding txid. */
  public async fundTradingWallet(
    amount: bigint,
    walletAddress: string,
    walletProvider: IBitcoinWalletProvider,
  ): Promise<string> {
    const { tradingAddress } = await this.radfi.getTradingWallet(walletAddress);

    return walletProvider.sendBitcoin(tradingAddress, amount);
  }

  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<BitcoinChainKey, Raw> & { walletMode?: WalletMode },
  ): Promise<TxReturnType<BitcoinChainKey, Raw>> {
    return (await this.encodeWithdrawalData(params)) satisfies TxReturnType<BitcoinChainKey, Raw>;
  }

  /**
   * Relay identity for an on-demand borrow/withdraw (no broadcast tx): submitted as tx_hash `withdraw`, polled under
   * `od:` + keccak256 of the ASCII `payload_hex` string (the hex characters, not the decoded bytes).
   */
  public getOnDemandRelayIdentity(tx: string): { srcTxHash: string; data: OnDemandRelayData; pollTxHash: string } {
    const data = JSON.parse(tx) as OnDemandRelayData;
    const payloadHex = data.payload_hex.startsWith('0x') ? data.payload_hex.slice(2) : data.payload_hex;
    const pollTxHash = `od:${keccak256(stringToBytes(payloadHex)).slice(2)}`;
    return { srcTxHash: 'withdraw', data, pollTxHash };
  }

  public async buildBitcoinTransaction(
    utxos: BitcoinUTXO[],
    outputs: Array<{ address: string; value: number }>,
    changeAddress: string,
    chainId: BitcoinChainKey,
    walletProvider: IBitcoinWalletProvider,
    feeRate?: number,
    opReturnOutputVbytes?: number,
  ): Promise<Psbt> {
    const psbt = new Psbt({ network: this.getBtcNetwork(chainId) });
    const effectiveFeeRate = feeRate ?? (await this.getFeeRateEstimate());
    const walletAddress = await walletProvider.getWalletAddress();
    const addressType = detectBitcoinAddressType(walletAddress);

    let inputSum = 0;
    const outputSum = outputs.reduce((sum, o) => sum + o.value, 0);

    for (const utxo of utxos) {
      if (!utxo.status.confirmed) continue;

      const scriptPubKey = await this.fetchScriptPubKey(utxo);
      const isTaproot = scriptPubKey.startsWith('51');
      const isSegwitV0 = scriptPubKey.startsWith('00');
      const isP2SH = scriptPubKey.startsWith('a9');

      if (isTaproot) {
        if (!walletProvider.getPublicKey) {
          throw new Error('Missing public key for P2TR input');
        }
        const tapInternalKey = await walletProvider.getPublicKey();
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: Buffer.from(scriptPubKey, 'hex'),
            value: utxo.value,
          },
          tapInternalKey: Buffer.from(tapInternalKey, 'hex'),
        });
      } else if (isP2SH) {
        // P2SH-P2WPKH (Nested SegWit): needs witnessUtxo + redeemScript
        if (!walletProvider.getPublicKey) {
          throw new Error('Missing public key for P2SH-P2WPKH input');
        }
        const pubKeyHex = await walletProvider.getPublicKey();
        const redeemScript = payments.p2wpkh({
          pubkey: Buffer.from(pubKeyHex, 'hex'),
          network: this.getBtcNetwork(chainId),
        }).output;
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: Buffer.from(scriptPubKey, 'hex'),
            value: utxo.value,
          },
          redeemScript,
        });
      } else if (isSegwitV0) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: Buffer.from(scriptPubKey, 'hex'),
            value: utxo.value,
          },
        });
      } else {
        const txHex = await this.fetchRawTransaction(utxo.txid);
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          nonWitnessUtxo: Buffer.from(txHex, 'hex'),
        });
      }

      inputSum += utxo.value;

      // Conservative estimate without change yet
      const estimatedSize = estimateBitcoinTxSize(psbt.inputCount, outputs.length, addressType, opReturnOutputVbytes);
      const estimatedFee = Math.ceil(effectiveFeeRate * estimatedSize);

      if (inputSum >= outputSum + estimatedFee + DUST_THRESHOLD) {
        break;
      }
    }

    for (const output of outputs) {
      psbt.addOutput({
        address: output.address,
        value: output.value,
      });
    }

    const sizeWithChange = estimateBitcoinTxSize(
      psbt.inputCount,
      outputs.length + 1,
      addressType,
      opReturnOutputVbytes,
    );
    const sizeWithoutChange = estimateBitcoinTxSize(psbt.inputCount, outputs.length, addressType, opReturnOutputVbytes);

    const feeWithChange = Math.ceil(effectiveFeeRate * sizeWithChange);
    const feeWithoutChange = Math.ceil(effectiveFeeRate * sizeWithoutChange);

    let change = inputSum - outputSum - feeWithChange;

    if (change < 0) {
      const confirmedCount = utxos.filter(u => u.status.confirmed).length;
      const unconfirmedCount = utxos.length - confirmedCount;
      const hint =
        unconfirmedCount > 0 ? ` (${unconfirmedCount} unconfirmed UTXO(s) skipped — wait for confirmation)` : '';
      throw new Error(`Insufficient funds. Need ${outputSum + feeWithChange} satoshis, have ${inputSum}${hint}`);
    }

    if (change > DUST_THRESHOLD) {
      psbt.addOutput({
        address: changeAddress,
        value: change,
      });
    } else {
      const finalFee = feeWithoutChange;
      change = inputSum - outputSum - finalFee;

      if (change < 0) {
        throw new Error(`Insufficient funds after dust handling. Need ${outputSum + finalFee}`);
      }
    }

    return psbt;
  }

  public async deposit<Raw extends boolean = false>(
    params: DepositParams<BitcoinChainKey, Raw>,
  ): Promise<TxReturnType<BitcoinChainKey, Raw>> {
    try {
      const {
        srcChainKey,
        srcAddress: from,
        token,
        amount,
        data = '0x',
        accessToken = this.radfi.accessToken,
      } = params;
      const chainConfig = this.config.getChainConfig(srcChainKey);

      const returnRawTx = (psbtBase64: string): TxReturnType<BitcoinChainKey, Raw> =>
        ({
          from: from,
          to: chainConfig.addresses.assetManager,
          value: amount,
          data: psbtBase64,
        }) satisfies TxReturnType<BitcoinChainKey, true> as TxReturnType<BitcoinChainKey, Raw>;

      if (this.walletMode === 'TRADING') {
        const tokenId = Object.values(chainConfig.supportedTokens).find(t => t.address === token)?.address;

        if (!tokenId) {
          throw new Error(`Unsupported token: ${token}`);
        }

        let hashedData = data.startsWith('0x') ? data.slice(2) : data;
        hashedData = hashedData.length === 64 ? hashedData : keccak256(`0x${hashedData}`).slice(2);

        const withdrawTx = await this.radfi.createWithdrawTransaction(
          {
            token: tokenId,
            amount,
            recipient: chainConfig.addresses.assetManager,
            userAddress: from,
            data: hashedData,
          },
          accessToken,
        );

        if (params.raw === true) {
          return returnRawTx(withdrawTx.base64Psbt);
        }

        const signedTx = await params.walletProvider.signTransaction(withdrawTx.base64Psbt, false);
        const signedBase64Tx = normalizePsbtToBase64(signedTx);

        return (await this.radfi.requestRadfiSignature(
          {
            userAddress: from,
            signedBase64Tx,
            // Lets the Bound Exchange backend auto-resubmit a stuck intent relay (`to` is the hub wallet, `data` the full payload).
            relayData: { address: params.to, payload: data },
          },
          accessToken,
        )) satisfies TxReturnType<BitcoinChainKey, false> as TxReturnType<BitcoinChainKey, Raw>;
      }

      // PSBT construction needs walletProvider even in raw mode (address derivation).
      if (params.raw === true) {
        throw new Error(
          'Raw mode is not supported for normal Bitcoin deposits. Use TRADING wallet mode for raw transactions.',
        );
      }

      const [allUtxos, mempoolSpent] = await Promise.all([
        this.fetchUTXOs(from),
        this.fetchMempoolSpentOutpoints(from),
      ]);

      const utxos = allUtxos.filter(u => !mempoolSpent.has(`${u.txid}:${u.vout}`));

      if (!utxos?.length) {
        throw new Error('No UTXOs available for deposit');
      }

      const depositPsbt = await this.buildDepositPsbt(
        from,
        params.walletProvider,
        srcChainKey,
        token,
        amount,
        data,
        utxos,
      );

      return (await this.signAndBroadcastTransaction(depositPsbt, params.walletProvider)) satisfies TxReturnType<
        BitcoinChainKey,
        false
      > as TxReturnType<BitcoinChainKey, Raw>;
    } catch (error) {
      this.config.logger.error('Error during deposit', error);
      throw error;
    }
  }

  /**
   * Sign a Bound-built unsigned TRADING PSBT (from `deposit({ raw: true })` / Swaps API) and send it to Bound to co-sign
   * and broadcast. `relayData` is not recoverable from `rawTx` (its `to` is the asset manager), so callers must supply it.
   */
  public async signAndSubmitRawTransaction(params: {
    rawTx: BitcoinRawTransaction;
    walletProvider: IBitcoinWalletProvider;
    relayData?: RelayExtraData;
    accessToken?: string;
  }): Promise<string> {
    if (this.walletMode !== 'TRADING') {
      throw new Error('signAndSubmitRawTransaction requires TRADING wallet mode.');
    }
    const { rawTx, walletProvider, relayData, accessToken = this.radfi.accessToken } = params;
    // Bitcoin's Swaps API raw tx hits the permissive `AnyRawTxSchema` upstream, so guard the fields used here.
    if (!rawTx?.data || !rawTx?.from) {
      throw new Error('signAndSubmitRawTransaction: rawTx.data (PSBT) and rawTx.from are required.');
    }
    const signedTx = await walletProvider.signTransaction(rawTx.data, false);
    const signedBase64Tx = normalizePsbtToBase64(signedTx);
    return this.radfi.requestRadfiSignature({ userAddress: rawTx.from, signedBase64Tx, relayData }, accessToken);
  }

  public async buildDepositPsbt(
    walletAddress: string,
    walletProvider: IBitcoinWalletProvider,
    srcChainKey: BitcoinChainKey,
    token: string,
    amount: bigint,
    data: string,
    utxos: BitcoinUTXO[],
  ): Promise<Psbt> {
    const chainConfig = this.config.getChainConfig(srcChainKey);
    const assetManagerAddress = chainConfig.addresses.assetManager;
    const isNativeBtc = isNativeBitcoinToken(chainConfig, token);

    if (isNativeBtc) {
      const OP_RETURN = opcodes.OP_RETURN;
      const OP_12 = opcodes.OP_12;
      if (OP_RETURN === undefined || OP_12 === undefined) {
        throw new Error('bitcoinjs-lib opcodes OP_RETURN or OP_12 are undefined');
      }

      const OP_RADFI_SODAX_DATA = 0x31;
      const payload = Buffer.concat([Buffer.from([OP_RADFI_SODAX_DATA]), Buffer.from(data.slice(2), 'hex')]);
      const opReturnOutputVbytes = calcOpReturnOutputVbytes(payload.length);

      const outputs = [
        {
          address: assetManagerAddress,
          value: Number(amount),
        },
      ];

      const psbt = await this.buildBitcoinTransaction(
        utxos,
        outputs,
        walletAddress,
        srcChainKey,
        walletProvider,
        undefined,
        opReturnOutputVbytes,
      );

      const compiledScript = script.compile([OP_RETURN, OP_12, payload]);

      psbt.addOutput({
        script: compiledScript,
        value: 0,
      });

      return psbt;
    }
    throw new Error(`Non-BTC token deposits not yet implemented (token: ${token})`);
  }

  public async fetchUTXOs(address: string): Promise<BitcoinUTXO[]> {
    const response = await fetch(`${this.rpcUrl}/address/${address}/utxo`);
    if (!response.ok) {
      throw new Error(`Failed to fetch UTXOs: ${response.statusText}`);
    }
    return await response.json();
  }

  /** `txid:vout` outpoints spent by unconfirmed mempool txs, excluded to avoid double-spends. */
  private async fetchMempoolSpentOutpoints(address: string): Promise<Set<string>> {
    try {
      const response = await fetch(`${this.rpcUrl}/address/${address}/txs/mempool`);
      if (!response.ok) return new Set();
      const mempoolTxs: Array<{ vin: Array<{ txid: string; vout: number }> }> = await response.json();
      const spent = new Set<string>();
      for (const tx of mempoolTxs) {
        for (const input of tx.vin) {
          spent.add(`${input.txid}:${input.vout}`);
        }
      }
      return spent;
    } catch {
      return new Set();
    }
  }

  public async fetchRawTransaction(txid: string): Promise<string> {
    const response = await fetch(`${this.rpcUrl}/tx/${txid}/hex`);
    if (!response.ok) {
      throw new Error(`Failed to fetch transaction: ${response.statusText}`);
    }
    return await response.text();
  }

  public async encodeWithdrawalData<Raw extends boolean>(
    params: SendMessageParams<BitcoinChainKey, Raw> & { walletMode?: WalletMode },
  ): Promise<TxReturnType<BitcoinChainKey, Raw>> {
    const { srcAddress: from, srcChainKey, dstChainKey, payload: data, walletMode = 'TRADING' } = params;
    let srcAddress = from;
    const addressType = detectBitcoinAddressType(from);

    if (walletMode === 'TRADING') {
      // No personal-address fallback: the relay derives the hub wallet from the trading address, so a mismatched
      // src_address must throw instead.
      srcAddress = (await this.radfi.getTradingWallet(srcAddress)).tradingAddress;
    }
    const payload: BtcPayload = {
      src_address: srcAddress,
      data: data,
      src_chain_id: Number(getIntentRelayChainId(srcChainKey)),
      dst_chain_id: Number(getIntentRelayChainId(dstChainKey)),
      wallet_used: this.walletMode,
      timestamp: Date.now(),
      address_type: addressType,
    };
    const orderedPayload = encodeBtcPayloadToBytes(payload);

    const onDemandWithdraw: OnDemandBtcPayload = {
      payload_hex: Buffer.from(orderedPayload).toString('hex'),
      signature: undefined,
    };

    if (params.raw === true) {
      return JSON.stringify(onDemandWithdraw) satisfies TxReturnType<BitcoinChainKey, true> as TxReturnType<
        BitcoinChainKey,
        Raw
      >;
    }

    // P2WPKH/P2TR sign via BIP322, P2SH/P2PKH via ECDSA (wallets reject the other). The relay needs base64 plus the
    // public key, since BIP322/Taproot signatures are not public-key-recoverable.
    if (!params.walletProvider.getPublicKey) {
      throw new Error('Wallet provider does not support getPublicKey');
    }
    const rawSignature = usesBip322MessageSigning(addressType)
      ? await params.walletProvider.signBip322Message(orderedPayload)
      : await params.walletProvider.signEcdsaMessage(orderedPayload);
    onDemandWithdraw.signature = normalizeSignatureToBase64(rawSignature);
    onDemandWithdraw.public_key = await params.walletProvider.getPublicKey();

    return JSON.stringify(onDemandWithdraw) satisfies TxReturnType<BitcoinChainKey, false> as TxReturnType<
      BitcoinChainKey,
      Raw
    >;
  }

  public async signAndBroadcastTransaction(
    psbt: Psbt | string,
    walletProvider: IBitcoinWalletProvider,
  ): Promise<string> {
    const psbtBase64 = typeof psbt === 'string' ? psbt : psbt.toBase64();

    // finalize=false so every wallet type returns a signed PSBT; finalization happens here.
    const signedRaw = await walletProvider.signTransaction(psbtBase64, false);
    // Unisat/OKX return hex, Xverse/private-key return base64 — normalize before parsing
    const signedPsbt = Psbt.fromBase64(normalizePsbtToBase64(signedRaw));

    // Some wallets finalize inputs internally regardless of the flag; skip if already done
    try {
      signedPsbt.finalizeAllInputs();
    } catch {
      // inputs already finalized by wallet
    }

    const txHex = signedPsbt.extractTransaction().toHex();
    const txHash = await this.broadcastTransaction(txHex);

    return txHash;
  }

  private async broadcastTransaction(txHex: string): Promise<string> {
    const response = await fetch(`${this.rpcUrl}/tx`, {
      method: 'POST',
      body: txHex,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to broadcast transaction: ${errorText}`);
    }

    return await response.text();
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<BitcoinChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<BitcoinChainKey>>> {
    const { txHash, pollingIntervalMs = this.pollingIntervalMs, maxTimeoutMs = this.maxTimeoutMs } = params;
    const deadline = Date.now() + maxTimeoutMs;

    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${this.rpcUrl}/tx/${txHash}`);
        if (response.ok) {
          const result = await response.json();
          if (result.status?.confirmed) {
            return { ok: true, value: { status: 'success', receipt: result satisfies BitcoinRawTransactionReceipt } };
          }
        }
      } catch {
        // transient error — retry
      }
      await sleep(pollingIntervalMs);
    }

    return {
      ok: true,
      value: {
        status: 'timeout',
        error: new Error(`Timed out after ${maxTimeoutMs}ms waiting for Bitcoin transaction ${txHash}`),
      },
    };
  }
}
