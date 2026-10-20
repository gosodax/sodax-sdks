import React, { useState } from 'react';
import { type ChainKey, tokenLogo } from '@sodax/dapp-kit';
import { cn } from '@/lib/utils';
import { chainLogo } from './lib/chains';

/** Token logo from the SODAX asset CDN, a letter disc if it fails to load, and an optional network badge. */
export function TokenIcon({
  symbol,
  chainKey,
  className,
}: {
  symbol: string;
  /** Adds the network's logo as a badge, where the network matters (e.g. positions). */
  chainKey?: ChainKey;
  className?: string;
}) {
  const src = tokenLogo(symbol);
  const [failedSrc, setFailedSrc] = useState<string>();
  const badge = chainKey && chainLogo(chainKey);

  return (
    <span className={cn('relative inline-flex size-8 shrink-0', className)}>
      {failedSrc === src ? (
        <span className="flex size-full items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {symbol.slice(0, 1)}
        </span>
      ) : (
        <img src={src} alt="" className="size-full rounded-full" onError={() => setFailedSrc(src)} />
      )}
      {badge && (
        <img
          src={badge}
          alt=""
          className="absolute -right-0.5 -bottom-0.5 size-[45%] rounded-full bg-card ring-2 ring-card"
        />
      )}
    </span>
  );
}
