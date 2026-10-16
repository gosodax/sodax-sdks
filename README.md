[![CI](https://github.com/icon-project/sodax-sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/icon-project/sodax-sdks/actions/workflows/ci.yml)
[![Security](https://github.com/icon-project/sodax-sdks/actions/workflows/security.yml/badge.svg)](https://github.com/icon-project/sodax-sdks/actions/workflows/security.yml)

# SODAX SDKs

This repository contains the SDK packages and demo applications for the SODAX project, organized as a Turborepo + pnpm monorepo.

## Architecture

SODAX is a cross-chain DeFi platform built on a **hub-and-spoke architecture**, with **Sonic** as the hub chain. It supports swaps (intent-based via solver), lending/borrowing (money market), staking, bridging, DEX (concentrated liquidity), token migration, partner fee operations, and recovery (withdrawing stuck hub-wallet assets) across a mainnet network of EVM and non-EVM spoke chains that route through the Sonic hub:

- **EVM:** Sonic, Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood
- **Non-EVM:** Solana, Sui, Stellar, ICON, Injective, NEAR, Stacks, Bitcoin

The supported chains are source-of-truth in `@sodax/types` — see `ChainKeys` for the authoritative, current list.

See the [SODAX SDK README](./packages/sdk/README.md) for a deeper architectural overview.

## AI Agent Skills

Building with the `@sodax/*` SDKs in an AI coding agent (Claude Code, Cursor, Codex, Copilot, and 50+ others)? Install the official SODAX skills — agent-native guides covering integration and v1→v2 migration for every package:

```bash
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

Browse them on [skills.sh](https://www.skills.sh/icon-project/sodax-sdks). See the [Skills Documentation](./packages/skills/README.md) for what ships and how to use it.

## Repository Structure

### Packages (`/packages`)

- **types** (`/packages/types`) — Shared TypeScript type definitions: chain IDs, chain configs, wallet provider interfaces, backend API types. No runtime dependencies.
- **libs** (`/packages/libs`): Internal dependency isolation package. Bundles selected third-party libraries and re-exports them via stable subpaths so SODAX SDKs and consuming apps don't need bundler-specific workarounds. [Libs Documentation](./packages/libs/README.md).
- **sdk** (`/packages/sdk`) — Core SDK exposing the full SODAX feature set (swap, bridge, money market, staking, DEX, migration, partner) through a streamlined `Sodax` facade. [SODAX SDK Documentation](./packages/sdk/README.md).
- **wallet-sdk-core** (`/packages/wallet-sdk-core`) — Low-level multi-chain wallet providers (signing, broadcasting) for 9 chain types. Supports both private-key (scripts/testing) and browser-extension (production) configs.
- **wallet-sdk-react** (`/packages/wallet-sdk-react`) — React layer over `wallet-sdk-core` with the `XService`/`XConnector` pattern, Zustand state persistence, and EIP-6963 wallet discovery. [Wallet SDK Documentation](./packages/wallet-sdk-react/README.md).
- **dapp-kit** (`/packages/dapp-kit`) — High-level React hooks combining the SDK, `wallet-sdk-react`, and React Query. Modular, production-ready building blocks for dApp development. [dApp Kit Documentation](./packages/dapp-kit/README.md).
- **skills** (`/packages/skills`) — AI-agent skills and knowledge for the `@sodax/*` SDKs (mode-gated per-SDK-package skills: `sdk`, `wallet-sdk-core`, `wallet-sdk-react`, `dapp-kit` — each bundling `integration/knowledge/` for new v2 code and `migration-v1-to-v2/knowledge/` for v1→v2 porting — plus a cross-cutting `sodax-build` front-door / ideation skill). No runtime code. Distributed via the [`skills` CLI](https://github.com/vercel-labs/skills) or `@sodax/skills` on npm. [Skills Documentation](./packages/skills/README.md).

### Apps (`/apps`)

- **demo** (`/apps/demo`) — Vite + React demo app showcasing the SDK.
- **node** (`/apps/node`) — Node.js scripts for E2E testing chain operations, with per-chain entry points.
- **node-cjs** (`/apps/node-cjs`) — CommonJS consumer regression test (verifies SDK CJS output works).
- **wallet-modal-example** (`/apps/wallet-modal-example`) — Vite + React demo for the Wallet React SDK.
- **stellar-sponsor-example** (`/apps/stellar-sponsor-example`) — Vite + React demo for the Stellar sponsored-activation journey (activate → fund → trustline), with an offline test lab that exercises every sponsoring failure class against a bundled mock backend.

## Common Commands

```bash
pnpm i                # Install dependencies
pnpm dev:demo         # Run demo app dev server
pnpm build            # Build everything (packages, then apps)
pnpm build:packages   # Build only SDK packages
pnpm lint             # Lint with Biome (auto-fixes)
pnpm checkTs          # TypeScript type checking across all packages
pnpm test             # Run tests across all packages
```

Package manager: **pnpm 10.32.1**. Tested against Node.js 20.x, 22.x, 24.x.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Publishing

Instructions for releasing new packages: [packages/RELEASE_INSTRUCTIONS.md](./packages/RELEASE_INSTRUCTIONS.md).
