import { type Hex, type TransactionSerializable, hashDomain, hashStruct } from 'viem';
import type Eth from '@ledgerhq/hw-app-eth';
import {
  BaseEvmHwProvider,
  type BaseEvmHwProviderOptions,
  type EvmTypedData,
  prefix0x,
  strip0x,
} from '../shared/BaseEvmHwProvider.js';

export type LedgerEvmProviderOptions = BaseEvmHwProviderOptions & {
  /** Connected `@ledgerhq/hw-app-eth` instance. */
  eth: Eth;
};

/**
 * EIP-1193 provider backed by a Ledger device over `@ledgerhq/hw-app-eth`.
 * Transaction blind-signs (`resolution: null`); clear-signing resolution is deferred.
 */
export class LedgerEvmProvider extends BaseEvmHwProvider {
  private readonly eth: Eth;

  constructor(options: LedgerEvmProviderOptions) {
    super(options);
    this.eth = options.eth;
  }

  protected async signTransactionToSerialized(serializable: TransactionSerializable, unsigned: Hex): Promise<Hex> {
    const { r, s } = await this.eth.signTransaction(this.derivationPath, strip0x(unsigned), null);
    return this.recoverAndSerialize(serializable, unsigned, prefix0x(r), prefix0x(s));
  }

  protected async signPersonalMessage(messageHex: Hex): Promise<Hex> {
    const { r, s, v } = await this.eth.signPersonalMessage(this.derivationPath, strip0x(messageHex));
    return assembleSignature(r, s, v);
  }

  protected async signTypedData(typedData: EvmTypedData): Promise<Hex> {
    const domainSeparator = hashDomain({ domain: typedData.domain, types: typedData.types });
    const messageHash =
      typedData.primaryType === 'EIP712Domain'
        ? domainSeparator
        : hashStruct({ data: typedData.message, primaryType: typedData.primaryType, types: typedData.types });
    const { r, s, v } = await this.eth.signEIP712HashedMessage(
      this.derivationPath,
      strip0x(domainSeparator),
      strip0x(messageHash),
    );
    return assembleSignature(r, s, v);
  }
}

/**
 * Assembles a 65-byte `0x{r}{s}{v}` signature, normalising the recovery id to the
 * canonical `27`/`28` range (the device may return `0`/`1`).
 */
function assembleSignature(r: string, s: string, v: number): Hex {
  const recovery = v < 27 ? v + 27 : v;
  return `0x${strip0x(r)}${strip0x(s)}${recovery.toString(16).padStart(2, '0')}` as Hex;
}
