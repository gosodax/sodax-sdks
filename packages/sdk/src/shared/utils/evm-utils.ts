import { encodeAbiParameters, parseAbiParameters } from 'viem';
import type { IEvmWalletProvider, EvmRawTransactionReceipt, Hex, EvmContractCall } from '@sodax/types';

export function encodeContractCalls(calls: EvmContractCall[]): Hex {
  return encodeAbiParameters(parseAbiParameters('(address,uint256,bytes)[]'), [
    calls.map(v => [v.address, v.value, v.data] as const),
  ]);
}

export async function waitForTransactionReceipt(
  hash: Hex,
  provider: IEvmWalletProvider,
): Promise<EvmRawTransactionReceipt> {
  return provider.waitForTransactionReceipt(hash);
}
