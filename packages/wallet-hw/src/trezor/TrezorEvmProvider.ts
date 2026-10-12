import {
  type Hex,
  type TransactionSerializable,
  type TransactionSerializableEIP1559,
  hashDomain,
  hashStruct,
  numberToHex,
} from 'viem';
import TrezorConnect from '@trezor/connect-web';
import { BaseEvmHwProvider, type EvmTypedData, prefix0x } from '../shared/BaseEvmHwProvider.js';

type SignTypedDataParams = Parameters<typeof TrezorConnect.ethereumSignTypedData>[0];
type SignTransactionParams = Parameters<typeof TrezorConnect.ethereumSignTransaction>[0];

/**
 * EIP-1193 provider backed by a Trezor device over `@trezor/connect-web`.
 *
 * `TrezorConnect.init()` is performed once by the connector before any signing.
 * Each signing call drives the Trezor-hosted popup (`connect.trezor.io`).
 */
export class TrezorEvmProvider extends BaseEvmHwProvider {
  protected async signTransactionToSerialized(serializable: TransactionSerializable): Promise<Hex> {
    const transaction =
      serializable.type === 'legacy'
        ? {
            to: serializable.to ?? null,
            value: numberToHex(serializable.value ?? 0n),
            gasPrice: numberToHex(serializable.gasPrice ?? 0n),
            gasLimit: numberToHex(serializable.gas ?? 0n),
            nonce: numberToHex(serializable.nonce ?? 0),
            chainId: serializable.chainId ?? this.chainId,
            data: serializable.data,
          }
        : ((t: TransactionSerializableEIP1559) => ({
            to: t.to ?? null,
            value: numberToHex(t.value ?? 0n),
            gasLimit: numberToHex(t.gas ?? 0n),
            nonce: numberToHex(t.nonce ?? 0),
            chainId: t.chainId,
            data: t.data,
            maxFeePerGas: numberToHex(t.maxFeePerGas ?? 0n),
            maxPriorityFeePerGas: numberToHex(t.maxPriorityFeePerGas ?? 0n),
          }))(serializable as TransactionSerializableEIP1559);

    const result = await TrezorConnect.ethereumSignTransaction({
      path: this.derivationPath,
      transaction,
    } as SignTransactionParams);
    if (!result.success) throw new Error(`[wallet-hw] Trezor failed to sign transaction: ${result.payload.error}`);
    // Trezor returns a fully-signed, EIP-155/EIP-1559-correct serialized tx.
    return prefix0x(result.payload.serializedTx);
  }

  protected async signPersonalMessage(messageHex: Hex): Promise<Hex> {
    const result = await TrezorConnect.ethereumSignMessage({
      path: this.derivationPath,
      message: messageHex.slice(2),
      hex: true,
    });
    if (!result.success) throw new Error(`[wallet-hw] Trezor failed to sign message: ${result.payload.error}`);
    return prefix0x(result.payload.signature);
  }

  protected async signTypedData(typedData: EvmTypedData): Promise<Hex> {
    // Provide both the typed data (for on-device display on Model T / Safe) and the
    // precomputed hashes (required by older firmware) for maximum compatibility.
    const domainSeparatorHash = hashDomain({ domain: typedData.domain, types: typedData.types });
    const messageHash =
      typedData.primaryType === 'EIP712Domain'
        ? domainSeparatorHash
        : hashStruct({ data: typedData.message, primaryType: typedData.primaryType, types: typedData.types });
    const result = await TrezorConnect.ethereumSignTypedData({
      path: this.derivationPath,
      data: typedData,
      metamask_v4_compat: true,
      domain_separator_hash: domainSeparatorHash,
      message_hash: messageHash,
    } as unknown as SignTypedDataParams);
    if (!result.success) throw new Error(`[wallet-hw] Trezor failed to sign typed data: ${result.payload.error}`);
    return prefix0x(result.payload.signature);
  }
}
