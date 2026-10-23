# Recipe: Email Login with Privy (EVM only)

Add an **"Email (Privy)"** entry to the EVM wallet list: the user logs in with an email one-time code and gets a Privy embedded wallet that signs like any other EVM wallet. Opt-in, behind the `@sodax/wallet-sdk-react/privy` sub-path.

**Depends on:** [`setup.md`](./setup.md) · **Full file:** [`examples/05-privy-email-login.tsx`](../examples/05-privy-email-login.tsx)

You write the code. The user owns the Privy app and receives the email code, so step 0 asks them first and the [Verification](#verification) hands them the login test.

---

## 0. Ask the user before coding

1. **Trade-offs.** Tell them (full text in the [package guide](https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/WALLET_PRIVY.md)): Privy custodies access, so no signing is possible while Privy is unreachable; addresses belong to their Privy app; a user who loses their email loses the wallet; their Privy app is billed per signature.
2. **Their Privy App ID.** If they have none, give them this checklist for dashboard.privy.io:
   - Create an app and copy its App ID.
   - Enable **Email** login and **Ethereum embedded wallets**. The SDK shows email login only.
   - Allow every origin the app runs on: `http://localhost:<port>`, production, and each preview URL. Wildcards such as `https://*.vercel.app` are refused, and Privy requires https except on `localhost` / `127.0.0.1` — a dev server opened by LAN IP fails with "Embedded wallet is only available over HTTPS".
   - To test without an inbox, enable test accounts (`test-XXXX@privy.io` with a fixed code).
3. **Privy's confirmation screens (`showWalletUIs`).** With them on, Privy confirms every signature and transaction, and a transaction's hash arrives only after Privy has waited for the receipt and the user has closed its success screen. `false` returns the hash right after broadcast and leaves the app's own review step as the only confirmation. Unset follows the dashboard.
4. **Shared devices (`disconnectBehavior`).** `'logout'` (default) signs the user out of Privy on disconnect, so the next connect needs a new code; `'detach'` keeps the Privy session for anyone using that browser.
5. **App already on Privy?** If it mounts its own `PrivyProvider` only for email login and the embedded wallet, remove that provider, pass the same `appId` to `privy()` and skip the install (its `@privy-io/react-auth` must be 3.40 or newer). If it needs its own Privy configuration — other login methods, other chains, or a Privy session that must outlive a wallet disconnect — do not add `EVM.privy`: the SDK cannot use a provider the app mounts, and Privy allows only one.

---

## 1. Install the peer and store the App ID

```bash
pnpm add @privy-io/react-auth
```

- `@privy-io/react-auth` is an optional peer of `@sodax/wallet-sdk-react` — it is not installed automatically. It must be 3.40 or newer.
- **The App ID is public:** it ships in the browser bundle. Keep it in a public env var (`NEXT_PUBLIC_PRIVY_APP_ID` on Next.js, `VITE_PRIVY_APP_ID` on Vite). Unlike a SODAX API key, it needs no backend proxy.
- **npm / yarn:** Privy needs the app's top-level `viem` at 2.44 or newer; an older one fails at import with `does not provide an export named 'tempoModerato'`. pnpm is not affected.
- **Monorepo:** make the app and the SDK resolve one copy of `@privy-io/react-auth` (Vite: `resolve.dedupe: ['@privy-io/react-auth']`), or `usePrivy()` reads a different context than the provider the SDK mounts.
- **Content-Security-Policy:** if the site sends one, allow `https://auth.privy.io` in `connect-src`, `frame-src` and `child-src`.
- webpack warnings about `@farcaster/mini-app-solana` and a "Critical dependency" in `ox` are harmless for EVM-only use.

---

## 2. Pass `privy()` as `EVM.privy`

```typescript
'use client'; // Next.js App Router: privy()'s value cannot cross from a Server Component

import { type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { privy } from '@sodax/wallet-sdk-react/privy';
import { ChainKeys } from '@sodax/types';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    chains: { [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://mainnet.base.org' } },
    // An unset env var only logs a warning and leaves "Email (Privy)" out; privy() never throws.
    privy: privy({ appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '' }),
  },
};
```

`useXConnectors({ xChainType: 'EVM' })` now includes a connector with `id === 'privy'` (`PRIVY_CONNECTOR_ID`). **No UI changes required.** Options: `appId` (required), `clientId` (a Privy app client, for per-environment settings), `defaultChain` (an EVM `ChainKey`, default Sonic), `showWalletUIs` and `disconnectBehavior` (the user's answers from step 0), `appearance`, `legal`. If Privy cannot start (plain-http origin other than localhost, malformed app id, a second `PrivyProvider`), the app keeps running and picking "Email (Privy)" fails with the cause.

---

## 3. Read the Privy user (optional)

The SDK mounts `PrivyProvider` around the app, so Privy's own hooks work in child components. Render them only while the EVM wallet is the Privy one:

```tsx
// @ai-snippets-skip — imports the optional peer @privy-io/react-auth, which this package does not install
import { usePrivy } from '@privy-io/react-auth';
import { useXConnection } from '@sodax/wallet-sdk-react';

export function PrivyEmail() {
  const connection = useXConnection({ xChainType: 'EVM' });
  return connection?.xConnectorId === 'privy' ? <Email /> : null;
}

function Email() {
  const { user } = usePrivy();
  return <span>{user?.email?.address}</span>;
}
```

---

## Anti-patterns

- **Writing `privy: { appId }`.** The value must come from `privy()` — the import is what adds Privy's code to the bundle; a plain object is skipped with a warning.
- **Importing `privy` from `@sodax/wallet-sdk-react`.** It lives only on the `/privy` sub-path.
- **Calling `privy()` in a Server Component.** Its value belongs to the browser's copy of the SDK and React refuses to serialize it; build the config in a `'use client'` file.
- **Mounting a second `PrivyProvider`.** Privy allows one; for an app that already has one, see *App already on Privy?* above.
- **Adding `@privy-io/wagmi`.** Not used — it replaces wagmi's connector list and would remove MetaMask and WalletConnect.
- **Custom modal stacking.** While Privy's login dialog is open, `useWalletModal` is `connecting`; render nothing when `state.connector.id === 'privy'`, as for `'walletConnect'`.
- **Letting a modal dialog close on Privy's screens.** Privy renders login, confirmation and MFA screens in `#privy-dialog`, outside the app's components; an open modal dialog (confirm-swap, wallet sheet) treats a click there as an outside click and closes mid-transaction. Ignore outside interactions whose target is inside `#privy-dialog` (Radix: `onInteractOutside` → `event.preventDefault()`).
- **Promising the same address across apps.** An address belongs to the Privy app: another `appId` gives the same email a different wallet. Sharing needs the same `appId` with both origins allowed; Privy's Global Wallets are not supported.

---

## Verification

```bash
# 1. Type check and the production build (a missing peer fails the build with "Module not found")
pnpm tsc --noEmit && pnpm build

# 2. privy() comes from the sub-path and sits on the EVM slot
grep -rn "@sodax/wallet-sdk-react/privy" <user-src>
grep -rn "privy: privy(" <user-src>

# 3. Nothing the SDK already provides — expect no matches
grep -rn "@privy-io/wagmi\|<PrivyProvider" <user-src>
```

4. **Hand to the user** (you cannot receive the email code): run the app on an allowed origin, pick "Email (Privy)" in the wallet list, sign in with a test account, and check that the address appears and is still connected after a reload. Then run one small SODAX action — a quote, then a swap of about $1 — which signs through `useWalletProvider` like MetaMask, with no Privy-specific call.
