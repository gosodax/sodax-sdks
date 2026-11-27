import { describe, expect, it } from 'vitest';
import { sanitizePersistedXWalletState } from './persistSanitize.js';

const conn = (xChainType: string, address: string | undefined = 'addr1', xConnectorId = 'connector-1') => ({
  xAccount: { address, xChainType },
  xConnectorId,
});

describe('sanitizePersistedXWalletState', () => {
  it('keeps well-formed connections + userDisconnected for known chains, as fresh objects', () => {
    const input = {
      xConnections: {
        ICON: conn('ICON'),
        EVM: { xAccount: { address: undefined, xChainType: 'EVM' }, xConnectorId: 'connector-1' },
      },
      userDisconnected: { ICON: true },
    };
    const out = sanitizePersistedXWalletState(input);
    expect(out.xConnections.ICON).toEqual({
      xAccount: { address: 'addr1', xChainType: 'ICON' },
      xConnectorId: 'connector-1',
    });
    expect(out.xConnections.EVM?.xAccount.address).toBeUndefined();
    expect(out.xConnections.EVM?.xAccount.xChainType).toBe('EVM');
    expect(out.userDisconnected.ICON).toBe(true);
    expect(out.xConnections.ICON).not.toBe(input.xConnections.ICON);
    expect(out.xConnections.ICON?.xAccount).not.toBe(input.xConnections.ICON.xAccount);
  });

  it('returns empty for non-object input or non-object sections', () => {
    for (const bad of [null, undefined, 'x', 42, [], { xConnections: 'x', userDisconnected: [] }]) {
      expect(sanitizePersistedXWalletState(bad)).toEqual({ xConnections: {}, userDisconnected: {} });
    }
  });

  it('ignores unknown chain keys (iterates ChainTypeArr, not input keys)', () => {
    const out = sanitizePersistedXWalletState({
      xConnections: { FOOCHAIN: conn('FOOCHAIN') },
      userDisconnected: { FOOCHAIN: true },
    });
    expect(out.xConnections).toEqual({});
    expect(out.userDisconnected).toEqual({});
  });

  it('drops malformed connections and userDisconnected flags that are not strictly true', () => {
    const out = sanitizePersistedXWalletState({
      xConnections: {
        ICON: { xAccount: { address: 'a', xChainType: 'ICON' } }, // missing xConnectorId
        EVM: { xAccount: { address: 'a', xChainType: 'EVM' }, xConnectorId: '' }, // empty connectorId
        SUI: { xAccount: { address: 123, xChainType: 'SUI' }, xConnectorId: 'c' }, // non-string address
        INJECTIVE: { xAccount: { address: 'a', xChainType: 'EVM' }, xConnectorId: 'c' }, // xChainType != key
      },
      userDisconnected: { ICON: false, EVM: 'true', SUI: 1 },
    });
    expect(out).toEqual({ xConnections: {}, userDisconnected: {} });
  });
});
