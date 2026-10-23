# packages/wallet-sdk-react

React wallet state layer over `wallet-sdk-core`. It provides wallet connection, disconnection, signing, account lookup, wallet-provider hydration, and headless wallet-modal primitives.

Consumer-facing AI material lives in `packages/skills`; keep this file focused on maintaining this package.

## Architecture

- `SodaxWalletProvider` is the root provider. It mounts configured chain adapters and initializes services.
- `useXWalletStore.ts` is the central Zustand store for services, connectors, connections, chain actions, and hydrated wallet providers.
- `chainRegistry.ts` is the dispatch table for chain types. Add new chain-type support there instead of scattering switch statements.
- `src/core/` defines the base abstractions:
  - `XService` manages connectors and balance lookups for one chain family.
  - `XConnector` wraps a wallet integration and exposes `connect()` / `disconnect()`.
- `src/xchains/<chain>/` contains concrete service and connector implementations.
- `src/providers/<chain>/` is only for provider-managed chain families that need React context from a native SDK.

## Provider-Managed Pattern

Provider-managed chains use a Provider/Hydrator/Actions trio.

- Provider wraps the native React provider.
- Hydrator reads native hooks and is the only writer for connection state and wallet providers.
- Actions register `ChainActions` and trigger native connect/disconnect/signing calls. Actions should not write connection state directly.

Non-provider chains register actions and create wallet providers through the chain registry and store helpers.

## Configuration

`SodaxWalletProvider` accepts `SodaxWalletConfig`.

- Top-level keys are `ChainType` slots.
- Omit a slot to disable that chain type.
- Pass `{}` to mount with package defaults.
- Per-chain RPC/defaults live under the slot's `chains` map.
- `ChainMeta` in `src/types/config.ts` is the source of truth for config derivation. Update it when adding a new chain type; avoid manually syncing derived config types.

## WalletConnect And Discovery

- EVM defaults to injected-wallet discovery.
- Providing `EVM.walletConnect` adds a WalletConnect connector through wagmi config.
- WalletConnect filtering belongs in `walletConnect.qrModalOptions`; do not add wallet-specific branching to modal primitives.
- Async connector discovery belongs in `discoverConnectors` on the chain registry entry.
- `EVM.privy` (Privy email login) lives in `src/privy/` behind the `./privy` sub-path. Only files under `src/privy/` may value-import `@privy-io/react-auth` (an optional peer); `scripts/check-privy-isolation.mjs` fails the build otherwise. Core reaches it only through the opaque `PrivySource` and `src/providers/evm/privySource.ts`. Privy hooks run only in `PrivyBridge`; the connector reads them through the framework-free runtime, so its tests need no Privy import. `PrivyStartupGuard` catches only start-up throws from `PrivyProvider` (plain-http origin, malformed app id, nested provider) and keeps the app rendering; later errors pass through. `privy()` never throws — bad input warns and yields a disabled source, like a missing WalletConnect `projectId`.
- `EvmActions.disconnect` ends every wagmi connection, not only the current one — EVM is one logical connection, and a lingering one would come back through `ConnectorAlreadyConnectedError` without its own sign-in. Each is bounded by `EVM_DISCONNECT_TIMEOUT_MS`, so a stalled wallet cannot hold `useXDisconnect` or batch disconnect. It also runs the Privy source's `disconnect` (an `EvmActions` prop from `EvmProvider`): a Privy restore in flight has no wagmi connection yet.
- The Privy connector's `disconnect()` never awaits Privy's logout: wagmi's disconnect action writes back the connection list it read before awaiting, wiping a wallet connected meanwhile. The sign-out runs in the background; until Privy confirms it, a marker — in localStorage and in memory, so a refused storage write cannot drop it — makes the next connect sign out first. Its login counts as done only once Privy's modal closes — Privy creates a new user's wallet there, and creating one alongside would make a second. A replacement wallet object's provider attaches only if no chain switch overtook its preparation; otherwise it is prepared again for the current chain.

