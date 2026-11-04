---
name: sodax-wallet-sdk-react-privy
description: 'Granular skill for @sodax/wallet-sdk-react v2 email login with Privy only — the privy field on the EVM slot of SodaxWalletConfig, built with privy() from the @sodax/wallet-sdk-react/privy sub-path, which adds an "Email (Privy)" embedded wallet next to MetaMask and WalletConnect. Use when a React dapp wants email onboarding on EVM — e.g. "add email login", "log in with email", "Privy", "embedded wallet", "email wallet", "Privy app id". INTEGRATION only: email login is new in v2, so there is no v1 setup to port. Links into the parent sodax-wallet-sdk-react knowledge tree. EVM only; for the connect UI itself use the connect / wallet-modal skills.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Email login with Privy (`wallet-sdk-react` granular skill)

Granular skill for the `privy` field on the `EVM` slot of `SodaxWalletConfig`. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

You write the code; the user owns the Privy app and receives the email code. Ask:

1. **Do they have a Privy App ID?** If not, give them the dashboard checklist in step 0 of the recipe (Email login, Ethereum embedded wallets, allowed origins, test accounts).
2. **Do they accept the trade-offs?** Privy custodies access (no signing while it is down), addresses belong to their Privy app, a lost email is a lost wallet, and the app is billed per signature.
3. **`showWalletUIs` and `disconnectBehavior`?** Both change the UX; the recipe's step 0 explains each choice.
4. **Does the app already mount a `PrivyProvider`?** Then follow the recipe's *App already on Privy?* branch.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/recipes/setup.md`](../integration/knowledge/recipes/setup.md) — prerequisite: provider mounted with the `EVM` slot.
3. [`../integration/knowledge/recipes/privy-email-login.md`](../integration/knowledge/recipes/privy-email-login.md) — install the peer, add `privy: privy({ appId })`, verify. Whole-file starter: [`../integration/knowledge/examples/05-privy-email-login.tsx`](../integration/knowledge/examples/05-privy-email-login.tsx).
4. Lookups → [`../integration/knowledge/reference/api-surface.md`](../integration/knowledge/reference/api-surface.md) (`privy`, `PrivyOptions`, `PRIVY_CONNECTOR_ID`).

### Privy-specific anti-patterns

- **Writing `privy: { appId }` or importing `privy` from the main entry.** The value must come from `privy()` on the `@sodax/wallet-sdk-react/privy` sub-path.
- **Hiding the App ID behind a backend.** It is public; only SODAX API keys need a proxy.
- **Adding `@privy-io/wagmi` or a second `PrivyProvider`.** The SDK mounts Privy itself.
- Full list → the recipe's *Anti-patterns*.

## Migration workflow (port v1 → v2)

None: email login is new in v2. Finish the broad skill's migration first, then add Privy with the integration workflow above.

## Verification

1. `pnpm tsc --noEmit` and the production build pass.
2. `privy: privy({ appId })` sits on the `EVM` slot, imported from `@sodax/wallet-sdk-react/privy`.
3. The user confirms what you cannot test (the email code): "Email (Privy)" appears, a test-account login shows an address that survives a reload, and a small SODAX action signs.

## Related skills (same family)

- [`../wallet-modal/SKILL.md`](../wallet-modal/SKILL.md) — a custom modal renders nothing while Privy's own dialog is open.
- [`../connect/SKILL.md`](../connect/SKILL.md) — the connect button / connector discovery hooks.
- [`../walletconnect/SKILL.md`](../walletconnect/SKILL.md) — the other optional EVM wallet source.

For multi-feature work, load the broad [`sodax-wallet-sdk-react` skill](../SKILL.md).
