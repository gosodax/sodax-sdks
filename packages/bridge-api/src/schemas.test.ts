import type { EvmRawTransaction } from '@sodax/types';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { EvmRawTxSchema } from './rawTxSchemas.js';
import {
  BridgeableAmountResponseSchema,
  BridgeableCheckResponseSchema,
  BridgeFeeResponseSchema,
  BridgeSubmitTxResponseSchema,
  BridgeSubmitTxStatusResponseSchema,
  BridgeTokensByChainResponseSchema,
  BridgeTokensResponseSchema,
  makeBridgeApproveResponseSchema,
  makeCreateBridgeIntentResponseSchema,
} from './schemas.js';

// The tx-bearing schemas are chain-parameterized factories; tests pin them to the EVM variant.
const CreateBridgeIntentResponseSchema = makeCreateBridgeIntentResponseSchema(EvmRawTxSchema);
const BridgeApproveResponseSchema = makeBridgeApproveResponseSchema(EvmRawTxSchema);

// A valid EVM unsigned tx as it arrives on the wire (`value` is a decimal string).
const evmTx = {
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: '1000000000000000000',
  data: '0x',
};

// Mirrors a real token from GET /v1/bridge/tokens.
const token = {
  symbol: 'S',
  name: 'Sonic',
  decimals: 18,
  address: '0x0000000000000000000000000000000000000000',
  chainKey: 'sonic',
  hubAsset: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
  vault: '0x62ecc3Eeb80a162c57624B3fF80313FE69f5203e',
};

describe('token schemas', () => {
  it('parses a valid token array', () => {
    expect(v.parse(BridgeTokensByChainResponseSchema, [token])).toHaveLength(1);
  });

  it('parses the chain-keyed token map', () => {
    expect(Object.keys(v.parse(BridgeTokensResponseSchema, { sonic: [token] }))).toEqual(['sonic']);
  });

  it('rejects a token missing a required field', () => {
    const { symbol, ...incomplete } = token;
    expect(v.safeParse(BridgeTokensByChainResponseSchema, [incomplete]).success).toBe(false);
  });

  it('rejects a token whose decimals is a string', () => {
    expect(v.safeParse(BridgeTokensByChainResponseSchema, [{ ...token, decimals: '18' }]).success).toBe(false);
  });

  it('tolerates an additive backend field (ignored, not rejected)', () => {
    const parsed = v.parse(BridgeTokensByChainResponseSchema, [{ ...token, futureField: 'x' }]);
    expect(parsed[0]).not.toHaveProperty('futureField');
  });
});

describe('CreateBridgeIntentResponseSchema', () => {
  it('transforms tx to its chain variant (value string→bigint) and validates relayData', () => {
    const parsed = v.parse(CreateBridgeIntentResponseSchema, {
      tx: evmTx,
      relayData: { address: '0xa', payload: '0xb' },
    });
    const tx = parsed.tx as EvmRawTransaction;
    expect(tx.value).toBe(1000000000000000000n);
    expect(parsed.relayData.payload).toBe('0xb');
  });

  it('rejects when relayData is missing (bridge create-intent always carries the envelope)', () => {
    expect(v.safeParse(CreateBridgeIntentResponseSchema, { tx: evmTx }).success).toBe(false);
  });

  it('rejects a malformed tx (non-numeric value cannot convert to bigint)', () => {
    const bad = { tx: { ...evmTx, value: 'not-a-number' }, relayData: { address: '', payload: '' } };
    expect(v.safeParse(CreateBridgeIntentResponseSchema, bad).success).toBe(false);
  });
});

