---
title: Is SODAX on Testnet?
sidebarTitle: Testnet
description: >-
  SODAX is mainnet-only. Here's why there is no testnet, and how to test and
  explore SODAX safely on mainnet instead.
icon: flask
---

**Short answer: no.** The SODAX SDKs and protocol run on **mainnet only**. There is no SODAX testnet, and the SDK has no testnet mode or network toggle.

Every chain the SDK supports is a mainnet. The canonical chain list in `@sodax/types` (`ChainKeys`) contains only `*_MAINNET` entries — there are no testnet chain configs, no testnet RPC endpoints, and no `testnet` switch anywhere in the SDK.

<Note>
Any `testnet` / `TESTNET` value you may see in wallet configuration (for example a Bitcoin or Sui wallet provider's `network` field) is an **upstream parameter of that wallet library** — it does not enable a SODAX testnet.
</Note>

## Why is SODAX not available on testnets?

SODAX is a cross-chain **intents** system. Swaps, lending, borrowing, staking and bridging are settled through the Sonic hub against **real, deployed contracts** and **live, solver-provided liquidity**. Those primitives have no meaning without production liquidity and deployed spoke contracts, so there is no parallel testnet deployment to point the SDK at.

For how settlement works, see [Intents](/developers/technical-overview/intents) and the [Technical Overview](/developers/technical-overview).

## Can I integrate SODAX on testnet?

No — integrate against mainnet. To build and test safely:

* **Use small amounts on mainnet.** Every flow is real, so start with minimal values while you wire things up.
* **Drive flows headlessly** with the private-key wallet providers — see the mainnet smoke scripts in [`apps/node`](https://github.com/icon-project/sodax-sdks/tree/main/apps/node) to exercise integrations without a browser wallet.
* **Point your AI coding agent at the SODAX skills** for per-chain, v2-correct integration guidance — see [AI Integration](/ai-integration-guide).

## Keep exploring

* [Make a swap (SDK)](/developers/how-to/how_to_make_a_swap) — end-to-end swap walkthrough.
* [Configure the SDK](/developers/how-to/configure_sdk) — initialization and configuration.
* [SDKs overview](/developers/packages) — the full package stack (Foundation, Connection, Experience).
* [FAQ](/developers/faq) — common questions.
