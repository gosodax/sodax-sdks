import { describe, expect, it } from 'vitest';
import { ChainKeys } from './chains.js';
import { spokeChainConfig } from './chains.js';
import { swapSupportedTokens } from '../swap/swap.js';

const STELLAR = ChainKeys.STELLAR_MAINNET;
const stellar = spokeChainConfig[STELLAR];

const exemptAddresses = new Set(
  [stellar.nativeToken, stellar.supportedTokens.legacybnUSD?.address]
    .filter((address): address is NonNullable<typeof address> => typeof address === 'string')
    .map(address => address.toLowerCase()),
);

const trustlineContractIds = new Set(stellar.trustlineConfigs.map(config => config.contractId.toLowerCase()));

describe('Stellar trustline config invariants', () => {
  it('has the config it claims to check — otherwise every assertion below is vacuous', () => {
    expect(trustlineContractIds.size).toBeGreaterThan(0);
    expect(exemptAddresses.size).toBeGreaterThan(0);
    expect((swapSupportedTokens[STELLAR] ?? []).length).toBeGreaterThan(0);
  });

  it('every trustline-requiring asset is 7-decimal, matching the stroop comparison', () => {
    const offenders = Object.values(stellar.supportedTokens)
      .filter(token => trustlineContractIds.has(token.address.toLowerCase()))
      .filter(token => token.decimals !== 7)
      .map(token => `${token.symbol} (${token.decimals} decimals)`);

    // hasSufficientTrustline currently compares amounts using Stellar's fixed 1e7 scale.
    expect(offenders).toEqual([]);
  });

  it('exempts exactly the assets that need no trustline, and no trustline-requiring one', () => {
    const wrongly = stellar.trustlineConfigs
      .filter(config => exemptAddresses.has(config.contractId.toLowerCase()))
      .map(config => config.assetCode);

    expect(wrongly).toEqual([]);
  });

  it('every non-exempt swap-supported Stellar token has a trustline config', () => {
    const missing = (swapSupportedTokens[STELLAR] ?? [])
      .filter(token => !exemptAddresses.has(token.address.toLowerCase()))
      .filter(token => !trustlineContractIds.has(token.address.toLowerCase()))
      .map(token => token.symbol);

    // Missing configs make the destination gate remain unresolved.
    expect(missing).toEqual([]);
  });
});
