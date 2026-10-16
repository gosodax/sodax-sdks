import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { keccak256 } from 'viem';
import { AssetManagerPDA, ConnectionConfigPDA } from '../../entities/solana/pda/pda.js';
import {
  convertTransactionInstructionToRaw,
  getAssetManagerProgram,
  getConnectionProgram,
  isSolanaNativeToken,
} from '../../entities/solana/utils/utils.js';
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
import {
  getIntentRelayChainId,
  isNativeToken,
  ChainKeys,
  type SolanaAccountMeta,
  type SolanaBase58PublicKey,
  type SolanaChainKey,
  type SolanaRawTransactionInstruction,
  type SolanaRawTransactionReceipt,
  type SolanaRpcResponseAndContext,
  type SolanaSerializedTransaction,
  type SolanaTokenAmount,
  type SolanaGasEstimate,
  type TxReturnType,
  type Result,
} from '@sodax/types';
import BN from 'bn.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

export class SolanaSpokeService {
  private readonly config: ConfigService;
  private readonly rpcUrl: string;
  public readonly connection: Connection;
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;

  public constructor(config: ConfigService) {
    this.config = config;
    const chainConfig = config.getChainConfig(ChainKeys.SOLANA_MAINNET);
    this.rpcUrl = chainConfig.rpcUrl;
    this.connection = new Connection(this.rpcUrl, 'confirmed');
    this.pollingIntervalMs = chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = chainConfig.pollingConfig.maxTimeoutMs;
  }

  /**
   * Estimate the gas for a transaction.
   * @param {SolanaRawTransaction} rawTx - The raw transaction to estimate the gas for.
   * @param {SolanaSpokeProviderType} spokeProvider - The provider for the spoke chain.
   * @returns {Promise<number | undefined>} The units consumed for the transaction.
   */
  public async estimateGas(params: EstimateGasParams<SolanaChainKey>): Promise<SolanaGasEstimate> {
    const connection = new Connection(this.rpcUrl, 'confirmed');

    const serializedTxBytes = Buffer.from(params.tx.data, 'base64');
    const versionedTx = VersionedTransaction.deserialize(serializedTxBytes);

    const { value } = await connection.simulateTransaction(versionedTx);

    if (value.err) {
      throw new Error(`Failed to simulate transaction: ${JSON.stringify(value.err, null, 2)}`);
    }

    return value.unitsConsumed;
  }

