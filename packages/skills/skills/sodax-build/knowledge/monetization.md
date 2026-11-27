# Monetization — partner fees

> **Source & freshness.** Fee values are exact and **must not be quoted from memory as absolute**. The fee *types* (defined in `@sodax/types`) and the *runtime validation* (in `@sodax/sdk`) currently disagree — fetch both from live source before stating any number or cap. Where to look: the README *Source & freshness policy*.

The monetization mechanism for products built on SODAX is the **partner fee**: the app/integrator takes a cut on transactions routed through it. There are two distinct fees in play — be clear about which is which.

## Two fees

- **Protocol (solver) fee — set by SODAX, varies by route.** A small protocol fee applies to swaps. Its rate depends on the route the solver takes, so it is not fixed and cannot be predicted per swap; it is already included in the quote. The end-user and the integrator do not control it. Confirm the current maximum from live source before quoting it.
- **Partner fee — set by the integrator (the person building the product).** This is *your* revenue. The app decides the rate; the end-user does not. It can be a percentage or a fixed amount, and it is deducted from the input token of the transaction.

Both fees come out of the **input** side of a transaction, not the output, and they are denominated in the input token.

## Partner fee — how to frame it (policy-sensitive)

The SDK source currently has conflicting documentation vs runtime validation. For product planning, treat fee percentage as a **policy-sensitive value**: prefer low, transparent fees; fetch live SDK/policy source before quoting an exact cap.

Concretely, when this comes up in the interview:

- Do **not** state an absolute maximum from memory. The type documentation and the runtime validation in the repo do not agree, so any single number quoted from memory risks being wrong.
- Frame it as a **product decision**: low, clearly-disclosed fees protect user trust and conversion. A high fee is technically expressible but is usually a bad product choice.
- For the brief, record the *intent* (e.g. "small percentage fee on swaps, disclosed to the user") and add a dev-time action: "confirm the current allowed fee range from live SDK source before shipping".
- **Make the mechanic concrete, but label it illustrative.** A non-technical user grasps the model faster with a worked figure — e.g. *"a 0.2% fee on $10,000 of swap volume ≈ $20"*. State plainly that this is an **illustration of the mechanic, not a revenue projection or promise**; the volume and the rate are the integrator's to decide.

## What to capture in the brief (Stage 4)

- **Percentage vs fixed** — most products use a small percentage.
- **Which actions carry the fee** — e.g. swaps only, or swaps + bridges.
- **Fee recipient address** — default to *defer*; it is a deployment detail, not a Phase-1 blocker.
- **Disclosure** — note that the fee should be shown to the user (product/UX requirement, kept separate from the design itself).

## Out of bounds

- **No yield/return promises.** Partner fees are revenue for the integrator, not a return for the end-user. Never present fees or any feature as guaranteed user earnings.
- **No investment advice.** This skill designs products. Risk and user-disclosure obligations are the integrator's responsibility — flag them, do not hand-wave them.

Taking a partner fee changes the handoff: it always adds the `sodax-sdk` partner feature, and in React also `sodax-dapp-kit`. See [`handoff.md`](./handoff.md).
