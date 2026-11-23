/**
 * Compile-time contract for `SuiGrpcTransport`: each transport call pins its exact Sui result type.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  SuiExecutionResult,
  SuiGasEstimate,
  SuiPaginatedCoins,
  SuiRawTransactionReceipt,
  SuiTransport,
} from '../../../index.js';
import type { SuiGrpcTransport } from './SuiGrpcTransport.js';

describe('SuiGrpcTransport', () => {
  it('every transport call pins one result type', () => {
    expectTypeOf<ReturnType<SuiGrpcTransport['getCoins']>>().toEqualTypeOf<Promise<SuiPaginatedCoins>>();
    expectTypeOf<ReturnType<SuiGrpcTransport['simulate']>>().toEqualTypeOf<Promise<SuiExecutionResult>>();
    expectTypeOf<ReturnType<SuiGrpcTransport['estimateGas']>>().toEqualTypeOf<Promise<SuiGasEstimate>>();
    expectTypeOf<ReturnType<SuiGrpcTransport['fetchLatestPackageId']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<SuiGrpcTransport['waitForTransaction']>>().toEqualTypeOf<
      Promise<SuiRawTransactionReceipt>
    >();
  });

  it('implements the SuiTransport contract', () => {
    expectTypeOf<SuiGrpcTransport>().toMatchTypeOf<SuiTransport>();
  });
});