## Hooks And Store Rules

All public hooks read through the Zustand store or registered chain actions. Do not call native chain SDK hooks from generic public hooks.

Important hooks:

- `useXConnect`, `useXDisconnect`, `useXSignMessage`
- `useXAccount`, `useXAccounts`, `useXConnection`
- `useXConnectors`, `useXService`, `useWalletProvider`
- `useEvmSwitchChain`
- wallet-modal hooks such as `useWalletModal`, `useConnectionFlow`, `useBatchConnect`, `useBatchDisconnect`, `useChainGroups`, and `useConnectedChains`

Persisted state is intentionally limited. When changing persistence, preserve existing storage compatibility unless the task explicitly includes a migration.

## Subpath Exports

The barrel export is for hooks, public utilities, interfaces, types, and `SodaxWalletProvider`.

Concrete chain classes stay behind deep imports such as `@sodax/wallet-sdk-react/xchains/bitcoin`. Do not add concrete `xchains/<chain>` class exports to `src/index.ts` unless there is a deliberate public API decision.

## Adding A New Chain Type

> This is one slice of a full chain integration. For the end-to-end cross-package flow (types, sdk spoke, wallet-sdk-core), use the `add-chain` skill (`.claude/skills/add-chain/`).
>
> To add another **wallet/connector to a chain that already exists** (not a new chain), use the `add-wallet-provider` skill (`.claude/skills/add-wallet-provider/`).

1. Create `src/xchains/<chain>/` with service, connector, and an `index.ts` barrel.
2. Extend `XService` and `XConnector`; keep connector IDs and install metadata stable.
3. Add a `chainRegistry` entry with service creation, default connectors, provider-management mode, and optional actions/discovery/provider creation.
4. Add the config source-of-truth entry in `src/types/config.ts`.
5. If the native SDK requires React context, add Provider/Hydrator/Actions under `src/providers/<chain>/` and mount it conditionally in `SodaxWalletProvider.tsx`.
6. Add tests for registry behavior, store updates, and connector/provider creation.
7. Update package exports and consumer-facing skills/docs only when the public API changes.

## Wallet Modal Primitives

These primitives are headless and render-agnostic.

- Keep state discriminated by `state.kind`.
- Keep EVM represented as one logical connection group spanning configured EVM networks.
- Use shared identifier matching through the existing utilities.
- Surface raw `Error` objects; do not introduce a wallet-modal-specific error taxonomy without a broader design decision.

Reference implementation: `apps/wallet-modal-example`.

## Docs Links

`README.md` is generated into the docs.sodax.com Mintlify site, which does not receive this package's `docs/` tree. Links from `README.md` into `docs/**` (and any other in-repo path) must be absolute `https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-react/…` URLs; relative ones 404 on the published page. Links between the `docs/**` guides themselves stay relative — those files are not published. Gate: `pnpm check:doc-links`.

## Build And Tests

```bash
cd packages/wallet-sdk-react
pnpm test
pnpm build
pnpm checkTs
```

The package builds ESM with declaration output and subpath entries for chain implementations. Preserve `instanceof` behavior across barrel/deep import paths.

`./privy` declarations come from a second pass (`tsup.privy-dts.config.ts`); keep them out of the main pass — emitted together, the declaration worker outgrows 8 GB build machines (Vercel previews). Its JavaScript stays in the main pass: it shares the `EVM.privy` source registry chunk with the barrel.

`checkTs` typechecks test files too (`.test.ts` and `.test.tsx`): `tsconfig.json` deliberately does
not exclude them, and the shared `scripts/check-tests-typechecked.mjs` (repo root, the tail of
`checkTs`) fails loudly if a future exclude hides them again. It also requires a one-line
why-comment on every `as unknown as` in a test file, with pre-existing undocumented casts
grandfathered in this package's `scripts/test-cast-comment-baseline.json`, which may only shrink.
