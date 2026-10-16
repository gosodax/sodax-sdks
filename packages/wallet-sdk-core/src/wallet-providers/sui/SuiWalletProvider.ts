import type { SuiClientTypes } from '@mysten/sui/client';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { TransactionArgument } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import {
  type ISuiWalletProvider,
  type SuiExecutionResult,
  type SuiPaginatedCoins,
  type SuiTransaction,
  toSuiExecutionResult,
  toSuiPaginatedCoins,
} from '@sodax/types';
import { BaseWalletProvider } from '../BaseWalletProvider.js';
import type {
  BrowserExtensionSuiWallet,
  BrowserExtensionSuiWalletConfig,
  PkSuiWallet,
  PrivateKeySuiWalletConfig,
  SuiGetCoinsPolicy,
  SuiSignAndExecutePolicy,
  SuiWallet,
  SuiEndpointConfig,
  SuiWalletConfig,
  SuiWalletDefaults,
} from './types.js';

const DEFAULT_DRY_RUN_ENABLED = true;
const DEFAULT_GET_COINS_LIMIT = 10;

function isPrivateKeySuiWalletConfig(walletConfig: SuiWalletConfig): walletConfig is PrivateKeySuiWalletConfig {
  return 'mnemonics' in walletConfig;
}

function isBrowserExtensionSuiWalletConfig(
  walletConfig: SuiWalletConfig,
): walletConfig is BrowserExtensionSuiWalletConfig {
  return 'signTransaction' in walletConfig && 'address' in walletConfig;
}

export function isPkSuiWallet(wallet: SuiWallet): wallet is PkSuiWallet {
  return 'keyPair' in wallet;
}

/**
 * `rpcUrl` is the pre-gRPC name for the same endpoint. The type union already rejects passing both,
 * so this only catches untyped callers — but it turns a silent wrong-endpoint into a clear error.
 */
export function resolveSuiEndpoint(config: SuiEndpointConfig): string {
  const { grpcUrl, rpcUrl } = config;
  if (grpcUrl && rpcUrl) {
    throw new Error('Sui wallet configuration accepts `grpcUrl` or `rpcUrl`, not both');
  }
  const endpoint = grpcUrl ?? rpcUrl;
  if (!endpoint) {
    throw new Error('Sui wallet configuration requires a gRPC endpoint (`grpcUrl`)');
  }
  return endpoint;
}

export function isBrowserExtensionSuiWallet(wallet: SuiWallet): wallet is BrowserExtensionSuiWallet {
  return 'signTransaction' in wallet;
}

/**
 * Bridge the deliberately-narrow SuiTransaction interface (which only guarantees `toJSON()`)
 * to a concrete Transaction instance. Returns the input directly when it's already a
 * Transaction; otherwise rebuilds via Transaction.from(json).
 */
async function toMystenTransaction(txn: SuiTransaction): Promise<Transaction> {
  if (txn instanceof Transaction) return txn;
  return Transaction.from(await txn.toJSON());
}

export class SuiWalletProvider extends BaseWalletProvider<SuiWalletDefaults> implements ISuiWalletProvider {
  public readonly chainType = 'SUI' as const;
  private readonly client: SuiGrpcClient;
  private readonly wallet: SuiWallet;

  constructor(walletConfig: SuiWalletConfig) {
    super(walletConfig.defaults);

    const endpoint = resolveSuiEndpoint(walletConfig);
    // Only mainnet is supported. `network` is not derived from the endpoint because the client
    // reads it for one thing only — the default Move Registry URL — which nothing here uses.
    this.client = new SuiGrpcClient({ network: 'mainnet', baseUrl: endpoint });

    if (isPrivateKeySuiWalletConfig(walletConfig)) {
      this.wallet = { keyPair: Ed25519Keypair.deriveKeypair(walletConfig.mnemonics) };
      return;
    }

    if (isBrowserExtensionSuiWalletConfig(walletConfig)) {
      this.wallet = { address: walletConfig.address, signTransaction: walletConfig.signTransaction };
      return;
    }

    throw new Error('Invalid wallet configuration');
  }