describe('BridgeApproveResponseSchema', () => {
  // A second, zero-allowance tx the backend returns for USDT-lineage tokens: it must be broadcast and
  // mined BEFORE `tx`. It is optional, so a schema that omits the field drops it silently instead of
  // failing — which is why this is pinned rather than left to the drift guard alone.
  const resetTx = { ...evmTx, value: '0' };

  it('parses an approve that carries no resetTx', () => {
    const parsed = v.parse(BridgeApproveResponseSchema, { tx: evmTx });
    expect((parsed.tx as EvmRawTransaction).value).toBe(1000000000000000000n);
    expect(parsed.resetTx).toBeUndefined();
  });

  it('keeps resetTx and transforms it to the chain variant', () => {
    const parsed = v.parse(BridgeApproveResponseSchema, { tx: evmTx, resetTx });
    expect(parsed.resetTx).toBeDefined();
    expect((parsed.resetTx as EvmRawTransaction).value).toBe(0n);
    expect((parsed.resetTx as EvmRawTransaction).to).toBe(resetTx.to);
  });

  it('rejects a malformed resetTx rather than dropping it', () => {
    expect(
      v.safeParse(BridgeApproveResponseSchema, { tx: evmTx, resetTx: { ...resetTx, value: 'nope' } }).success,
    ).toBe(false);
  });
});

describe('BridgeSubmitTxResponseSchema', () => {
  it('parses both insertion outcomes', () => {
    for (const status of ['inserted', 'duplicate']) {
      const parsed = v.parse(BridgeSubmitTxResponseSchema, { success: true, data: { status, message: 'ok' } });
      expect(parsed.data.status).toBe(status);
    }
  });

  it('rejects an unknown insertion status', () => {
    expect(
      v.safeParse(BridgeSubmitTxResponseSchema, { success: true, data: { status: 'queued', message: '' } }).success,
    ).toBe(false);
  });
});

describe('BridgeSubmitTxStatusResponseSchema', () => {
  // Minimal valid submit-tx status envelope; `status` is the field under test.
  const envelope = (status: string) => ({
    success: true,
    data: { txHash: '0xabc', srcChainKey: 'sonic', status, processingAttempts: 1 },
  });

  it('parses the terminal statuses "executed" and "failed"', () => {
    expect(v.parse(BridgeSubmitTxStatusResponseSchema, envelope('executed')).data.status).toBe('executed');
    expect(v.parse(BridgeSubmitTxStatusResponseSchema, envelope('failed')).data.status).toBe('failed');
  });

  it('tolerates an unknown future lifecycle status instead of failing the parse', () => {
    // Deliberate: `status` is tolerant (`v.string()`), so a backend lifecycle addition never breaks parse.
    expect(v.parse(BridgeSubmitTxStatusResponseSchema, envelope('quantum_relaying')).data.status).toBe(
      'quantum_relaying',
    );
  });

  it('parses an executed result with dstIntentTxHash and packetData', () => {
    const parsed = v.parse(BridgeSubmitTxStatusResponseSchema, {
      success: true,
      data: {
        ...envelope('executed').data,
        result: {
          dstIntentTxHash: '0xdst',
          packetData: {
            src_chain_id: 146,
            src_tx_hash: '0xsrc',
            src_address: '0xa',
            status: 'executed',
            dst_chain_id: 1,
            conn_sn: 7,
            dst_address: '0xb',
            dst_tx_hash: '0xdst',
            signatures: ['0xsig'],
            payload: '0x',
          },
        },
      },
    });
    expect(parsed.data.result?.dstIntentTxHash).toBe('0xdst');
    expect(parsed.data.result?.packetData?.conn_sn).toBe(7);
  });
});

describe('scalar response schemas', () => {
  it('parses a fee', () => {
    expect(v.parse(BridgeFeeResponseSchema, { fee: '1000' }).fee).toBe('1000');
  });

  it('parses a bridgeable-amount limit and rejects an unknown limit type', () => {
    const limit = { amount: '5000000', decimals: 6, type: 'DEPOSIT_LIMIT' };
    expect(v.parse(BridgeableAmountResponseSchema, { limit }).limit.amount).toBe('5000000');
    expect(v.safeParse(BridgeableAmountResponseSchema, { limit: { ...limit, type: 'SOFT_LIMIT' } }).success).toBe(
      false,
    );
  });

  it('parses a bridgeable check', () => {
    expect(v.parse(BridgeableCheckResponseSchema, { bridgeable: true }).bridgeable).toBe(true);
  });
});
