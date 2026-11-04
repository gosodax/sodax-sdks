# Handoff — product shape → developer skill(s)

The last step. Map the brief's build shape to the exact developer skill(s) the user loads next, plus ordered scaffolding steps. This is a **strict refinement of the package `AGENTS.md` router** — if they ever disagree, `AGENTS.md` wins.

**Hard rule:** name the developer skills in **prose only** (backticks). Never write a clickable link or a path into another skill — that is a forbidden cross-skill reference. This skill links only within its own `knowledge/`.

## Decision table

| Product shape | Hand off to (in order, integration mode) | Start from (starter app, prose) |
|---|---|---|
| Web app: wallet + feature UI | `sodax-wallet-sdk-react` → `sodax-dapp-kit` (the matching feature) | the demo app (`apps/demo`): its provider setup + the matching feature page |
| React app calling the SDK directly | `sodax-wallet-sdk-react` → `sodax-sdk` (the matching feature) | the demo app (`apps/demo`) |
| Wallet UX is the hard part (Tier-A audience) | `sodax-wallet-sdk-react` (wallet-modal concern) → `sodax-dapp-kit` (feature) | the wallet-modal example app, then graft the feature from the demo app |
| Backend / bot / script | `sodax-sdk` (feature) → `sodax-wallet-sdk-core` (the chain, if it signs) | the node example app (`apps/node`, or `apps/node-cjs` for CommonJS) |
| Non-React browser | `sodax-wallet-sdk-core` (the chain) → `sodax-sdk` (feature) | the wallet-modal example app minus the React parts |
| Porting an existing v1 app | each dev skill above in **migration** mode first | the user's own repo |

**Partner fee** always adds the `sodax-sdk` partner feature; in a React app, also `sodax-dapp-kit`.

**Non-EVM chains:** if the product touches **any non-EVM chain**, add the matching chain in `sodax-wallet-sdk-core` to the handoff — each non-EVM chain needs its own wallet provider.

## How to choose mode

- **Integration** (write new v2 code) — the default for a brand-new product.
- **Migration** (port v1 → v2) — only if the user already has existing v1 SODAX code. Do migration first, then integration for new code.

## Ordered scaffolding steps (handed to the dev skill, not executed here)

Write these into the brief's section 9 so the dev skill can follow them:

1. Scaffold the project (framework is the builder's choice — the SDK has no opinion).
2. Install the SDK package(s) named in the handoff.
3. Set up the wallet/provider stack (mirror the demo app's provider setup for React; a private-key provider for backend).
4. Wire wallet connect (React) or instantiate the chain provider (backend).
5. Build the **Phase-1 tracer-bullet feature only**.
6. Attach the partner fee (if monetizing).
7. Configure chains/RPC — **start in the safest supported environment** (testnet if the feature flow has one; many SODAX feature configs are mainnet-oriented, so confirm what's available from the dev skill / live source — do not assume testnet exists).
8. Verify: a clean type-check and **one real end-to-end transaction**.

## What to tell the user

End the handoff with a plain sentence the user can act on, e.g.: *"Load the `sodax-wallet-sdk-react` skill in integration mode, then the `sodax-dapp-kit` skill for the swap feature. Start from the demo app's provider setup. Your Phase-1 goal is one working cross-chain transfer in the safest supported environment (testnet if the feature flow supports it)."* — then **stop**. Do not write the code.

## Structured handoff block (append to brief section 9)

After the prose handoff, append a machine-readable block so an orchestrator — or the next dev skill — can parse the routing deterministically. Use **YAML**, never ts/tsx. Fill only what the brief decided; omit unknowns rather than guessing:

```yaml
handoff:
  skills:               # in load order; integration mode unless noted
    - sodax-wallet-sdk-react
    - sodax-dapp-kit
  mode: integration      # or "migration" (port v1 first), then integration
  partner_fee: true      # if true, also load the sodax-sdk partner feature (+ sodax-dapp-kit in React)
  non_evm_chains: []     # each entry adds a sodax-wallet-sdk-core/<chain> provider
  starter_app: apps/demo
  phase1_goal: "one working cross-chain transfer in the safest supported environment"
```

Skills are named as plain strings, not links. This block is a convenience contract, **not** a second source of truth — the prose handoff and the package `AGENTS.md` still govern if they ever disagree.
