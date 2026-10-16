# Sub-path Exports

`@sodax/wallet-sdk-react` ships a **two-tier export surface**:

- **Barrel** — `import { useXConnect, type IXConnector } from '@sodax/wallet-sdk-react'` exposes hooks, types, the abstract `XConnector` base, and `<SodaxWalletProvider>`.
- **Sub-path** — `import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin'` exposes concrete connector / service classes for advanced use (`instanceof` checks, calling chain-specific methods).

The split is deliberate: keeping concrete classes off the barrel prevents accidental coupling to internal implementations and lets the SDK refactor chain code without breaking consumers.

This document covers the build-time plumbing that makes sub-paths work.

## Table of contents

1. [Why two tiers](#why-two-tiers)
2. [What's exported where](#whats-exported-where)
3. [`tsup` multi-entry build](#tsup-multi-entry-build)
4. [`package.json` `exports` + `typesVersions`](#packagejson-exports--typesversions)
5. [`instanceof` semantics across entry points](#instanceof-semantics-across-entry-points)
6. [Common errors and fixes](#common-errors-and-fixes)

---

## Why two tiers

Three reasons:

**1. Coupling control.** A consumer that imports `EvmXConnector` from the barrel implicitly depends on a concrete class. Six months later when the SDK refactors how EVM connectors are constructed (e.g. moves from one connector class per wagmi connector to a polymorphic dispatcher), every consumer that did the deep dependency breaks. Forcing `instanceof` users to deep-import makes the dependency explicit and visible to the SDK author at refactor time.

**2. Tree-shaking efficiency.** The barrel re-exports hooks and types only — small surface area, small bundle. Consumers who never touch `XverseXConnector` don't pay its cost. Sub-path imports pull only the chain they reference.

**3. AI agent / IDE intent signal.** Code reviewers and autocomplete see at a glance whether a file is using "everyday hooks" (barrel) or "chain-specific advanced features" (deep import). The latter typically warrants a closer look.

---

## What's exported where

### Barrel (`@sodax/wallet-sdk-react`)

Everything in `src/index.ts` — hooks, utils, types, interfaces, the `<SodaxWalletProvider>` component, and the abstract `XConnector` / `XService` base classes:

```typescript
// ✅ Barrel imports
import {
  SodaxWalletProvider,
  useXConnect,
  useXAccount,
  useWalletProvider,
  useWalletModal,
  useBatchConnect,
  XConnector,                       // abstract base — for custom connectors
  type IXConnector,                 // interface
  type IXService,                   // interface
  type SodaxWalletConfig,
  type XAccount,
  type XConnection,
  sortConnectors,
} from '@sodax/wallet-sdk-react';
```

### Sub-paths (`@sodax/wallet-sdk-react/xchains/<chain>`)

Concrete classes — one barrel per chain folder:

```typescript
// ✅ Sub-path imports
import { EvmXConnector, EvmXService, createWagmiConfig } from '@sodax/wallet-sdk-react/xchains/evm';
import { SolanaXConnector, SolanaXService } from '@sodax/wallet-sdk-react/xchains/solana';
import { SuiXConnector, SuiXService } from '@sodax/wallet-sdk-react/xchains/sui';
import {
  BitcoinXService,
  BitcoinXConnector,    // abstract
  UnisatXConnector,     // concrete
  XverseXConnector,     // concrete
  OKXXConnector,        // concrete
  useBitcoinXConnectors,
  type BtcWalletAddressType,
} from '@sodax/wallet-sdk-react/xchains/bitcoin';
import { StellarXService, StellarWalletsKitXConnector } from '@sodax/wallet-sdk-react/xchains/stellar';
import { InjectiveXConnector, InjectiveXService } from '@sodax/wallet-sdk-react/xchains/injective';
import { IconXService, IconHanaXConnector, CHAIN_INFO, SupportedChainId } from '@sodax/wallet-sdk-react/xchains/icon';
import { NearXConnector, NearXService } from '@sodax/wallet-sdk-react/xchains/near';
import {
  StacksXService,
  StacksXConnector,
  STACKS_PROVIDERS,
  useStacksXConnectors,
  type StacksProviderConfig,
} from '@sodax/wallet-sdk-react/xchains/stacks';
```

For the full list, see [`CONNECTORS.md`](./CONNECTORS.md#sub-path-imports--concrete-classes).

### Concrete chain symbols live only in sub-paths

Concrete connector / service classes — and their named types — are not re-exported from the barrel. Even a `type`-only reference must come from the sub-path; `import type { XverseXConnector } from '@sodax/wallet-sdk-react'` fails with TS2305 / TS2724.

```typescript
// ✅ Sub-path — works for both `type` and runtime use
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
import type { BtcWalletAddressType } from '@sodax/wallet-sdk-react/xchains/bitcoin';
```

If a cross-cutting type genuinely needs to be available from the barrel (typing a function param, narrowing a return type), add it as `export type { ... }` in `src/index.ts` — but the default is sub-path-only.

---

## `tsup` multi-entry build

[`tsup.config.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/tsup.config.ts) declares one entry per public boundary:

```typescript
// 'src/index.ts' plus every src/xchains/<chain>/index.ts(x), listed from the directory.
const mainEntries = ['src/index.ts', ...chainEntries];

export default defineConfig({
  entry: [...mainEntries, 'src/privy/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  splitting: true,
  dts: { entry: mainEntries }, // `./privy` declarations: tsup.privy-dts.config.ts
  external: ['react', 'react-dom', '@tanstack/react-query'],
  // ...
});
```

The build is ESM-only with `splitting: true` so chunks are shared across entry points and `instanceof XverseXConnector` works regardless of which entry the connector was imported from. React-only consumers (Vite, Next.js, esbuild, Webpack) all resolve ESM by default — no CJS output is shipped.

DTS is generated by tsup's internal `rollup-plugin-dts` integration, which emits `.d.ts` declarations. The build script wraps tsup in `NODE_OPTIONS=--max-old-space-size=8192` because rollup-plugin-dts inlines transitive dep types and otherwise OOMs the default V8 heap on this package's type graph.

The `./privy` entry's JavaScript is built in the same pass, because it shares the chunk that registers `EVM.privy` sources with the barrel. Its declarations come from a second pass, [`tsup.privy-dts.config.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/tsup.privy-dts.config.ts), which takes a few seconds on its own. Emitted together with the other entries, they push the declaration worker past the memory of 8 GB build machines such as Vercel's preview builders, so keep the passes separate.

### Adding a new chain

The entry list is **auto-discovering** — `tsup.config.ts` lists every `src/xchains/<chain>/index.ts(x)`, so creating `src/xchains/aptos/index.ts` automatically produces `dist/xchains/aptos/index.{mjs,d.ts}` on next build. No `tsup.config.ts` edit required. It reads the directory rather than using a glob because tsup does not expand globs in `dts.entry`. See [`ADDING_A_NEW_CHAIN.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md#step-4--xchainschainindexts-barrel-for-sub-path-export).

---

## `package.json` `exports` + `typesVersions`

Two fields work together to support modern bundlers and legacy `moduleResolution: "node"`:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs"
    },
    "./xchains/*": {
      "types": "./dist/xchains/*/index.d.ts",
      "import": "./dist/xchains/*/index.mjs"
    },
    "./privy": {
      "types": "./dist/privy/index.d.ts",
      "import": "./dist/privy/index.mjs"
    }
  },
  "typesVersions": {
    "*": {
      "xchains/*": ["./dist/xchains/*/index.d.ts"],
      "privy": ["./dist/privy/index.d.ts"]
    }
  }
}
```

| Field | Read by | Purpose |
|-------|---------|---------|
| `exports['.']` | All bundlers (Vite, Webpack, esbuild, Next.js), modern Node | Resolves `@sodax/wallet-sdk-react` to the ESM artifact + types |
| `exports['./xchains/*']` | Same | Wildcard maps `@sodax/wallet-sdk-react/xchains/<chain>` to the matching `dist/xchains/<chain>/index.mjs` |
| `typesVersions['xchains/*']` | TypeScript with `moduleResolution: "node"` (legacy) | Fallback for TS configs that don't honor the `exports` field's `types` condition |
| `exports['./privy']` | Same | The opt-in Privy email login (`privy()` for `EVM.privy`). The only entry that imports `@privy-io/react-auth`, an optional peer — see [`WALLET_PRIVY.md`](./WALLET_PRIVY.md) |

Modern projects with `"moduleResolution": "bundler"` or `"node16"` only need `exports`. `typesVersions` ensures sub-path types resolve for older configs that still see `@sodax/wallet-sdk-react/xchains/bitcoin` as a path traversal.

If a consumer reports "Cannot find module" for sub-paths in TypeScript, check their `tsconfig.json` `moduleResolution` setting first.

`./privy` is guarded after every build by `scripts/check-privy-isolation.mjs`: no emitted file outside `dist/privy/` may import `@privy-io/*`. With `splitting: true`, a single value import of Privy from a module the main entry also reaches would land in a shared chunk and break every partner who has not installed Privy — keep Privy imports inside `src/privy/`, and `import type` anywhere else.

---

## `instanceof` semantics across entry points

Class identity is preserved across barrel and sub-path entries by tsup's `splitting: true`, which emits shared chunks:

```typescript
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
const connectors = useXConnectors({ xChainType: 'BITCOIN' });
const xverse = connectors.find(c => c instanceof XverseXConnector); // ✅ may be true
```

The package is ESM-only — browser apps (Vite, Next.js) and Node consumers both resolve through the same `.mjs` chunks, so `instanceof` holds regardless of whether the connector was imported via the barrel or via a sub-path.

---

## Common errors and fixes

### `Cannot find module '@sodax/wallet-sdk-react/xchains/bitcoin'`

- **TypeScript**: check `moduleResolution` is `"bundler"`, `"node16"`, or `"nodenext"`. Older `"node"` setting needs `typesVersions` (already provided in this package).
- **Bundler**: check `package.json` is being read — some monorepos with custom resolvers ignore `exports`. `require.resolve()` is not a valid probe here: the package is ESM-only and the `./xchains/*` entry declares only `types` and `import`, so CJS resolution throws `ERR_PACKAGE_PATH_NOT_EXPORTED` even against a correct install. Verify with `node --input-type=module -e "console.log(import.meta.resolve('@sodax/wallet-sdk-react/xchains/bitcoin'))"`, which prints the path to `dist/xchains/bitcoin/index.mjs`, or check that `node_modules/@sodax/wallet-sdk-react/dist/xchains/bitcoin/index.mjs` exists on disk.

### `XverseXConnector is not exported from '@sodax/wallet-sdk-react'`

Expected — concrete connector classes are NOT re-exported from the barrel. Switch to:

```typescript
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
```

The error message can also appear if you tried `import type { XverseXConnector } from '@sodax/wallet-sdk-react'` and then used it as a runtime value — `export type` only covers type position.

### `instanceof XverseXConnector` returns `false` for a connector that should match

Likely caused by the package being loaded twice (e.g. duplicate copies under different `node_modules` paths, or a bundler config that splits the dependency across chunks without dedup). Verify there is exactly one `@sodax/wallet-sdk-react` in your dependency tree (`pnpm why @sodax/wallet-sdk-react`).

### `Module not found: '@sodax/wallet-sdk-react/xchains/aptos'` after adding a new chain

Run `pnpm build:packages` — `dist/xchains/aptos/` only exists after a build. The `exports` wildcard resolves at runtime, so consumer apps need the freshly-built artifact.

---

## Related docs

- [Connectors](./CONNECTORS.md) — full sub-path map per chain
- [Adding a New Chain](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md) — Step 4 covers the barrel that powers a new sub-path
- [Architecture](./ARCHITECTURE.md) — store-first hooks consume only barrel exports
- [tsup reference](https://tsup.egoist.dev/) — bundler config reference
- [Node.js subpath exports](https://nodejs.org/api/packages.html#subpath-exports) — the spec behind `package.json` `exports`
