import { baseChainInfo, type ChainKey } from '@sodax/dapp-kit';

export function chainName(chainKey: ChainKey): string {
  return baseChainInfo[chainKey]?.name ?? chainKey;
}

export function chainLogo(chainKey: ChainKey): string | undefined {
  return baseChainInfo[chainKey]?.logo;
}

export function explorerTxUrl(chainKey: ChainKey, txHash: string): string | undefined {
  const base = baseChainInfo[chainKey]?.explorer.txUrl;
  return base ? `${base}${txHash}` : undefined;
}

export function explorerAddressUrl(chainKey: ChainKey, address: string): string | undefined {
  const base = baseChainInfo[chainKey]?.explorer.addressUrl;
  return base ? `${base}${address}` : undefined;
}
