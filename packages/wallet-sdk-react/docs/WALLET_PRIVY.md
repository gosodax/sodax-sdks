# Email login with Privy

`@sodax/wallet-sdk-react` can add an **"Email (Privy)"** entry to the EVM wallet list. The user enters an
email, types the one-time code Privy sends, and gets an embedded EVM wallet that signs SODAX actions
like any other wallet — `useXAccount`, `useWalletProvider` and the wallet-modal hooks work unchanged.

It is opt-in and lives behind its own import, `@sodax/wallet-sdk-react/privy`. Partners who do not use
it load no Privy code. EVM only.

The integration points are [`src/privy/`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/privy)
and [`EvmProvider.tsx`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/providers/evm/EvmProvider.tsx).

## Table of contents

1. [Setup](#setup)
2. [Options](#options)
3. [Why `privy()` has to be imported](#why-privy-has-to-be-imported)
4. [Using the Privy user in your app](#using-the-privy-user-in-your-app)
5. [Apps that already use Privy](#apps-that-already-use-privy)
6. [Custom wallet modal](#custom-wallet-modal)
7. [Your own dialogs](#your-own-dialogs)
8. [Sessions, reloads and disconnect](#sessions-reloads-and-disconnect)
9. [Custody and recovery](#custody-and-recovery)
10. [When Privy cannot start](#when-privy-cannot-start)
11. [Availability](#availability)
12. [Chains and RPC](#chains-and-rpc)
13. [Leaving Privy](#leaving-privy)
14. [Cost](#cost)
15. [Next.js, bundlers and viem](#nextjs-bundlers-and-viem)

---

## Setup

1. Create an app at [dashboard.privy.io](https://dashboard.privy.io): enable **Email** login and
   **Ethereum embedded wallets**, and add your site's origins to the allowed list. Users and their
   wallets belong to this app. If your site sends a Content-Security-Policy, allow the origins in
   [Privy's CSP guide](https://docs.privy.io/security/implementation-guide/content-security-policy),
   at least `https://auth.privy.io` in `connect-src`, `frame-src` and `child-src`: it serves Privy's
   API and the embedded-wallet iframe.
2. Install Privy next to the SDK — it is an optional peer dependency, version **3.40 or newer**:

   ```bash
   pnpm add @sodax/wallet-sdk-react @privy-io/react-auth
   ```

3. Pass `privy()` as `EVM.privy`:

```tsx
'use client';

import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { privy } from '@sodax/wallet-sdk-react/privy';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    walletConnect: { projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '' }, // still works alongside
    privy: privy({ appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '' }),
  },
};
```

"Email (Privy)" (connector id `privy`) now appears in `useXConnectors({ xChainType: 'EVM' })` next to
MetaMask, Hana and WalletConnect. **No UI changes required.** Calling `privy()` inline is fine:
`SodaxWalletProvider` reads its config once, on first render.

---

## Options

| Option | Default | |
| --- | --- | --- |
| `appId` | — (required) | Your Privy app id. |
| `clientId` | — | Privy app client id, for per-environment settings. |
| `defaultChain` | `ChainKeys.SONIC_MAINNET` | Chain the embedded wallet starts on. Any EVM `ChainKey` of this SDK. |
| `showWalletUIs` | your dashboard setting | Show Privy's own signing confirmation screens. With them on, a transaction returns only after the user closes Privy's success screen — see below. |
| `disconnectBehavior` | `'logout'` | `'logout'` signs the user out on disconnect, so the next connect asks for a new code. `'detach'` keeps the Privy session: reconnecting needs no code until it expires — offer a sign-out of your own (`usePrivy().logout()`) if you choose it. |
| `appearance` | Privy defaults | Theme, logo, accent colour of Privy's login modal. Its wallet list is always empty: other wallets come from the SDK's own list. |
| `legal` | — | Terms and privacy links shown in the login modal. |

`privy()` never throws. An empty `appId` (an unset env var in a preview deploy), an unknown `defaultChain`
or a Privy older than 3.40 logs a warning and leaves "Email (Privy)" out — the same way a WalletConnect
config without `projectId` is skipped. The app id is trimmed, so a trailing newline from an env file is
harmless.

The SDK fixes the rest of Privy's configuration: email login only, embedded wallet created on first
login, Privy's own external-wallet connectors off (so it does not start a second WalletConnect or
Coinbase stack next to the SDK's), and **no** MFA or recovery overrides — your dashboard settings for
those apply.

**`showWalletUIs` also decides when a transaction returns.** With Privy's screens on, Privy asks the
user to approve, broadcasts, waits for the receipt, shows a success screen, and resolves the request only
when the user closes that screen ("All done"). So every SDK action that sends a transaction — a swap, a
bridge, an approval — gets its hash only after that click, and your status tracking starts late. With
`showWalletUIs: false` Privy signs without any screen and the hash comes back right after broadcast; your
app's own review step is then the only confirmation the user sees, for transactions and signatures alike.
As of Privy 3.40 there is no option that keeps the approval screen but skips the success screen.

---

## Why `privy()` has to be imported

Why not `EVM: { privy: { appId } }`? Bundlers decide what goes into your app only by following
`import`s; they never read config values. The line `import { privy } from '@sodax/wallet-sdk-react/privy'`
is what brings Privy's code in.

- If the SDK loaded Privy by itself, every partner's build would reference `@privy-io/react-auth` — and
  fail with "Module not found" for anyone who has not installed it.
- Making Privy a regular dependency instead would install ~50 extra packages (a second viem, another
  WalletConnect, Stripe, hCaptcha…) for every partner, whether they use email login or not.

`walletConnect: { projectId }` can be plain config only because WalletConnect already ships inside
wagmi.

---

## Using the Privy user in your app

The SDK exposes what every wallet has — address, connection, wallet provider. For Privy-specific data
(the user's email, key export, linking accounts) use Privy's own hooks. The SDK mounts `PrivyProvider`
around your app when `EVM.privy` is set, so they work in any component below `SodaxWalletProvider`:

```tsx
import { useExportWallet, usePrivy } from '@privy-io/react-auth';
import { useXConnection } from '@sodax/wallet-sdk-react';

// Render Privy hooks only while the EVM wallet is the Privy one.
function Account() {
  const connection = useXConnection({ xChainType: 'EVM' });
  return connection?.xConnectorId === 'privy' ? <PrivyAccount /> : null;
}

function PrivyAccount() {
  const { user } = usePrivy();
  const { exportWallet } = useExportWallet();
  return (
    <>
      <span>{user?.email?.address}</span>
      <button onClick={() => exportWallet()}>Export private key</button>
    </>
  );
}
```

- Do not mount a second `PrivyProvider` of your own — use the one the SDK mounts. If your app already has
  one, see [Apps that already use Privy](#apps-that-already-use-privy).
- If you enable `EVM.privy` conditionally (for example from an env var), gate components that call
  Privy hooks on the same condition: outside a `PrivyProvider`, hooks such as `useLogin({ onComplete })`
  throw.
- Calling Privy's `logout()` yourself disconnects the Privy wallet in the SDK too.

---

## Apps that already use Privy

Privy allows one `PrivyProvider` per app, and `EVM.privy` makes the SDK mount it.

**If your app uses Privy only for email login and the embedded wallet**, remove your `PrivyProvider` and
pass the same `appId` and `clientId` to `privy()`, with your modal styling and legal links in its
`appearance` and `legal` options. Your `@privy-io/react-auth` must be 3.40 or newer. The app id is
unchanged, so a user who signs in with the same email keeps the same address. In exchange:

- the SDK's configuration replaces the rest of yours: email login only, Privy's external wallets off, and
  only this SDK's EVM chains — users who signed up with Google, SMS or a wallet cannot sign in that way here;
- Privy hooks work only in components below `SodaxWalletProvider`;
- disconnect signs the user out of Privy, ending any session of your app that relies on it (`disconnectBehavior: 'detach'`
  keeps it).

**If your app needs its own Privy configuration** — other login methods, Privy's external wallets, other
chains, or a Privy session that must outlive a wallet disconnect — leave `EVM.privy` out: the SDK cannot
use a `PrivyProvider` you mount. If both end up mounted, Privy refuses the inner one with
`Multiple PrivyProvider instances found`. With yours above `SodaxWalletProvider`, the inner one is the
SDK's: the SDK catches the error, your app keeps its Privy, and picking "Email (Privy)" fails with that
message.

---

## Custom wallet modal

Privy opens its own login dialog, like WalletConnect opens its QR modal. While it is up — including the
screen where Privy creates a new user's wallet after the code — `useWalletModal` stays in `connecting`. To
avoid two stacked dialogs, render nothing for those connectors:

```typescript
if (modal.state.kind === 'connecting' && ['walletConnect', 'privy'].includes(modal.state.connector.id)) {
  return null; // Privy's / WalletConnect's own dialog owns the screen
}
```

`PRIVY_CONNECTOR_ID` from `@sodax/wallet-sdk-react/privy` is the same `'privy'` string. Closing
Privy's dialog moves the modal to `error` with a user-rejection error; a wrong code, a captcha retry or
a rate limit stays inside Privy's dialog. If Privy does not show its dialog within 5 seconds (its `login()`
only logs a warning while it still holds a signed-in user), the connect fails with
`Opening the Privy login did not complete within 5000 ms` rather than waiting.

---

## Your own dialogs

Privy renders its screens — login, transaction and signature confirmations, MFA prompts — in its own
element (`#privy-dialog`), outside your components. A modal dialog of yours that is open when one of them
appears (a confirm-swap dialog, a wallet sheet) sees a click inside Privy's screen as a click outside
itself, and most dialog libraries close on that — mid-login or mid-transaction. Ignore those clicks:

```tsx
// Radix / shadcn: the same guard works on a Sheet's content.
<DialogContent
  onInteractOutside={event => {
    if (event.target instanceof Element && event.target.closest('#privy-dialog')) event.preventDefault();
  }}
>
```

Or close your dialog before the action starts, if it does not need to show the result.

---

## Sessions, reloads and disconnect

- **Returning users** are reconnected on reload — and after the browser is closed and reopened — without
  a new code, as long as their Privy session is valid. The same email gets the same address **for the
  same `appId`**, unless the user is deleted from your Privy dashboard. Another app with its own `appId`
  gives that email a different address: to share one, both apps use the same `appId` (with both origins
  allowed in the dashboard). Privy's cross-app Global Wallets are not supported by this SDK.
- **Slow start**: on page load the SDK gives the whole Privy restore at most 3 seconds, so other wallets
  are never held back longer. If Privy takes longer, the user shows as disconnected; one click on
  "Email (Privy)" reconnects without a new code.
- **Disconnect signs the user out of Privy** by default, so the next connect asks for a code again — also
  when the user disconnects while the page-load restore is still running. It also ends any other EVM
  wallet connected in the same session, so nothing can be revived without its own sign-in — this keeps a
  shared device safe (a third-party wallet whose own disconnect stalls past 10 seconds is the exception:
  wagmi keeps it until that disconnect finishes). The disconnect returns at once and the sign-out request
  finishes in the background. Until Privy confirms it — offline, a closed tab, Privy still loading — the
  next "Email (Privy)" connect signs out first, and fails rather than reuse the old session if it cannot.
  With `disconnectBehavior: 'detach'`
  the Privy session stays: the next click on "Email (Privy)" reconnects without a code, and so would
  anyone else using that browser until the session expires or your app signs the user out.
- **Account changes are not followed.** If the Privy session switches to a different wallet, the SDK
  disconnects instead of signing as the new address.

---

## Custody and recovery

A Privy embedded wallet has no password and no seed phrase. On Privy's default TEE execution
environment the wallet is reachable only through the user's Privy login method — for this integration,
their email one-time code — and there is no recovery factor to set: calling `setWalletRecovery()` on a
TEE app throws `unsupported_wallet_type`, so this SDK never calls it. If a user permanently loses access
to that email address, the wallet and everything in it are unrecoverable: Privy states there is no
backdoor and cannot restore the account. Tell your users they can export their private key at any
time, and that linking a second login method (only the user can do it) is the one durable fallback.
Enable wallet MFA — passkey, TOTP or SMS — in your Privy dashboard so that a stolen browser session
cannot sign or export on the user's behalf; Privy renders the MFA prompt itself inside the provider this
SDK mounts.

Signing requests are never timed out by the SDK, so a user who takes time on the MFA prompt is not cut
off.

---

## When Privy cannot start

`PrivyProvider` refuses to start in a few situations, all of them at page load:

- the page is served over plain **http** from any host other than `localhost` / `127.0.0.1` — including a
  LAN address such as `http://192.168.1.20:3000` while testing on a phone;
- the app id is not a Privy app id (for example a client id pasted by mistake);
- another `PrivyProvider` is already mounted above `SodaxWalletProvider` (see
  [Apps that already use Privy](#apps-that-already-use-privy)).

The SDK catches this: your app keeps rendering without Privy, the console shows the cause, and picking
"Email (Privy)" fails with that same message. Privy hooks in your components then behave as outside a
provider (`usePrivy()` returns `ready: false`; callback forms such as `useLogin({ onComplete })` throw), so
render them only while the EVM connection is Privy, as the `Account` example above does. Errors thrown by your own
components, or after Privy has started, are not intercepted — they reach your own error boundaries as usual.

---

## Availability

Every signature is a round trip to Privy's servers, so **while Privy is unreachable, a Privy-connected
user cannot sign** — MetaMask or WalletConnect users on the same page are unaffected. A SODAX action is
often approve-then-intent (two signatures); an outage between them leaves the approval granted and the
intent unsigned. Check [status.privy.io](https://status.privy.io) for per-component uptime; Privy offers
an SLA only on its Enterprise plan.

---

## Chains and RPC

The embedded wallet can use every EVM chain this SDK supports. It estimates gas and broadcasts through
the RPC URL you set per chain in `EVM.chains` (or the chain default) — the same endpoint wagmi reads
from — rather than Privy's shared RPC.

Seven of those chains are outside Privy's built-in chain list: Sonic (146), LightLink (1890), Kaia
(8217), Redbelly (151), Hedera (295) and Robinhood (4663) are absent, and id 999 there is a Zora
testnet rather than HyperEVM. Consequences on those chains: Privy's transaction scanning does not
resolve, and if Privy's wallet UIs are on, their price line can be wrong (HyperEVM shows another
chain's fiat price).

Gas sponsorship is not available through this integration: Privy offers it only on its own
`useSendTransaction` hook, not on the standard wallet interface the SDK signs through.

---

## Leaving Privy

Addresses are bound to your Privy `appId`; there is no automatic transfer to another app or provider.
The way out is user-driven key export, which requires the user to still log in to the app that holds
the wallet. Removing `EVM.privy` without a migration window therefore strands those users' funds until
they export — announce it and keep export reachable first.

---

## Cost

Privy bills the `appId` owner, metered per signing request; one SODAX action can take several
signatures. See [privy.io/pricing](https://www.privy.io/pricing) for current tiers.

---

## Next.js, bundlers and viem

- **Next.js App Router**: build `SodaxWalletConfig` in a `'use client'` providers file. The value
  `privy()` returns is tied to the copy of the SDK running in the browser, so React refuses to pass it
  from a Server Component (an error, not a silently missing wallet). Keep `layout.tsx` server-side and Privy-free.
  Verified with Next 16 under both Turbopack and `--webpack`.
- **webpack** prints warnings, not errors, for Privy's optional Solana peer
  (`Can't resolve '@farcaster/mini-app-solana'`) and a "Critical dependency" in `ox`'s Tempo code. Both
  are harmless for EVM-only use.
- **npm / yarn**: Privy depends on viem 2.56 internally and needs your top-level `viem` to be **2.44 or
  newer**; with an older hoisted viem, importing Privy fails with `does not provide an export named
  'tempoModerato'`. pnpm's isolated layout is not affected.
- **Monorepos**: make sure your app and the SDK resolve the same copy of `@privy-io/react-auth` (with
  Vite, `resolve.dedupe: ['@privy-io/react-auth']`). Two copies means `usePrivy()` reads a different
  context than the provider the SDK mounted.