  async getWalletAddress(): Promise<string> {
    return this.getSuiAddress();
  }

  async signAndExecuteTxn(txn: SuiTransaction, options?: SuiSignAndExecutePolicy): Promise<string> {
    const policy = this.mergePolicy('signAndExecuteTxn', options);
    const dryRunEnabled = policy.dryRun?.enabled ?? DEFAULT_DRY_RUN_ENABLED;

    const sender = this.getSuiAddress();
    const tx = await toMystenTransaction(txn);
    const transactionBlock = dryRunEnabled
      ? await this.buildAndDryRunOrThrow(tx, sender)
      : await this.buildOnly(tx, sender);

    if (isPkSuiWallet(this.wallet)) {
      const res = await this.client.core.signAndExecuteTransaction({
        transaction: transactionBlock,
        signer: this.wallet.keyPair,
      });
      return this.assertSuccess(res);
    }

    if (isBrowserExtensionSuiWallet(this.wallet)) {
      // Hand over `tx`, not `txn` — it carries the sender we just dry-ran with.
      const { bytes, signature } = await this.wallet.signTransaction(tx);
      const res = await this.client.core.executeTransaction({
        transaction: fromBase64(bytes),
        signatures: [signature],
      });
      return this.assertSuccess(res);
    }

    throw new Error('Invalid wallet configuration');
  }

  async viewContract(
    tx: Transaction,
    packageId: string,
    module: string,
    functionName: string,
    args: unknown[],
    typeArgs: string[] = [],
  ): Promise<SuiExecutionResult> {
    tx.moveCall({
      target: `${packageId}::${module}::${functionName}`,
      arguments: args as TransactionArgument[],
      typeArguments: typeArgs,
    });

    tx.setSenderIfNotSet(this.getSuiAddress());
    // `checksEnabled: false` is what `devInspectTransactionBlock` did: it lets public non-entry
    // Move functions be called with no gas coin.
    const result = await this.client.core.simulateTransaction({
      transaction: tx,
      include: { commandResults: true },
      checksEnabled: false,
    });

    const command = result.commandResults?.[0];
    if (!command) {
      throw Error(`transaction didn't return any values: ${JSON.stringify(result, null, 2)}`);
    }
    return toSuiExecutionResult(command);
  }

  async getCoins(address: string, token: string, options?: SuiGetCoinsPolicy): Promise<SuiPaginatedCoins> {
    const policy = this.mergePolicy('getCoins', options);
    const limit = policy.limit ?? DEFAULT_GET_COINS_LIMIT;
    const response = await this.client.core.listCoins({ owner: address, coinType: token, limit });
    return toSuiPaginatedCoins(response, token);
  }

  private async buildAndDryRunOrThrow(tx: Transaction, sender: string): Promise<Uint8Array> {
    tx.setSenderIfNotSet(sender);
    const transactionBlock = await tx.build({ client: this.client });
    const result = await this.client.core.simulateTransaction({ transaction: transactionBlock });
    const status = (result.Transaction ?? result.FailedTransaction).status;
    if (!status.success) {
      throw new Error(`Sui transaction pre-flight failed: ${status.error.message}`);
    }
    return transactionBlock;
  }

  private async buildOnly(tx: Transaction, sender: string): Promise<Uint8Array> {
    tx.setSenderIfNotSet(sender);
    return tx.build({ client: this.client });
  }

  private assertSuccess(result: SuiClientTypes.TransactionResult): string {
    const transaction = result.Transaction ?? result.FailedTransaction;
    if (!transaction.status.success) {
      throw new Error(
        `Sui transaction failed on-chain: ${transaction.status.error.message} (digest=${transaction.digest})`,
      );
    }
    return transaction.digest;
  }

  private getSuiAddress(): string {
    if (isPkSuiWallet(this.wallet)) return this.wallet.keyPair.toSuiAddress();
    if (isBrowserExtensionSuiWallet(this.wallet)) return this.wallet.address;
    throw new Error('Invalid wallet configuration');
  }
}
