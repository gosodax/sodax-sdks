/** Pins the result types of the e-mode category formatters. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  FormattedReserveEMode,
  ReserveEMode,
  formatEModeCategory,
  formatEModes,
  getAndFormatReserveEModes,
  getReservesEModes,
} from './index.js';

// `FormattedEModeCategory` is not exported; it is reachable as the `eMode` of a formatted reserve e-mode.
type FormattedEModeCategory = FormattedReserveEMode['eMode'];

describe('e-mode formatters', () => {
  it('formatEModeCategory adds the formatted ratios', () => {
    expectTypeOf<ReturnType<typeof formatEModeCategory>>().toEqualTypeOf<FormattedEModeCategory>();
    expectTypeOf<FormattedEModeCategory>().toEqualTypeOf<{
      ltv: string;
      liquidationThreshold: string;
      liquidationBonus: string;
      collateralBitmap: string;
      label: string;
      borrowableBitmap: string;
      formattedLtv: string;
      formattedLiquidationThreshold: string;
      formattedLiquidationBonus: string;
    }>();
  });

  it('formatEModes keeps the id and formats each category', () => {
    expectTypeOf<ReturnType<typeof formatEModes>>().toEqualTypeOf<{ eMode: FormattedEModeCategory; id: number }[]>();
  });

  it('getReservesEModes and getAndFormatReserveEModes return the reserve e-modes', () => {
    expectTypeOf<ReturnType<typeof getReservesEModes>>().toEqualTypeOf<ReserveEMode[]>();
    expectTypeOf<ReturnType<typeof getAndFormatReserveEModes>>().toEqualTypeOf<FormattedReserveEMode[]>();
  });
});
