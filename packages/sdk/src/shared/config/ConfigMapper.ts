import type { XToken } from '@sodax/types';

export function parseTokenArrayFromJson(input: unknown): readonly XToken[] {
  if (!Array.isArray(input)) {
    throw new TypeError('Input must be an array');
  }

  const tokens: XToken[] = [];
  for (let idx = 0; idx < input.length; idx++) {
    const item = input[idx];
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>).symbol !== 'string' ||
      typeof (item as Record<string, unknown>).name !== 'string' ||
      typeof (item as Record<string, unknown>).address !== 'string' ||
      typeof (item as Record<string, unknown>).decimals !== 'number'
    ) {
      throw new TypeError(`Item at index ${idx} is not a valid Token`);
    }
    tokens.push(item as XToken);
  }

  return tokens;
}