  /**
   * Transfers tokens to the hub chain by depositing into spoke chain asset maanger.
   * @param {DepositParams<SolanaChainKey, R>} params - The parameters for the transfer, including:
   * @returns {Promise<TxReturnType<SolanaChainKey, R>>} A promise that resolves to the transaction hash.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<SolanaChainKey, R>,
  ): Promise<TxReturnType<SolanaChainKey, R>> {
    const token = new PublicKey(params.token);
    const recipient = params.to;
    const amount = params.amount.toString();
    const data = keccak256(params.data);

    let depositInstruction: TransactionInstruction;
    const amountBN = new BN(amount);
    const chainConfig = this.config.getChainConfig(params.srcChainKey);
    const { rpcUrl, addresses } = chainConfig;
    const walletAddress = params.srcAddress;
    const walletPublicKey = new PublicKey(walletAddress);

    const assetManagerProgram = await getAssetManagerProgram(walletAddress, rpcUrl, addresses.assetManager);
    const connectionProgram = await getConnectionProgram(walletAddress, rpcUrl, addresses.connection);

    if (isSolanaNativeToken(token)) {
      depositInstruction = await assetManagerProgram.methods
        .transfer(amountBN, Buffer.from(recipient.slice(2), 'hex'), Buffer.from(data.slice(2), 'hex'))
        .accountsStrict({
          signer: walletPublicKey,
          systemProgram: SystemProgram.programId,
          config: AssetManagerPDA.config(assetManagerProgram.programId).pda,
          nativeVaultAccount: AssetManagerPDA.vault_native(assetManagerProgram.programId).pda,
          tokenVaultAccount: null,
          signerTokenAccount: null,
          authority: AssetManagerPDA.authority(assetManagerProgram.programId).pda,
          mint: null,
          connection: connectionProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          {
            pubkey: ConnectionConfigPDA.config(connectionProgram.programId).pda,
            isSigner: false,
            isWritable: true,
          },
        ])
        .instruction();
    } else {
      // The asset manager receives the token program as an account, so the ATA derivation and the
      // `tokenProgram` account must both match the mint's owning program (legacy SPL Token vs
      // Token-2022, e.g. xStock tokens like CRCLx).
      const tokenProgramId = await SolanaSpokeService.getMintTokenProgramId(this.connection, token);
      const signerTokenAccount = await SolanaSpokeService.getAssociatedTokenAddress(
        token.toBase58(),
        walletAddress,
        tokenProgramId,
      );
      depositInstruction = await assetManagerProgram.methods
        .transfer(amountBN, Buffer.from(recipient.slice(2), 'hex'), Buffer.from(data.slice(2), 'hex'))
        .accountsStrict({
          signer: walletPublicKey,
          systemProgram: SystemProgram.programId,
          config: AssetManagerPDA.config(assetManagerProgram.programId).pda,
          nativeVaultAccount: null,
          tokenVaultAccount: AssetManagerPDA.vault_token(assetManagerProgram.programId, token).pda,
          signerTokenAccount: signerTokenAccount,
          authority: AssetManagerPDA.authority(assetManagerProgram.programId).pda,
          mint: token,
          connection: connectionProgram.programId,
          tokenProgram: tokenProgramId,
        })
        .remainingAccounts([
          {
            pubkey: ConnectionConfigPDA.config(connectionProgram.programId).pda,
            isSigner: false,
            isWritable: true,
          },
        ])
        .instruction();
    }

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });

    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 0,
    });

    const rawInstructions = [
      convertTransactionInstructionToRaw(modifyComputeUnits),
      convertTransactionInstructionToRaw(addPriorityFee),
      convertTransactionInstructionToRaw(depositInstruction),
    ];

    if (params.raw === true) {
      const unsignedTx = await this.buildV0Txn(walletAddress, rawInstructions);
      return {
        from: walletPublicKey.toBase58(),
        to: assetManagerProgram.programId.toBase58(),
        value: BigInt(amountBN.toString()),
        data: Buffer.from(unsignedTx).toString('base64'),
      } satisfies TxReturnType<SolanaChainKey, true> as TxReturnType<SolanaChainKey, R>;
    }

    const signedTx = await params.walletProvider.buildV0Txn(rawInstructions);
    return params.walletProvider.sendTransaction(signedTx) satisfies Promise<
      TxReturnType<SolanaChainKey, false>
    > as Promise<TxReturnType<SolanaChainKey, R>>;
  }

  public async getDeposit(params: GetDepositParams<SolanaChainKey>): Promise<bigint> {
    const assetManagerProgramId = new PublicKey(this.config.getChainConfig(params.srcChainKey).addresses.assetManager);
    const solToken = new PublicKey(params.token);

    if (isSolanaNativeToken(new PublicKey(solToken))) {
      const vaultNative = AssetManagerPDA.vault_native(assetManagerProgramId);
      const balance = await SolanaSpokeService.getBalance(this.connection, vaultNative.pda.toBase58());
      return BigInt(balance);
    }

    const vaultToken = AssetManagerPDA.vault_token(assetManagerProgramId, new PublicKey(solToken));
    const tokenAccount = await SolanaSpokeService.getTokenAccountBalance(this.connection, vaultToken.pda.toBase58());

    return BigInt(tokenAccount.value.amount);
  }

  /**
   * Get the user's own wallet balance of a token on Solana, in smallest units. Native SOL via
   * `getBalance`; SPL via the associated token account. The mint may belong to the legacy SPL
   * Token program or Token-2022 (e.g. xStock tokens), which derive different ATAs, so both
   * candidate ATAs are read in one call and the existing one is used.
   * @param {GetBalanceParams<SolanaChainKey>} params - The chain key, user address, and token.
   * @returns {Promise<bigint>} The token balance in smallest units.
   */
  public async getWalletBalance(params: GetBalanceParams<SolanaChainKey>): Promise<bigint> {
    const { srcChainKey, srcAddress, token } = params;

    if (isNativeToken(srcChainKey, token)) {
      return BigInt(await SolanaSpokeService.getBalance(this.connection, srcAddress));
    }

    const owner = new PublicKey(srcAddress);
    const mint = new PublicKey(token.address);

    const candidates = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map(programId => ({
      programId,
      ata: getAssociatedTokenAddressSync(mint, owner, true, programId),
    }));

    const accounts = await this.connection.getMultipleAccountsInfo(candidates.map(c => c.ata));

    // A mint is owned by exactly one program, so normally only one ATA exists. Summing (and
    // skipping anything that isn't a token account for that program) stays correct even if a
    // stray account sits at the other candidate address.
    let balance = 0n;
    for (const [i, candidate] of candidates.entries()) {
      const info = accounts[i];
      if (!info) continue;
      try {
        balance += unpackAccount(candidate.ata, info, candidate.programId).amount;
      } catch {
        // Not a token account for this program — ignore it.
      }
    }
    return balance;
  }

