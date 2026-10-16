import { describe, expect, it } from 'vitest';
import { getReservesEModes } from './index.js';

/**
 * `getEModesHumanized` serialises each bitmap as a 256-character MSB-first binary string, so
 * reserve N is at index `length - N - 1`. These build the strings the same way the provider does.
 */
const bitmap = (...reserveIds: number[]): string =>
  reserveIds
    .reduce((acc, id) => acc | (1n << BigInt(id)), 0n)
    .toString(2)
    .padStart(256, '0');

const category = (id: number, collateral: number[], borrowable: number[]) => ({
  id,
  eMode: {
    ltv: '9300',
    liquidationThreshold: '9500',
    liquidationBonus: '10100',
    collateralBitmap: bitmap(...collateral),
    label: `category ${id}`,
    borrowableBitmap: bitmap(...borrowable),
  },
});

describe('getReservesEModes', () => {
  const eModes = [category(1, [0, 2], [2]), category(2, [5], [0]), category(3, [], [7])];

  it('reads the reserve bit out of each 256-character bitmap', () => {
    expect(getReservesEModes(0, eModes)).toEqual([
      expect.objectContaining({ id: 1, collateralEnabled: true, borrowingEnabled: false }),
      expect.objectContaining({ id: 2, collateralEnabled: false, borrowingEnabled: true }),
    ]);
  });

  it('reports both sides when the reserve is in the collateral and borrowable bitmaps', () => {
    expect(getReservesEModes(2, eModes)).toEqual([
      expect.objectContaining({ id: 1, collateralEnabled: true, borrowingEnabled: true }),
    ]);
  });

  it('omits categories the reserve is in on neither side', () => {
    expect(getReservesEModes(9, eModes)).toEqual([]);
  });

  it('keeps a category whose collateral bitmap is empty but which permits the borrow', () => {
    expect(getReservesEModes(7, eModes)).toEqual([
      expect.objectContaining({ id: 3, collateralEnabled: false, borrowingEnabled: true }),
    ]);
  });

  it('does not bleed a neighbouring reserve bit into the answer', () => {
    // Reserve 5 is collateral in category 2; 4 and 6 must not inherit it.
    expect(getReservesEModes(4, eModes)).toEqual([]);
    expect(getReservesEModes(6, eModes)).toEqual([]);
    expect(getReservesEModes(5, eModes)).toEqual([
      expect.objectContaining({ id: 2, collateralEnabled: true, borrowingEnabled: false }),
    ]);
  });
});
