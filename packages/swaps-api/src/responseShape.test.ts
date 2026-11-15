/**
 * sodax-api-response-shape: field removal/rename, type, optionality and literal changes fail snapshots.
 * Update intentionally: pnpm --filter @sodax/swaps-api exec vitest run src/responseShape.test.ts -u
 * Intentional breaking changes need versioning: a new field, endpoint, or version.
 */
import { expect, it } from 'vitest';
import * as schemas from './schemas.js';
import * as rawTx from './rawTxSchemas.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describeShape(schema: unknown): unknown {
  if (!isRecord(schema)) throw new Error('Expected a schema');
  const { type } = schema;
  if (Array.isArray(schema.pipe)) {
    const [base, ...actions] = schema.pipe;
    return {
      pipe: [
        describeShape({ ...base, pipe: undefined }),
        ...actions.map(action => {
          if (!isRecord(action) || typeof action.type !== 'string') throw new Error('Invalid pipe action');
          return {
            action: action.type,
            ...(action.requirement === undefined
              ? {}
              : {
                  requirement: action.requirement instanceof RegExp ? String(action.requirement) : action.requirement,
                }),
          };
        }),
      ],
    };
  }
  switch (type) {
    case 'object':
      if (!isRecord(schema.entries)) throw new Error('Invalid object entries');
      return {
        object: Object.fromEntries(
          Object.entries(schema.entries)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, field]) => [name, describeShape(field)]),
        ),
      };
    case 'optional':
    case 'nullable':
    case 'nullish':
      return { [type]: describeShape(schema.wrapped) };
    case 'array':
      return { array: describeShape(schema.item) };
    case 'union':
    case 'variant':
      if (!Array.isArray(schema.options)) throw new Error('Invalid options');
      return { [type]: schema.options.map(describeShape), ...(type === 'variant' ? { key: schema.key } : {}) };
    case 'picklist':
      return { picklist: schema.options };
    case 'literal':
      return { literal: schema.literal };
    case 'record':
      return { record: { key: describeShape(schema.key), value: describeShape(schema.value) } };
    case 'lazy':
      if (typeof schema.getter !== 'function') throw new Error('Invalid lazy getter');
      return { lazy: describeShape(schema.getter()) };
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'unknown':
    case 'custom':
      return type;
    default:
      throw new Error(`Unhandled schema kind: ${String(type)}`);
  }
}

// One key per chain family, plus the unmapped fallback; Bitcoin has a distinct bridge schema.
const chainKeys = [
  'sonic',
  'solana',
  'sui',
  'stellar',
  'injective-1',
  '0x1.icon',
  'stacks',
  'near',
  'bitcoin',
  'not-a-real-chain',
];

it('preserves every exported backend response shape', async () => {
  const shapes: Record<string, unknown> = {};
  for (const [moduleName, module] of Object.entries({ schemas, rawTx })) {
    for (const [name, value] of Object.entries(module).sort(([a], [b]) => a.localeCompare(b))) {
      if (isRecord(value) && value.kind === 'schema') {
        shapes[`${moduleName}.${name}`] = describeShape(value);
      } else if (typeof value === 'function') {
        for (const chainKey of chainKeys) {
          const txSchema = rawTx.rawTxSchemaForChainKey(chainKey);
          const schema = value === rawTx.rawTxSchemaForChainKey ? value(chainKey) : value(txSchema);
          shapes[`${moduleName}.${name}(${chainKey})`] = describeShape(schema);
        }
      }
    }
  }
  await expect(`${JSON.stringify(shapes, null, 2)}\n`).toMatchFileSnapshot('./__snapshots__/response-shapes.snap');
});
