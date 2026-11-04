import { type ChainKey, tokenLogo } from '@sodax/dapp-kit';
import { useState } from 'react';
import { chainLogo, chainName } from '../lib/chains';

/**
 * A logo that falls back to the initial rather than a broken image. `@sodax/assets` serves one PNG
 * per slugified symbol, so a token added to the config before its logo is merged 404s here.
 *
 * Callers key this on `src`: a new URL is a new element, which drops the previous failure with it.
 */
export function Glyph({
  src,
  alt,
  initial,
  className,
}: {
  src: string;
  alt: string;
  initial: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className={`${className} glyph-fallback`} aria-label={alt} role="img">
        {initial.charAt(0)}
      </span>
    );
  }
  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

export type AssetLogoProps = {
  symbol: string;
  chain: ChainKey;
};

/** The exchange's currency logo: a raised tile holding the token, with its network badged on it. */
export function AssetLogo({ symbol, chain }: AssetLogoProps) {
  const network = chainLogo(chain);
  const asset = tokenLogo(symbol);

  return (
    <span className="asset-logo">
      <Glyph key={asset} className="asset-logo-img" src={asset} alt={symbol} initial={symbol} />
      <Glyph
        key={network}
        className="asset-logo-badge"
        src={network}
        alt={`on ${chainName(chain)}`}
        initial={chainName(chain)}
      />
    </span>
  );
}
