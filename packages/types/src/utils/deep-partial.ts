/** Arrays and primitives are kept as-is because `deepMerge` replaces them wholesale rather than merging elements. */
export type DeepPartial<T> = T extends readonly (infer U)[]
  ? readonly U[]
  : T extends (infer U)[]
    ? U[]
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;
