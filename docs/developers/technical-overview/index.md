---
title: "Technical Overview"
sidebarTitle: "Overview"
description: "Architecture deep-dives for the SODAX hub — Asset Manager, Vault Token, Hub Wallet Abstraction, Intents, and GMP."
icon: book-open
---

How the Sonic hub coordinates spoke networks: asset movement, unified tokens, deterministic wallets, intent settlement, and cross-network messaging.

![SODAX hub-and-spoke architecture](/images/hub-and-spoke-architecture.png)

### Infra goals

* Any EVM dapp can reach any user on any connected network without changes
* Any EVM dapp can reach any token on any connected network without changes
* Any token can be bridged to any other connected network
* Cross-network messaging stays simple and reliable with little overhead

### App goals

* A money market that can delegate liquidity across products and services
* A hub that unifies liquidity and execution for connected networks

<CardGroup cols={2}>
  <Card title="Asset Manager" icon="boxes-stacked" href="/developers/technical-overview/asset-manager">
    Hub-and-spoke transfers with optional execution hooks.
  </Card>
  <Card title="Vault Token" icon="vault" href="/developers/technical-overview/vault-token">
    One token wrapping multi-network variants of the same asset.
  </Card>
  <Card title="Hub Wallet Abstraction" icon="wallet" href="/developers/technical-overview/hub-wallet-abstraction">
    Deterministic hub wallets for users on every spoke.
  </Card>
  <Card title="Intents" icon="bullseye" href="/developers/technical-overview/intents">
    Express outcomes on the hub; solvers fill from spokes.
  </Card>
  <Card title="Generalized Messaging Protocol" icon="tower-broadcast" href="/developers/technical-overview/generalized-messaging-protocol">
    Cross-network message send, verify, and deliver.
  </Card>
</CardGroup>

### Two terms used throughout

* **Connection** — verifies incoming messages and acts as a gateway for a network to send messages to any other connected network. See [Generalized Messaging Protocol](/developers/technical-overview/generalized-messaging-protocol).
* **Relayer** — verifies and delivers messages across networks, confirming events and providing the necessary signatures. See [Relayer API endpoints](/developers/deployments/relayer-api-endpoints).
