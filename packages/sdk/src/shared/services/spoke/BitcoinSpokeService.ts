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
    // since we only support mainnet for now, we can hardcode the single bitcoin chain config
    const chainConfig = config.getChainConfig(ChainKeys.BITCOIN_MAINNET);
    this.rpcUrl = chainConfig.rpcUrl;
    // Pass the client-side RadFi signer (if any) so server-to-server callers can attach Bound's
    // `x-api-signature` HMAC header. `config.radfiSigner` is undefined for browser callers. See gh-831.
    this.radfi = new RadfiProvider(chainConfig.radfi, { signer: config.radfiSigner });
    this.walletMode = chainConfig.radfi.walletMode ?? 'TRADING';
    this.pollingIntervalMs = chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = chainConfig.pollingConfig.maxTimeoutMs;
  }

  public getBtcNetwork(chainId: BitcoinChainKey): networks.Network {
    return this.config.getChainConfig(chainId).network === 'MAINNET' ? networks.bitcoin : networks.testnet;
  }

  public async getBalance(tokenAddress: string, walletAddress: string): Promise<bigint> {
    // For native BTC (empty token address or special marker)
    if (!tokenAddress || tokenAddress === '0x' || tokenAddress === 'BTC') {
      const utxos = await this.fetchUTXOs(walletAddress);
      const totalBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
      return BigInt(totalBalance);
    }
    throw new Error('Token balance queries not yet implemented for non-BTC assets');
  }

  /**
   * Get the user's own wallet balance of a token on Bitcoin, in satoshis. Only native BTC is
   * readable (summed from confirmed/unconfirmed UTXOs). Non-native spoke tokens are Rune ids
   * (`block:tx`), whose amounts the Esplora UTXO endpoint does not carry, so they resolve to 0n.
   * @param {GetBalanceParams<BitcoinChainKey>} params - The chain key, user address, and token.
   * @returns {Promise<bigint>} The balance in satoshis.
   */
  public async getWalletBalance(params: GetBalanceParams<BitcoinChainKey>): Promise<bigint> {
    const { srcChainKey, srcAddress, token } = params;

    if (isNativeToken(srcChainKey, token)) {
      const utxos = await this.fetchUTXOs(srcAddress);
      return BigInt(utxos.reduce((sum, utxo) => sum + utxo.value, 0));
    }

    return 0n;
  }

  /**
   * Get the user's own wallet balances of multiple tokens on Bitcoin, in satoshis.
   * @param {GetBalancesParams<BitcoinChainKey>} params - The chain key, user address, and tokens.
   * @returns {Promise<WalletBalanceMap>} A map of token address to balance in smallest units.
   */
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

  /**
   * Get the effective wallet address for hub wallet derivation and relay submission.
   * In TRADING mode, returns the trading wallet address (not the personal wallet).
   * This must be used everywhere a wallet address is needed for hub interaction.
   */
  public async getEffectiveWalletAddress(personalAddress: string): Promise<string> {
    if (this.walletMode === 'TRADING') {
      // The trading-wallet lookup is a public GET — no access token required.
      const tradingWallet = await this.radfi.getTradingWallet(personalAddress);
      return tradingWallet.tradingAddress;
    }
    return personalAddress;
  }

  /**
   * Get the effective wallet address for hub wallet derivation and relay submission.
   * In TRADING mode, returns the trading wallet address (not the personal wallet).
   * This must be used everywhere a wallet address is needed for hub interaction.
   */
  public async getTradingWalletAddress(personalAddress: string): Promise<string> {
    const tradingWallet = await this.radfi.getTradingWallet(personalAddress);
    return tradingWallet.tradingAddress;
  }

  /**
   * Get current fee rate estimate
   */
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

  /**
   * Estimate transaction fee for a Bitcoin transaction
   *
   * @param {Hex} rawTx - The raw transaction parameters
   * @param {string} rpcUrl - The RPC URL
   * @returns {Promise<bigint>} Estimated fee in satoshis
   */
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

  /**
   * Get the balance of deposited tokens in the asset manager
   *
   * @param {string} token - Token identifier ('BTC' for native Bitcoin)
   * @param {BitcoinSpokeProviderType} spokeProvider - The Bitcoin spoke provider
   * @returns {Promise<bigint>} Balance in satoshis
   */
  public async getDeposit(params: GetDepositParams<BitcoinChainKey>): Promise<bigint> {
    const assetManagerAddress = this.config.getChainConfig(params.srcChainKey).addresses.assetManager;
    const utxos = await this.fetchUTXOs(assetManagerAddress);
    const totalBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0);

    return BigInt(totalBalance);
  }

  /**
   * Fund the Bound Exchange trading wallet by sending BTC from the user's personal wallet
   *
   * @param {bigint} amount - Amount in satoshis to send
   * @param {BitcoinSpokeProvider} spokeProvider - The Bitcoin spoke provider (must have signing capability)
   * @returns {Promise<string>} Transaction ID of the funding transaction
   */
  public async fundTradingWallet(
    amount: bigint,
    walletAddress: string,
    walletProvider: IBitcoinWalletProvider,
  ): Promise<string> {
    const { tradingAddress } = await this.radfi.getTradingWallet(walletAddress);

    return walletProvider.sendBitcoin(tradingAddress, amount);
  }

  /**
   * Send a message to the hub chain
   *
   * @param {BitcoinChainKey} srcChainKey - Source spoke chain key
   * @param {HubChainKey} dstChainKey - Destination chain key
   * @param {HubAddress} dstAddress - Destination address on hub
   * @param {Hex} payload - Message payload
   * @param {BitcoinSpokeProviderType} spokeProvider - The Bitcoin spoke provider
   * @param {boolean} raw - Whether to return raw PSBT or transaction hash
   * @returns {Promise<TxReturnType<BitcoinSpokeProviderType, R>>} Transaction hash or raw PSBT
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<BitcoinChainKey, Raw> & { walletMode?: WalletMode },
  ): Promise<TxReturnType<BitcoinChainKey, Raw>> {
    return (await this.encodeWithdrawalData(params)) satisfies TxReturnType<BitcoinChainKey, Raw>;
  }

  /**
   * Build the relay submit/poll identity for an on-demand action (borrow/withdraw).
   *
   * Bitcoin borrow/withdraw are on-demand: there is no broadcast transaction — the spoke result is
   * the signed payload JSON produced by {@link encodeWithdrawalData}/{@link sendMessage}. The relay
   * accepts the submit under the literal `withdraw` tx_hash with the signed payload (as a JSON object)
   * in `data`, then tracks the resulting packet under a derived id: `od:` + keccak256 of the ASCII
   * `payload_hex` string (hash the hex characters, not the decoded bytes). Polling must use that
   * derived id (`pollTxHash`), not `withdraw`.
   *
   * @param tx - The JSON-stringified signed payload returned by `sendMessage` / `encodeWithdrawalData`.
   */
  public getOnDemandRelayIdentity(tx: string): { srcTxHash: string; data: OnDemandRelayData; pollTxHash: string } {
    const data = JSON.parse(tx) as OnDemandRelayData;
    const payloadHex = data.payload_hex.startsWith('0x') ? data.payload_hex.slice(2) : data.payload_hex;
    const pollTxHash = `od:${keccak256(stringToBytes(payloadHex)).slice(2)}`;
    return { srcTxHash: 'withdraw', data, pollTxHash };
  }

  /**
   * Build a priority Bitcoin transaction with proper fee calculation
   */
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

    // ---- Add inputs ----
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
        // Legacy P2PKH fallback
        const txHex = await this.fetchRawTransaction(utxo.txid);
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          nonWitnessUtxo: Buffer.from(txHex, 'hex'),
        });
      }

      inputSum += utxo.value;

      // Conservative estimate WITHOUT assuming change yet
      const estimatedSize = estimateBitcoinTxSize(psbt.inputCount, outputs.length, addressType, opReturnOutputVbytes);
      const estimatedFee = Math.ceil(effectiveFeeRate * estimatedSize);

      if (inputSum >= outputSum + estimatedFee + DUST_THRESHOLD) {
        break;
      }
    }

    // ---- Add recipient outputs ----
    for (const output of outputs) {
      psbt.addOutput({
        address: output.address,
        value: output.value,
      });
    }

    // ---- Final fee & change calculation ----
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

    // ---- Add change only if it makes sense ----
    if (change > DUST_THRESHOLD) {
      psbt.addOutput({
        address: changeAddress,
        value: change,
      });
    } else {
      // Drop change, recompute fee without it
      const finalFee = feeWithoutChange;
      change = inputSum - outputSum - finalFee;

      if (change < 0) {
        throw new Error(`Insufficient funds after dust handling. Need ${outputSum + finalFee}`);
      }
    }

    return psbt;
  }

  /**
   * Deposit operation - transfer BTC to the asset manager
   */
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

      // ───────────────── Trading wallet flow ─────────────────
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
            // Forward the relay identity ({ hub wallet address, full payload }) so the Bound Exchange
            // backend can auto-resubmit the intent relay if it gets stuck. `to` is the hub wallet
            // (relayData.address) and `data` is the full payload (relayData.payload) — the same pair
            // feature services return as `relayData` from createIntent()/supply().
            relayData: { address: params.to, payload: data },
          },
          accessToken,
        )) satisfies TxReturnType<BitcoinChainKey, false> as TxReturnType<BitcoinChainKey, Raw>;
      }

      // ───────────────── Normal deposit flow ─────────────────
      // Bitcoin PSBT construction requires walletProvider even for raw mode (address derivation)
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
   * Sign and submit a TRADING-wallet raw transaction — the Bound-built *unsigned* PSBT returned by
   * `deposit({ raw: true })` / the Swaps API (`createIntent().tx.data`). Signs it with the wallet
   * provider's key, then sends it to Bound Exchange to co-sign with the second 2-of-2 key and
   * broadcast. Returns the broadcast tx id.
   *
   * This is the client-side completion of the TRADING deposit flow: the backend builds the PSBT
   * (it can't broadcast — the user's signature is missing), the client signs here, and Bound
   * co-signs + broadcasts. `relayData` ({ address, payload }) is the relay identity returned by
   * `createIntent()`; forwarding it lets Bound auto-resubmit a stuck relay. It is **not** recoverable
   * from `rawTx` (whose `to` is the asset manager, not the hub wallet), so callers must supply it.
   *
   * @throws if the chain is not in `TRADING` wallet mode (raw txs only exist in TRADING mode).
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
    // Bitcoin is the one chain whose Swaps API raw tx isn't schema-validated upstream (it hits the
    // permissive `AnyRawTxSchema`), so guard the fields this flow depends on before signing.
    if (!rawTx?.data || !rawTx?.from) {
      throw new Error('signAndSubmitRawTransaction: rawTx.data (PSBT) and rawTx.from are required.');
    }
    const signedTx = await walletProvider.signTransaction(rawTx.data, false);
    const signedBase64Tx = normalizePsbtToBase64(signedTx);
    return this.radfi.requestRadfiSignature({ userAddress: rawTx.from, signedBase64Tx, relayData }, accessToken);
  }

  /**
   * Build deposit PSBT with embedded cross-chain data
   */
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

  /**
   * Fetch UTXOs for an address
   */
  public async fetchUTXOs(address: string): Promise<BitcoinUTXO[]> {
    const response = await fetch(`${this.rpcUrl}/address/${address}/utxo`);
    if (!response.ok) {
      throw new Error(`Failed to fetch UTXOs: ${response.statusText}`);
    }
    return await response.json();
  }

  /**
   * Returns the set of "txid:vout" outpoints currently being spent by
   * unconfirmed transactions in the mempool for the given address.
   * Used to prevent double-spend when building a new PSBT.
   */
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

  /**
   * Fetch raw transaction hex
   */
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
      // No fallback to the personal address: in TRADING mode the relay derives the hub wallet from
      // the trading address, so a failed lookup must throw rather than emit a payload whose
      // src_address (personal) disagrees with that trading-derived hub wallet.
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

    // Pick the message-signing scheme by address type (see usesBip322MessageSigning): P2WPKH/P2TR
    // sign via BIP322, P2SH/P2PKH via ECDSA — browser wallets reject the other scheme per type.
    // The relay expects the signature as base64 (the wallets' native form) plus the signer's
    // public key, which it needs to verify BIP322 (Taproot/Schnorr is not public-key-recoverable).
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

  /**
   * Sign and broadcast a Bitcoin transaction
   */
  public async signAndBroadcastTransaction(
    psbt: Psbt | string,
    walletProvider: IBitcoinWalletProvider,
  ): Promise<string> {
    const psbtBase64 = typeof psbt === 'string' ? psbt : psbt.toBase64();

    // Pass finalize=false so all wallet types (private key, browser extension) return
    // a signed PSBT rather than an extracted raw tx — we handle finalization here.
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

  /**
   * Broadcast a signed transaction
   */
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
          // Transaction exists but not yet confirmed — keep polling
        }
        // 404 or other status — not yet seen, keep polling
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
