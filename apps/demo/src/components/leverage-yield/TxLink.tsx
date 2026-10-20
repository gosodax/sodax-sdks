import React from 'react';
import { ExternalLinkIcon } from 'lucide-react';
import type { ChainKey } from '@sodax/dapp-kit';
import { chainName, explorerTxUrl } from './lib/chains';
import { shortenAddress } from './lib/format';

export function TxLink({ chainKey, hash }: { chainKey: ChainKey; hash: string }) {
  const url = explorerTxUrl(chainKey, hash);
  const text = `${shortenAddress(hash, 6)} on ${chainName(chainKey)}`;
  if (!url) return <span className="font-mono">{text}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {text}
      <ExternalLinkIcon className="size-3" />
    </a>
  );
}
