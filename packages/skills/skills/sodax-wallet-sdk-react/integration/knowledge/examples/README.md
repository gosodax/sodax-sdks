# Examples

Copy-paste-runnable code examples. Each file is complete — drop it into a fresh React 19 project with `@sodax/wallet-sdk-react` + `@tanstack/react-query` installed and it works.

For narrative + step-by-step explanation, see [`../recipes/`](../recipes/). Examples here are pure code with minimal comments.

| File | Use case | Lines |
|---|---|---|
| [`01-minimal-evm.tsx`](./01-minimal-evm.tsx) | Smallest working setup — provider + 1 connect button | ~50 |
| [`02-multi-chain-modal.tsx`](./02-multi-chain-modal.tsx) | Headless wallet modal with chain → connector → connecting flow | ~120 |
| [`03-nextjs-app-router.tsx`](./03-nextjs-app-router.tsx) | Next.js 15 App Router setup (SSR + `'use client'`) | ~60 |
| [`04-walletconnect-setup.tsx`](./04-walletconnect-setup.tsx) | WalletConnect connector setup (with optional single-wallet filter) | ~50 |

## Conventions

- All files use TypeScript (`.tsx`).
- All consumer components have `'use client'` (Next.js compatible).
- `walletConfig` is defined as a **module-level constant** — never created inside a component (the provider freezes config on first render).
- `QueryClient` is also a module-level constant — one client per app, shared across providers.
- Examples use `<button>`, `<select>`, `<dialog>` etc. directly — bring your own UI library.

## Running an example

```bash
pnpm add @sodax/wallet-sdk-react @tanstack/react-query
# also: react@>=19, react-dom@>=19
```

Drop the file into your app, mount the provider component at the root, and use the consumer component anywhere below it.
