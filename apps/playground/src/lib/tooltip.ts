type Rect = { left: number; top: number; width: number; height: number };

export function tooltipPosition(anchor: Rect, bubble: { width: number; height: number }, viewportWidth: number) {
  const center = anchor.left + anchor.width / 2;
  const left = Math.max(12, Math.min(center - bubble.width / 2, viewportWidth - bubble.width - 12));
  const above = anchor.top - bubble.height - 10;
  const side = above >= 12 ? 'top' : 'bottom';
  return {
    left,
    top: side === 'top' ? above : anchor.top + anchor.height + 10,
    arrowLeft: center - left,
    side,
  };
}
