import { describe, expect, it } from 'vitest';
import { tooltipPosition } from './tooltip';

describe('tooltipPosition', () => {
  const anchor = { left: 500, top: 300, width: 14, height: 14 };
  const bubble = { width: 300, height: 48 };

  it('centers the bubble above the icon with a 10px gap', () => {
    expect(tooltipPosition(anchor, bubble, 1200)).toEqual({
      left: 357,
      top: 242,
      arrowLeft: 150,
      side: 'top',
    });
  });

  it.each([20, 340])('keeps the bubble inside a phone viewport and the pointer on the icon at x=%s', left => {
    const result = tooltipPosition({ ...anchor, left }, bubble, 375);
    expect(result.left).toBeGreaterThanOrEqual(12);
    expect(result.left + bubble.width).toBeLessThanOrEqual(363);
    expect(result.left + result.arrowLeft).toBe(left + anchor.width / 2);
    expect(result.side).toBe('top');
  });

  it('uses the space below when the icon is too close to the top of the viewport', () => {
    expect(tooltipPosition({ ...anchor, top: 20 }, bubble, 1200)).toMatchObject({ top: 44, side: 'bottom' });
  });
});
