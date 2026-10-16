/** A printable key extends the buffer only while the previous one is still recent. */
export const TYPEAHEAD_RESET_MS = 600;

/** The buffer a printable key leaves behind; a repeat of the same key stays a one-letter search. */
export function typeaheadText(previous: string, key: string, elapsed: number): string {
  if (elapsed >= TYPEAHEAD_RESET_MS || previous === key) return key;
  return previous + key;
}

/** The option a navigation key moves to, or undefined when the key does not navigate. */
export function navigateIndex(key: string, from: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  switch (key) {
    case 'ArrowDown':
      return Math.min(Math.max(from, -1) + 1, count - 1);
    case 'ArrowUp':
      return Math.max(Math.min(from, count) - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

/** The option a typed buffer lands on, searching forward from `from` and wrapping. */
export function typeaheadIndex(labels: readonly string[], text: string, from: number): number | undefined {
  const needle = text.toLowerCase();
  if (!needle || !labels.length) return undefined;
  // A grown buffer re-tests the current row first; a repeated single letter cycles past it.
  const start = needle.length > 1 ? from : from + 1;
  for (let step = 0; step < labels.length; step += 1) {
    const index = (((start + step) % labels.length) + labels.length) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(needle)) return index;
  }
  return undefined;
}
