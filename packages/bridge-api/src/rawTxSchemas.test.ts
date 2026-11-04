import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { ChainKeys, type BitcoinRawTransaction } from '@sodax/types';
import { EvmRawTxSchema, InjectiveRawTxSchema, rawTxSchemaForChainKey } from './rawTxSchemas.js';

const evmTxWire = {
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: '1000000000000000000',
  data: '0x',
};

describe('EvmRawTxSchema', () => {
  it('transforms the decimal-string value to a bigint', () => {
    expect(v.parse(EvmRawTxSchema, evmTxWire).value).toBe(1000000000000000000n);
  });

  it('fails the parse cleanly on a non-numeric value (no throw)', () => {
    const result = v.safeParse(EvmRawTxSchema, { ...evmTxWire, value: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects non-decimal value strings that bare BigInt() would silently coerce', () => {
    // Under `BigInt()`: '' → 0n, '  1 ' → 1n, '0x1f' → 31n. The decimal gate rejects them so a
    // malformed amount surfaces as a validation failure instead of a wrong (often zero) value.
    for (const value of ['', '  1 ', '0x1f', '1.5', '-5']) {
      expect(v.safeParse(EvmRawTxSchema, { ...evmTxWire, value }).success).toBe(false);
    }
  });

  it('rejects a tx missing a required field', () => {
    const { data, ...incomplete } = evmTxWire;
    expect(v.safeParse(EvmRawTxSchema, incomplete).success).toBe(false);
  });
});

describe('InjectiveRawTxSchema', () => {
  it('rebuilds index-object bytes into a Uint8Array and converts accountNumber to bigint', () => {
    const parsed = v.parse(InjectiveRawTxSchema, {
      from: '0xfrom',
      to: '0xto',
      signedDoc: {
        bodyBytes: { '0': 1, '1': 2, '2': 255 },
        authInfoBytes: { '0': 9 },
        chainId: 'injective-1',
        accountNumber: '42',
      },
    });
    expect(parsed.signedDoc.bodyBytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(parsed.signedDoc.bodyBytes)).toEqual([1, 2, 255]);
    expect(parsed.signedDoc.accountNumber).toBe(42n);
  });

  it('orders bytes by ascending numeric key regardless of insertion order', () => {
    const parsed = v.parse(InjectiveRawTxSchema, {
      from: '0xfrom',
      to: '0xto',
      signedDoc: {
        bodyBytes: { '2': 3, '0': 1, '1': 2 }, // scrambled insertion order
        authInfoBytes: { '0': 0 },
        chainId: 'injective-1',
        accountNumber: '1',
      },
    });
    expect(Array.from(parsed.signedDoc.bodyBytes)).toEqual([1, 2, 3]);
  });

  it('rejects an out-of-range / negative / fractional byte instead of wrapping it', () => {
    // Uint8Array.from would silently map 300→44, -1→255, 3.7→3; the byte-range gate fails the parse.
    for (const bad of [300, -1, 3.7]) {
      const result = v.safeParse(InjectiveRawTxSchema, {
        from: '0xfrom',
        to: '0xto',
        signedDoc: {
          bodyBytes: { '0': bad },
          authInfoBytes: { '0': 9 },
          chainId: 'injective-1',
          accountNumber: '42',
        },
      });
      expect(result.success).toBe(false);
    }
  });
});

describe('rawTxSchemaForChainKey', () => {
  it('selects the EVM variant for an EVM chain key (value becomes bigint)', () => {
    const schema = rawTxSchemaForChainKey('0xa4b1.arbitrum');
    expect(v.parse(schema, evmTxWire)).toMatchObject({ value: 1000000000000000000n });
  });

  it('selects the Solana / Sui / Stellar variants and transforms value → bigint', () => {
    expect(
      v.parse(rawTxSchemaForChainKey('solana'), { from: 'B58', to: 'B58', value: '42', data: 'b64' }),
    ).toMatchObject({ value: 42n });
    expect(v.parse(rawTxSchemaForChainKey('sui'), { from: '0xsui', to: 'sui', value: '7', data: 'b64' })).toMatchObject(
      { value: 7n },
    );
    expect(v.parse(rawTxSchemaForChainKey('stellar'), { from: 'G', to: 'G', value: '0', data: 'xdr' })).toMatchObject({
      value: 0n,
    });
  });

  it('selects the NEAR variant (gas/deposit → bigint, args pass through, omitted → undefined)', () => {
    expect(
      v.parse(rawTxSchemaForChainKey('near'), {
        signerId: 'a.near',
        params: {
          contractId: 'c.near',
          method: 'ft_transfer',
          args: { amount: '1' },
          gas: '30000000000000',
          deposit: '1',
        },
      }),
    ).toMatchObject({ params: { gas: 30000000000000n, deposit: 1n, args: { amount: '1' } } });

    const noGas = v.parse(rawTxSchemaForChainKey('near'), {
      signerId: 'a.near',
      params: { contractId: 'c.near', method: 'm', args: {} },
    }) as { params: { gas?: bigint; deposit?: bigint } };
    expect(noGas.params.gas).toBeUndefined();
    expect(noGas.params.deposit).toBeUndefined();
  });

  it('selects the Icon (loose dict) and Stacks (payload) variants with no bigint transform', () => {
    const iconTx = { to: 'cxcontract', method: 'transfer', params: { _to: 'hxrecipient', _value: '0x10' } };
    expect(v.parse(rawTxSchemaForChainKey('0x1.icon'), iconTx)).toEqual(iconTx);
    expect(v.parse(rawTxSchemaForChainKey('stacks'), { payload: '0xfeed', estimatedLength: 180 })).toEqual({
      payload: '0xfeed',
      estimatedLength: 180,
    });
    expect(v.parse(rawTxSchemaForChainKey('stacks'), { payload: '0xfeed' })).toEqual({ payload: '0xfeed' });
  });

  it('disambiguates by chain key: a NEAR body is rejected under an EVM key but accepted under a NEAR key', () => {
    // The selector's reason to exist: EVM/Solana/Sui/Stellar are wire-identical and Icon's loose dict
    // structurally matches everything, so a blind union could not tell a NEAR body from an EVM one.
    const nearBody = { signerId: 'a.near', params: { contractId: 'c', method: 'm', args: {} } };
    expect(v.safeParse(rawTxSchemaForChainKey('0xa4b1.arbitrum'), nearBody).success).toBe(false);
    expect(v.safeParse(rawTxSchemaForChainKey('near'), nearBody).success).toBe(true);
  });

  // Regression: Bitcoin resolves to chain type BITCOIN, which had no `case` and therefore fell through
  // to the permissive object-only fallback — leaving `value` a decimal string at runtime while
  // `BitcoinRawTransaction.value` is declared `bigint`. Both tx-returning Bridge API methods
  // (`approve`, `createBridgeIntent`) pick their schema from `srcChainKey`, so a Bitcoin-sourced bridge
  // handed the caller an unconverted `value`.
  it('selects the Bitcoin schema for a Bitcoin chain key (satoshi value → bigint)', () => {
    const out = v.parse(rawTxSchemaForChainKey(ChainKeys.BITCOIN_MAINNET), {
      from: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      to: 'bc1qassetmanager',
      value: '546',
      data: 'cHNidP8BAP0=',
    }) as BitcoinRawTransaction;
    expect(out.value).toBe(546n);
    expect(typeof out.value).toBe('bigint');
    // The PSBT and addresses are opaque strings — they must survive untouched.
    expect(out.data).toBe('cHNidP8BAP0=');
    expect(out.from).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  });

  it('rejects a Bitcoin body with a non-numeric value instead of passing it through', () => {
    const schema = rawTxSchemaForChainKey(ChainKeys.BITCOIN_MAINNET);
    expect(v.safeParse(schema, { from: 'bc1q', to: 'bc1q', value: 'not-a-number', data: 'psbt' }).success).toBe(false);
    // Pre-fix this shape parsed cleanly, since the fallback only checked "is a non-null object".
    expect(v.safeParse(schema, { unexpected: 'shape' }).success).toBe(false);
  });

  it('falls back to a permissive schema for an unknown key instead of throwing', () => {
    const schema = rawTxSchemaForChainKey('not-a-real-chain');
    // Fallback validates "is a non-null object" and leaves the payload untransformed.
    expect(v.parse(schema, { anything: 'goes' })).toEqual({ anything: 'goes' });
    expect(v.safeParse(schema, 'not-an-object').success).toBe(false);
  });
});