  /**
   * Get the user's own wallet balances of multiple tokens on Solana, in smallest units.
   * @param {GetBalancesParams<SolanaChainKey>} params - The chain key, user address, and tokens.
   * @returns {Promise<WalletBalanceMap>} A map of token address to balance in smallest units.
   */
  public async getWalletBalances(params: GetBalancesParams<SolanaChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token =>
      this.getWalletBalance({ srcChainKey, srcAddress, token }),
    );
    return collector.finish();
  }

  /**
   * Sends a message to the hub chain.
   * @param dstChainKey - The chain key of the hub chain.
   * @param dstAddress - The address on the hub chain.
   * @param payload - The payload to send.
   * @param spokeProvider - The spoke provider.
   * @param raw - Whether to return the raw transaction data.
   * @returns The transaction result.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<SolanaChainKey, Raw>,
  ): Promise<TxReturnType<SolanaChainKey, Raw>> {
    const dstRelayChainId = getIntentRelayChainId(params.dstChainKey);
    const payload = keccak256(params.payload);
    const chainConfig = this.config.getChainConfig(params.srcChainKey);
    const { rpcUrl, addresses } = chainConfig;
    const walletAddress = params.srcAddress;
    const walletPublicKey = new PublicKey(walletAddress);

    const connectionProgram = await getConnectionProgram(params.srcAddress, rpcUrl, addresses.connection);

    const sendMessageInstruction = await connectionProgram.methods
      .sendMessage(
        new BN(dstRelayChainId.toString()),
        Buffer.from(params.dstAddress.slice(2), 'hex'),
        Buffer.from(payload.slice(2), 'hex'),
      )
      .accountsStrict({
        signer: walletPublicKey,
        dapp: null,
        config: ConnectionConfigPDA.config(connectionProgram.programId).pda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1000000,
    });

    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 0,
    });

    const rawInstructions = [
      convertTransactionInstructionToRaw(modifyComputeUnits),
      convertTransactionInstructionToRaw(addPriorityFee),
      convertTransactionInstructionToRaw(sendMessageInstruction),
    ];

    if (params.raw === true) {
      const unsignedTx = await this.buildV0Txn(walletAddress, rawInstructions);
      return {
        from: walletPublicKey.toBase58(),
        to: connectionProgram.programId.toBase58(),
        value: 0n,
        data: Buffer.from(unsignedTx).toString('base64'),
      } satisfies TxReturnType<SolanaChainKey, true> as TxReturnType<SolanaChainKey, Raw>;
    }

    const signedTx = await params.walletProvider.buildV0Txn(rawInstructions);
    return params.walletProvider.sendTransaction(signedTx) satisfies Promise<
      TxReturnType<SolanaChainKey, false>
    > as Promise<TxReturnType<SolanaChainKey, Raw>>;
  }

  // Builds an unsigned, serialized v0 transaction for raw-mode callers who will sign and broadcast it themselves.
  // The non-raw path uses walletProvider.buildV0Txn(...) instead, which signs the tx (prompting the user in adapter mode).
  public async buildV0Txn(
    from: SolanaBase58PublicKey,
    rawInstructions: SolanaRawTransactionInstruction[],
  ): Promise<SolanaSerializedTransaction> {
    const instructions = SolanaSpokeService.buildTransactionInstruction(rawInstructions);

    const messageV0 = new TransactionMessage({
      payerKey: new PublicKey(from),
      recentBlockhash: (await this.connection.getLatestBlockhash()).blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);

    return tx.serialize();
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<SolanaChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<SolanaChainKey>>> {
    const { txHash, pollingIntervalMs = this.pollingIntervalMs, maxTimeoutMs = this.maxTimeoutMs } = params;
    const deadline = Date.now() + maxTimeoutMs;

    while (Date.now() < deadline) {
      try {
        const tx = await this.connection.getTransaction(txHash, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        if (tx) {
          if (tx.meta?.err) {
            return { ok: true, value: { status: 'failure', error: new Error(JSON.stringify(tx.meta.err)) } };
          }
          return { ok: true, value: { status: 'success', receipt: tx satisfies SolanaRawTransactionReceipt } };
        }
      } catch {
        // ignore transient RPC errors and keep polling
      }
      await sleep(pollingIntervalMs);
    }

    return {
      ok: true,
      value: {
        status: 'timeout',
        error: new Error(`Timed out after ${maxTimeoutMs}ms waiting for confirmation for ${txHash}`),
      },
    };
  }

  public static async getBalance(connection: Connection, publicKey: SolanaBase58PublicKey): Promise<number> {
    return await connection.getBalance(new PublicKey(publicKey));
  }

  public static async getTokenAccountBalance(
    connection: Connection,
    publicKey: SolanaBase58PublicKey,
  ): Promise<SolanaRpcResponseAndContext<SolanaTokenAmount>> {
    return await connection.getTokenAccountBalance(new PublicKey(publicKey));
  }

  /**
   * Resolves the token program that owns a mint (legacy SPL Token vs Token-2022). Falls back to
   * the legacy SPL Token program when the mint account can't be read.
   */
  public static async getMintTokenProgramId(connection: Connection, mint: PublicKey): Promise<PublicKey> {
    const mintAccountInfo = await connection.getAccountInfo(mint);
    return mintAccountInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  }

  public static async getAssociatedTokenAddress(
    mint: SolanaBase58PublicKey,
    walletAddress: SolanaBase58PublicKey,
    tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<SolanaBase58PublicKey> {
    const ata = await getAssociatedTokenAddress(
      new PublicKey(mint),
      new PublicKey(walletAddress),
      true,
      tokenProgramId,
    );
    return ata.toBase58();
  }

  public static buildTransactionInstruction(
    rawInstructions: SolanaRawTransactionInstruction[],
  ): TransactionInstruction[] {
    return rawInstructions.map(
      rawInstruction =>
        new TransactionInstruction({
          keys: rawInstruction.keys.map((key: SolanaAccountMeta) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          programId: new PublicKey(rawInstruction.programId),
          data: Buffer.from(rawInstruction.data),
        }),
    );
  }
}
