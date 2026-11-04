import * as v from 'valibot';
import { FillEventSchema, OracleCandleIntervalSchema } from './backendApiSchemas.js';
import type { OracleCandleInterval } from './BackendApiService.js';

export type FillEvent = v.InferOutput<typeof FillEventSchema>;

/** Narrows an `IntentResponse.events` entry, which is typed `unknown[]`. */
export const isFillEvent = (value: unknown): value is FillEvent => v.is(FillEventSchema, value);

/** Narrows an oracle markets `intervals[].key`, which is `string` so discovery tolerates an unknown interval. */
export const isOracleCandleInterval = (value: string): value is OracleCandleInterval =>
  v.is(OracleCandleIntervalSchema, value);
