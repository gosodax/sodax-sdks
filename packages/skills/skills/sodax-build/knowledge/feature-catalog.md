# Feature catalog — what each SODAX capability lets an end-user DO

Plain-English descriptions for the interview. These are **qualitative and stable** (the architecture changes slowly) — safe to use directly. Anything exact (chain lists, token symbols, fee numbers) is **not** here on purpose; fetch live source per the README policy.

SODAX is **cross-chain DeFi on a hub-and-spoke model**: Sonic is the hub chain, and every other chain is a "spoke". A user acts from their own chain; SODAX routes the action through the hub. The user does not need to understand the hub — it is plumbing.

The feature surface (which services actually exist) lives in the `@sodax/sdk` source — fetch it (see the README *Source & freshness policy*) if you need to confirm a feature still ships.

## Swap — convert one token into another, across chains (or on one chain)

**Cross-chain is the point — lead with it.** The user gives token A on one chain and receives token B on **another** chain in a single intent. This cross-chain reach is SODAX's core strength and the main reason to choose it over a single-chain DEX, so frame swap products around it. Mechanically the SDK takes a source chain and a destination chain separately, so a **same-chain** swap (A → B on one chain) is also valid — but cross-chain is where SODAX adds the most, so lead swap products with it. Use it for "let people trade / convert / get a different coin", ideally where the coins live on different chains.

**How pricing works (important, and a common misconception):** SODAX swap is **intent-based**. The user expresses an intent ("swap this for at least that much"), and an **off-chain solver network** quotes a live price and fills it. The price is **not** read from an on-chain price oracle, and it is **not** a fixed on-chain AMM pool — it is a real-time solver quote. The user is protected by a **minimum-output floor** (slippage protection): they receive at least the minimum or the intent does not fill. Practical consequence for a brief: the exact amount received must come from a **live quote**, never a promised number.

> Do not confuse "swap" with SODAX's own DEX (below). Swap = intent/solver. DEX = an on-chain liquidity pool. They are separate features.

## Bridge — move the *same* token to another chain

Same asset, different chain (e.g. move USDC from Ethereum to another chain). Use it for "send / move money to another chain" where the coin stays the same. Bridging works for tokens that share a vault on the hub.

## Money market — lend to earn, or borrow against collateral

Cross-chain lending/borrowing. Two end-user actions: **supply** assets to earn, and **borrow** against supplied collateral. Use it for "savings / earn yield / put money to work" (supply) or "borrow against what I hold" (borrow). Yields are market-driven — never promise a rate.

## Staking — lock SODA to earn

The user stakes the **SODA** token and receives a vault share (xSoda). Unstaking has a waiting period; an "instant unstake" path exists but pays a penalty/slippage. Use it for "earn by locking the SODA token" specifically — not generic savings (that is money market).

## DEX — provide liquidity / market-make

Concentrated-liquidity AMM (similar to Uniswap V3) on the hub. The end-user provides liquidity to a pool and manages a position. Use it for "provide liquidity / be a market maker / run an LP position". This is on-chain pool liquidity — distinct from the solver-based swap.

## Token migration — bring legacy ICON-ecosystem tokens over

Migrates **specific legacy ICON-ecosystem tokens** (e.g. ICX, BALN, bnUSD) into the SODAX ecosystem, with some reverse paths. It only handles a fixed, named set — confirm the current set from live source rather than assuming. **Honesty-gate:** SODAX does not mint or launch brand-new tokens; "I want to create a token" is out of scope.

## Partner fee — how an integrator earns

Lets the app/integrator take a fee on transactions routed through it. This is the **monetization mechanism** for most products built on SODAX. Details and honest framing live in [`monetization.md`](./monetization.md).

## Recovery — withdraw stuck hub-wallet assets

If assets end up stranded in a user's hub wallet, recovery withdraws them back to a spoke chain. This is almost always a **secondary** feature (a safety net), not a product's core value.

## Leverage yield — leveraged ERC-4626 vaults (advanced)

Leveraged-yield vaults on the hub that loop supply → borrow → swap to build a leveraged position. **Advanced and risk-heavy** — only surface it when a semi-technical+ user explicitly wants leverage, and keep risk framing separate from product design. Net yield can be negative. Never present it to a Tier A user as "savings".

---

**Mapping back to the interview:** the goal → feature table lives in [`interview-guide.md`](./interview-guide.md); worked product combinations are in [`use-case-gallery.md`](./use-case-gallery.md).
