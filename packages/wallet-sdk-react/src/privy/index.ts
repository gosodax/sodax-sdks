import { VERSION } from '@privy-io/react-auth';
import { ChainKeys, getEvmChainKeyByChainId } from '@sodax/types';
import { createPrivySource } from '@/providers/evm/privySource.js';
import type { PrivySource } from '@/types/config.js';
import { SODAX_EVM_CHAINS } from '@/xchains/evm/EvmXService.js';
import { MIN_PRIVY_VERSION } from './constants.js';
import type { PrivyOptions } from './privyConfig.js';
import { createPrivySetup } from './setup.js';

export { PRIVY_CONNECTOR_ID } from './constants.js';
export type { PrivyOptions } from './privyConfig.js';

/**
 * Adds Privy email login to the EVM wallet list as "Email (Privy)" (connector id `privy`). Pass the
 * result as `EVM.privy` in `SodaxWalletConfig`, built in a client module. Needs `@privy-io/react-auth`
 * 3.40 or newer. Never throws: a missing app id, an unknown `defaultChain` or an older Privy logs a
 * warning and leaves the entry out, like a missing WalletConnect `projectId`.
 *
 * @example
 * const config: SodaxWalletConfig = { EVM: { privy: privy({ appId: PRIVY_APP_ID }) } };
 */
export function privy(options: PrivyOptions): PrivySource {
  const appId = options.appId?.trim() ?? '';
  const defaultKey = options.defaultChain ?? ChainKeys.SONIC_MAINNET;
  const defaultChain = SODAX_EVM_CHAINS.find(chain => getEvmChainKeyByChainId(chain.id) === defaultKey);
  const problem = !appId
    ? '`appId` is empty'
    : !defaultChain
      ? `defaultChain '${String(defaultKey)}' is not an EVM chain of this SDK`
      : !isAtLeast(VERSION, MIN_PRIVY_VERSION)
        ? `@privy-io/react-auth ${String(VERSION)} is older than ${MIN_PRIVY_VERSION}`
        : undefined;
  if (problem || !defaultChain) {
    console.warn(`[wallet-sdk-react/privy] privy(): ${problem} — "Email (Privy)" is left out.`);
    return createPrivySource(() => undefined);
  }
  const resolved: PrivyOptions = { ...options, appId };
  return createPrivySource(ctx => createPrivySetup(resolved, defaultChain.id, ctx));
}

function isAtLeast(version: unknown, minimum: string): boolean {
  if (typeof version !== 'string') return false;
  const parse = (value: string) => value.split('.').map(part => Number.parseInt(part, 10) || 0);
  const actual = parse(version);
  const floor = parse(minimum);
  for (let i = 0; i < floor.length; i++) {
    const a = actual[i] ?? 0;
    const b = floor[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}
