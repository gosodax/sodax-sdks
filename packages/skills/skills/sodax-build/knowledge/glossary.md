# Glossary — DeFi jargon → plain English

For glossing terms during the interview. Apply **by tier** (see [`interview-guide.md`](./interview-guide.md)):

- **Tier A (non-coder):** gloss every term on first use, with the one-line plain version.
- **Tier B (semi-technical):** gloss once, then use the term.
- **Tier C (developer):** do not gloss.

**Rules:** never chain two glosses in one breath; after defining a term, re-ask the pending question. Keep the plain version first; the precise term is for the brief.

| Term | Plain English (say this first) | Precise note (for the brief) |
|---|---|---|
| **Hub-and-spoke** | "Everything routes through one central chain, so users can act from their own chain." | Sonic is the hub; other chains are spokes. |
| **Hub chain (Sonic)** | "The central chain SODAX uses behind the scenes." | The user rarely interacts with it directly. |
| **Spoke chain** | "Any chain a user actually starts from." | E.g. Ethereum, Base, Solana. |
| **Swap** | "Trade one coin for another." | Intent-based; filled by a solver, not a fixed pool. |
| **Bridge** | "Move the *same* coin to another chain." | Works for tokens sharing a hub vault. |
| **Intent** | "You say what you want; someone competes to do it for you." | On-chain order with a minimum-output floor. |
| **Solver** | "An off-chain service that finds you a price and fills your trade." | Sources its own liquidity; price is a live quote. |
| **Slippage / min output** | "The worst price you are willing to accept — you get at least that or it does not happen." | `minOutputAmount` floor on the intent. |
| **Money market** | "Lend your coins to earn, or borrow against what you hold." | Cross-chain supply/borrow. |
| **Staking** | "Lock the SODA token to earn." | SODA → xSoda vault share. |
| **Liquidity / LP** | "Put two coins into a shared pool so others can trade, and earn fees." | Concentrated-liquidity DEX. |
| **Allowance / approval** | "A one-time permission so the app can move a specific token for you." | ERC-20 approve step. |
| **Wallet** | "The app that holds your coins and signs actions (e.g. MetaMask)." | Per-chain provider in the SDK. |
| **Partner fee** | "The cut the app you built takes on each transaction." | See [`monetization.md`](./monetization.md). |
| **Gas** | "The small network fee paid to process a transaction." | Paid in the chain's native coin; not a SODAX fee. |
| **Token migration** | "Move an older ICON-era coin (ICX/BALN/bnUSD) into the new system." | Specific tokens only. |
| **Recovery** | "Getting back coins that got stuck." | Withdraw stuck hub-wallet assets to a spoke. |
| **Cross-chain** | "Doing something that spans two different blockchains at once — SODAX's specialty." | The hub routes the action between spokes; this is SODAX's main advantage. |
| **Stablecoin** | "A coin designed to hold a steady value, often about 1 US dollar (e.g. USDC)." | Peg stability is the issuer's promise, not SODAX's — never guarantee a peg. |
| **Testnet / mainnet** | "Mainnet is the real network with real money; testnet is a free practice copy." | Not every SODAX feature flow has a testnet — confirm per feature before assuming one exists. |
| **Smart contract** | "A program on the blockchain that runs exactly as written, with no middleman." | SODAX features are smart contracts the SDK calls for you. |

If a user asks about a term not listed here, give a one-line plain answer and, if it is an exact/enumerable fact (a specific token, chain, or number), fetch live source per the README policy rather than guessing.
