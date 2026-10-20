import { type LeverageYieldVault, sonicSupportedTokens, type XToken } from '@sodax/dapp-kit';
import { formatTokenAmount, ONE_SHARE } from './format';

/** lsoda* vault shares are always 18 decimals. */
export const SHARE_DECIMALS = 18;

const hubTokenByAddress = new Map(
  (Object.values(sonicSupportedTokens) as XToken[]).map(token => [token.address.toLowerCase(), token]),
);

/** The vault's underlying asset on Sonic (its `asset`), e.g. lsodaWSTETH → wstETH. TVL and share price are in it. */
export function underlying(vault: LeverageYieldVault): { symbol: string; decimals: number } {
  const asset = hubTokenByAddress.get(vault.asset.toLowerCase());
  return { symbol: asset?.symbol ?? vault.name.replace(/^lsoda/, ''), decimals: asset?.decimals ?? SHARE_DECIMALS };
}

/** Yield source, e.g. "Sky (sUSDS)" → "Sky". */
function yieldSource(vault: LeverageYieldVault): string {
  return vault.lsdSource?.label.replace(/\s*\([^)]*\)\s*/, '').trim() ?? '';
}

/** The name users see: the underlying asset, e.g. lsodaSUSDS → "sUSDS Vault". */
export function vaultTitle(vault: LeverageYieldVault): string {
  return `${underlying(vault).symbol} Vault`;
}

const TAGLINES: Record<string, string> = {
  lsodaWEETH: 'Leveraged EtherFi staking yield',
  lsodaWSTETH: 'Leveraged Lido staking yield',
  lsodaJITOSOL: 'Leveraged Jito staking yield',
  lsodaSUSDS: 'Leveraged Sky savings yield',
};

/** One line on what the vault earns, e.g. "Leveraged Sky savings yield". */
export function vaultTagline(vault: LeverageYieldVault): string {
  return TAGLINES[vault.name] ?? `Leveraged ${yieldSource(vault) || 'staking'} yield`;
}

/** "4.53 shares", "1 share". */
export function formatShares(shares: bigint | undefined, noun = 'share'): string {
  const amount = formatTokenAmount(shares, SHARE_DECIMALS);
  return `${amount} ${amount === '1' ? noun : `${noun}s`}`;
}

/** Underlying value of `shares` at `sharePrice` (underlying per 1 share). ERC-4626 conversion is linear. */
export function shareValue(shares: bigint | undefined, sharePrice: bigint | undefined): bigint | undefined {
  return shares !== undefined && sharePrice !== undefined ? (shares * sharePrice) / ONE_SHARE : undefined;
}

const RAY = 10n ** 27n;

/** Simple interest on `assets` over `days` at a RAY APR (negative when the APR is). An estimate, not a promise. */
export function projectedInterest(assets: bigint, aprRay: bigint, days: number): bigint {
  return (assets * aprRay * BigInt(days)) / (365n * RAY);
}
