import type { PrivySource } from '@sodax/wallet-sdk-react';

/**
 * "Email (Privy)" is opt-in: set `VITE_PRIVY_APP_ID` (see `example.env`). Unset at build time, this
 * import is dead code and the bundle carries no Privy code — the same guarantee partners get.
 */
export async function loadPrivySource(): Promise<PrivySource | undefined> {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  if (!appId) return undefined;
  const { privy } = await import('@sodax/wallet-sdk-react/privy');
  return privy({ appId });
}
