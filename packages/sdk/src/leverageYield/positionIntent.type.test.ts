/** Compile-time contract: reporting a position intent resolves to the intent result, never a `Result`. */
import { describe, expectTypeOf, it } from 'vitest';
import type { LeveragePositionIntentResult, TxHashPair } from '../index.js';
import type { reportPositionIntent } from './positionIntent.js';

describe('positionIntent result types', () => {
  it('reportPositionIntent → Promise<LeveragePositionIntentResult>', () => {
    expectTypeOf<ReturnType<typeof reportPositionIntent>>().toEqualTypeOf<Promise<LeveragePositionIntentResult>>();
    expectTypeOf<LeveragePositionIntentResult>().toEqualTypeOf<{
      txHashes: TxHashPair;
      notified: boolean;
      notifyError?: string;
    }>();
  });
});
