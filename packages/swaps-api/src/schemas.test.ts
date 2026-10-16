import type { EvmRawTransaction } from '@sodax/types';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { EvmRawTxSchema } from './rawTxSchemas.js';
import {
  FeeResponseSchema,
  GetSwapTokensByChainResponseSchema,
  GetSwapTokensResponseSchema,
  StatusResponseSchema,
  SubmitTxStatusResponseSchema,
  makeCreateIntentResponseSchema,
  makeQuoteResponseSchema,
} from './schemas.js';

// The tx-bearing schemas are chain-parameterized factories; tests pin them to the EVM variant.
const CreateIntentResponseSchema = makeCreateIntentResponseSchema(EvmRawTxSchema);
const QuoteResponseSchema = makeQuoteResponseSchema(EvmRawTxSchema);

// A valid EVM unsigned tx as it arrives on the wire (`value` is a decimal string).
const evmTx = {
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: '1000000000000000000',
  data: '0x',
};

// Mirrors a real token from GET /v1/swaps/tokens.
const token = {
  symbol: 'S',
  name: 'Sonic',
  decimals: 18,
  address: '0x0000000000000000000000000000000000000000',
  chainKey: 'sonic',
  hubAsset: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
  vault: '0x62ecc3Eeb80a162c57624B3fF80313FE69f5203e',
};

const intentResponse = {
  intentId: '1',
  creator: '0xabc',
  inputToken: '0xin',
  outputToken: '0xout',
  inputAmount: '1000',
  minOutputAmount: '990',
  deadline: '0',
  allowPartialFill: false,
  srcChain: '146',
  dstChain: '1',
  srcAddress: '0xsrc',
  dstAddress: '0xdst',
  solver: '0x0',
  data: '0x',
};

describe('token schemas', () => {
  it('parses a valid token array', () => {
    expect(v.parse(GetSwapTokensByChainResponseSchema, [token])).toHaveLength(1);
  });

  it('parses the chain-keyed token map', () => {
    expect(Object.keys(v.parse(GetSwapTokensResponseSchema, { sonic: [token] }))).toEqual(['sonic']);
  });

  it('rejects a token missing a required field', () => {
    const { symbol, ...incomplete } = token;
    expect(v.safeParse(GetSwapTokensByChainResponseSchema, [incomplete]).success).toBe(false);
  });

  it('rejects a token whose decimals is a string', () => {
    expect(v.safeParse(GetSwapTokensByChainResponseSchema, [{ ...token, decimals: '18' }]).success).toBe(false);
  });

  it('tolerates an additive backend field (ignored, not rejected)', () => {
    const parsed = v.parse(GetSwapTokensByChainResponseSchema, [{ ...token, futureField: 'x' }]);
    expect(parsed[0]).not.toHaveProperty('futureField');
  });
});

describe('QuoteResponseSchema', () => {
  it('parses a quote without txData', () => {
    expect(v.parse(QuoteResponseSchema, { quotedAmount: '5' }).quotedAmount).toBe('5');
  });

  it('parses a quote with embedded txData and transforms tx.value to bigint', () => {
    const parsed = v.parse(QuoteResponseSchema, {
      quotedAmount: '5',
      txData: { tx: evmTx, intent: intentResponse, relayData: { address: '0x', payload: '0x' } },
    });
    expect(parsed.txData?.intent.intentId).toBe('1');
    // The factory types `tx` as the full RawTxReturnType union; the fixture pins the EVM variant.
    const tx = parsed.txData?.tx as EvmRawTransaction | undefined;
    expect(tx?.value).toBe(1000000000000000000n);
  });

  it('rejects a quote missing quotedAmount', () => {
    expect(v.safeParse(QuoteResponseSchema, {}).success).toBe(false);
  });
});

describe('StatusResponseSchema', () => {
  it('parses a solved status with a fill hash', () => {
    expect(v.parse(StatusResponseSchema, { status: 3, fillTxHash: '0xfill' }).status).toBe(3);
  });

  it('rejects a status code outside the picklist', () => {
    expect(v.safeParse(StatusResponseSchema, { status: 99 }).success).toBe(false);
  });
});

describe('SubmitTxStatusResponseSchema', () => {
  // Minimal valid submit-tx status envelope; `status` (a SubmitSwapTxStatusV2 string, distinct from
  // the numeric solver status above) is the field under test.
  const envelope = (status: string) => ({
    success: true,
    data: { txHash: '0xabc', srcChainKey: 'sonic', status, processingAttempts: 1 },
  });

  it('parses the terminal-success status "solved"', () => {
    expect(v.parse(SubmitTxStatusResponseSchema, envelope('solved')).data.status).toBe('solved');
  });

  it('parses the non-terminal status "posted_execution"', () => {
    expect(v.parse(SubmitTxStatusResponseSchema, envelope('posted_execution')).data.status).toBe('posted_execution');
  });

  it('rejects the removed legacy status "executed"', () => {
    expect(v.safeParse(SubmitTxStatusResponseSchema, envelope('executed')).success).toBe(false);
  });

  it('keeps the leverage-yield operation discriminator, fill hash and refund timestamp', () => {
    const row = envelope('solved');
    const parsed = v.parse(SubmitTxStatusResponseSchema, {
      ...row,
      data: {
        ...row.data,
        operation: 'leverage_withdraw',
        relayedForRefundAt: '2026-09-02T00:00:00.000Z',
        result: { dstIntentTxHash: '0xdst', fillTxHash: '0xfill' },
      },
    }).data;
    expect(parsed.operation).toBe('leverage_withdraw');
    expect(parsed.relayedForRefundAt).toBe('2026-09-02T00:00:00.000Z');
    expect(parsed.result?.fillTxHash).toBe('0xfill');
  });

  it('parses a row without operation (backends predating the discriminator)', () => {
    expect(v.parse(SubmitTxStatusResponseSchema, envelope('relaying')).data.operation).toBeUndefined();
  });

  it('rejects an operation outside the picklist', () => {
    const row = envelope('solved');
    const bad = { ...row, data: { ...row.data, operation: 'redeem' } };
    expect(v.safeParse(SubmitTxStatusResponseSchema, bad).success).toBe(false);
  });
});

describe('CreateIntentResponseSchema', () => {
  it('transforms tx to its chain variant (value string→bigint) and validates intent/relayData', () => {
    const parsed = v.parse(CreateIntentResponseSchema, {
      tx: evmTx,
      intent: intentResponse,
      relayData: { address: '0xa', payload: '0xb' },
    });
    // The factory types `tx` as the full RawTxReturnType union; the fixture pins the EVM variant.
    const tx = parsed.tx as EvmRawTransaction;
    expect(tx.value).toBe(1000000000000000000n);
    expect(parsed.relayData.payload).toBe('0xb');
  });

  it('rejects when intent is missing', () => {
    expect(
      v.safeParse(CreateIntentResponseSchema, { tx: evmTx, relayData: { address: '', payload: '' } }).success,
    ).toBe(false);
  });

  it('rejects a malformed tx (non-numeric value cannot convert to bigint)', () => {
    const bad = {
      tx: { ...evmTx, value: 'not-a-number' },
      intent: intentResponse,
      relayData: { address: '', payload: '' },
    };
    expect(v.safeParse(CreateIntentResponseSchema, bad).success).toBe(false);
  });
});

describe('scalar response schemas', () => {
  it('parses a fee', () => {
    expect(v.parse(FeeResponseSchema, { fee: '1000' }).fee).toBe('1000');
  });
});
