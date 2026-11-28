// Test-only fixtures shared by the MPC-relay spoke service tests.
import type { SpokeChainKey } from '@sodax/types';
import type { Hex } from 'viem';

/** The hub wallet every mocked MPC relay derives for the test depositor. */
export const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Hex;

/**
 * Builds deposit params for one sender on an MPC-relay spoke, paying {@link HUB_WALLET}: call the result with the
 * token and any overrides. Typed `never` because each test passes a minimal wallet double, not the chain's provider.
 */
export const depositParamsFor =
  (base: { srcChainKey: SpokeChainKey; srcAddress: string; amount: bigint; walletProvider: unknown }) =>
  (token: string, extra: object = {}): never =>
    ({ ...base, to: HUB_WALLET, token, data: '0x', ...extra }) as never;
