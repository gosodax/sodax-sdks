# AI Rules — Fresh Integration

You are integrating `@sodax/wallet-sdk-react` into a user's React app for the first time. Follow this protocol exactly.

---

## Workflow (do these in order)

### 1. Survey the project

Before changing anything, gather context:

```bash
# Framework — Next.js (App Router or Pages)? Vite? CRA?
cat <user>/package.json | grep -E '"next|"vite|"react-scripts'

# React version — must be >= 19
cat <user>/package.json | grep '"react"'

# React Query already installed?
cat <user>/package.json | grep '"@tanstack/react-query'

# Existing wallet libraries that may conflict
grep -l "wagmi\|@solana/wallet-adapter\|@mysten/dapp-kit-react" <user>/package.json
```

**If React < 19**, stop and tell the user — this package requires React 19.

**If wagmi / @solana/wallet-adapter / @mysten/dapp-kit-react are already direct dependencies**, stop and ask the user — this package mounts those internally; running both will cause duplicate provider context errors.

### 2. Always start with `setup.md`

Read [`recipes/setup.md`](./recipes/setup.md) and apply it. **Do not skip ahead** — every subsequent recipe assumes `SodaxWalletProvider` is already mounted.

### 3. Pick exactly one connect UX

Connect UX is **either / or**, not additive:

- [`recipes/connect-button.md`](./recipes/connect-button.md) — pick this when the app needs to connect one chain at a time, and the UX is a single button per chain.
- [`recipes/multi-chain-modal.md`](./recipes/multi-chain-modal.md) — pick this when the app needs a chain-picker → connector-picker modal, or when one wallet should connect multiple chains in sequence.

Ask the user which UX they want before applying. If unsure, default to `connect-button.md` (simpler).

### 4. Add advanced features as separate steps

Only after the connect UX works should you add:

- Sign-message flows ([`recipes/sign-message.md`](./recipes/sign-message.md))
- Bridge to `@sodax/sdk` calls ([`recipes/bridge-to-sdk.md`](./recipes/bridge-to-sdk.md))
- Switch active EVM network ([`recipes/switch-chain.md`](./recipes/switch-chain.md))
- Chain & wallet detection patterns ([`recipes/chain-detection.md`](./recipes/chain-detection.md))
- WalletConnect ([`recipes/walletconnect-setup.md`](./recipes/walletconnect-setup.md))
- Batch connect / disconnect ([`recipes/batch-operations.md`](./recipes/batch-operations.md))

Each is independent — apply only what the user asked for.

### Copy-paste templates

If the user wants a full working starter file rather than narrative steps, point them at [`examples/`](./examples/):

- `01-minimal-evm.tsx` — provider + 1 connect button
- `02-multi-chain-modal.tsx` — full headless modal
- `03-nextjs-app-router.tsx` — Next.js 15 SSR setup
- `04-walletconnect-setup.tsx` — WalletConnect setup (optional single-wallet filter)

Always combine with the narrative recipe — examples are skeletons, recipes explain why each piece exists.

---

## DO

- **DO** put `SodaxWalletProvider` at the app root, inside `QueryClientProvider`. Order matters.
- **DO** include only the chain slots the user actually needs in `walletConfig`. Each slot mounts a real React provider — unused slots waste bundle size.
- **DO** use the chain-typed hooks: `useXAccount({ xChainType: 'EVM' })`, not `useXAccount({ xChainId: someId })` unless the user specifically needs per-chain-id resolution.
- **DO** gate UI on `useConnectedChains().status === 'ready'` whenever you render based on connection state — prevents hydration flicker on Next.js.
- **DO** use the headless primitives (`useWalletModal`, `useChainGroups`) and let the user style the UI. Do not hand-roll a hidden chain registry.
- **DO** if Next.js, set `EVM.ssr: true` in `walletConfig`.

---

## DO NOT

- **DO NOT** import from `@sodax/wallet-sdk-react/xchains/<chain>` unless you specifically need a concrete class (e.g. `instanceof XverseXConnector`). Default to barrel imports.
- **DO NOT** instantiate `XService` or `XConnector` subclasses manually — `SodaxWalletProvider` does this via the chain registry.
- **DO NOT** call `useXConnect` outside a React component / custom hook.
- **DO NOT** read from `useXWalletStore` directly. Use the public hooks. The store shape is internal.
- **DO NOT** stack multiple `SodaxWalletProvider` instances. One per app.
- **DO NOT** pass changing config references on every render — `SodaxWalletProvider` freezes config on first render. To swap config at runtime, remount with a new `key`.
- **DO NOT** mock `useXConnect` / `useXAccount` in tests by stubbing the store. Use the real provider with a test config.

---

## Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| User asks for a chain not in the [chain support list](./reference/chain-support.md) | Adding a new chain requires package-level changes (see `../../CLAUDE.md`), not user-app integration. |
| User wants to use `@sodax/sdk` for swaps / lending / etc. | This package only handles wallet connectivity. Direct user to also install `@sodax/dapp-kit`. |
| User wants Server Components to use `useXAccount` directly | Hooks are client-only. Must wrap consumer in `'use client'`. |
| User mentions Next.js Pages Router | Setup differs slightly — confirm before applying App Router defaults. |
| User asks "how do I connect wallet X" but the connector isn't built in | Check [`reference/connectors.md`](./reference/connectors.md). If absent, the connector doesn't exist yet — flag as out of scope. |
| User wants custom chains (e.g. EVM testnet not in the default list) | `EVM.chains` accepts custom chain configs, but ChainKey enum is fixed. Confirm before extending. |

---

## Verification protocol (after every recipe)

```bash
# 1. Type check passes
pnpm checkTs

# 2. Provider is mounted exactly once
grep -rn "SodaxWalletProvider" <user-src>           # expect one match

# 3. QueryClientProvider wraps SodaxWalletProvider
# (manual — open the provider file, confirm nesting order)

# 4. Connect/disconnect works in dev
# (manual — start dev server, click connect, verify localStorage has `xwagmi-store` key after success)
```

If steps 1–3 pass and the user confirms step 4, the recipe is done.

---

## Done criteria

The integration is complete when:

- [ ] `pnpm checkTs` exits clean.
- [ ] `SodaxWalletProvider` is mounted at the app root with the user's chosen `walletConfig`.
- [ ] `QueryClientProvider` wraps `SodaxWalletProvider`.
- [ ] At least one connect UX (button or modal) is wired and works in the user's dev environment.
- [ ] If using `@sodax/sdk` features: `useWalletProvider` is used to bridge to SDK calls (see `recipes/setup.md` § "Pair with `@sodax/sdk`").

Do not declare integration done before all of the above are true.
