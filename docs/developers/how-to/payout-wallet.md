---
title: "Partner payout wallet"
sidebarTitle: "Payout wallet"
description: "Add the same PartnerFee address your SDK integration uses to track fees and volume and claim your fees in the partner portal."
icon: wallet
---

Your payout wallet, labelled **PartnerFee address** in the partner portal, is the fee receiver your app uses in its SDK integration: `partnerFee.address`. Add that same address in the portal to track your fees, track your volume, and claim your fees.

The integration sets where fees go. The portal reads the address you register; saving an address there does not change the fee receiver or fee percentage in your app.

If someone else built your integration, ask them for its `partnerFee.address` before saving it. There is a [developer section](#for-your-developer) below.

## What the payout wallet is

It is an EVM wallet address — the `0x…` kind — that your team controls and uses as `partnerFee.address` in the integration. Registering it in the portal does not create a new wallet.

You give the portal that same address to:

- **Track your fees and volume.** View the activity associated with that fee receiver.
- **Claim your fees.** Connect the matching wallet to claim its accumulated fees.

<Warning>
  **This address only tells the portal where to look. It does not redirect money.**

  Your app sets the fee receiver through `partnerFee.address`. If the portal watches a different address, it will not show the fees credited to the receiver your app actually uses.

  Fee percentage is also set in the integration, including 0%. Registering an address in the portal does not enable or increase a fee.

  If you did not set up the integration yourself, ask whoever did to confirm the two match. The [Monetize guide](/developers/how-to/monetize_sdk) is the page to send them.
</Warning>

## Adding it in the portal

**During sign-up.** If you are already integrated, enter the same EVM address used as `partnerFee.address` in your SDK integration. Confirm that it is the PartnerFee address your app uses, then select **Save PartnerFee address**. If you are not integrated yet, use **Not integrated yet?** and add the address once your integration is configured.

**Adding it later.** Go to **Monitored Wallets** in the portal:

1. Open **Monitored Wallets** and pick your organisation.
2. Paste the exact address your integration uses as `partnerFee.address`. The label box is optional — it is just a name so you recognise the row later.
3. Click **Add**.

Two things to know before you click:

| | |
| --- | --- |
| **You need to be an admin** | Only an owner or admin of the organisation can add it. Other team members can see the panel but not change anything. (The one exception is the question at sign-up, which anyone can answer — otherwise a new member could get stuck with no way past it.) |
| **Keep it in sync with your integration** | Check that the address matches `partnerFee.address` before saving. If you need to update the registered address and the portal does not offer an edit option, use **Get in touch** at the top of the portal. |

Your organisation has one payout address.

### Changing your fee wallet

Your developer can change the fee receiver in the SDK integration for future intents. When that happens, update the address registered in the portal to match; contact the team if you need help doing this. Updating the portal alone does not change where your app sends fees.

Fees already credited to the previous address stay there. Keep access to that wallet to claim them.

## Where your fees build up

**Your fees all collect on Sonic**, one of the networks SODAX runs on. It does not matter which networks the actual swap went between — the fee always ends up on Sonic. Nowhere else holds it.

They pile up separately for each token. You will see a list of balances rather than one number, and the same token can show up more than once: USDC that came from a swap on Arbitrum and USDC that came from a swap on Base are two separate balances. The portal stacks them together under the token name so the list stays readable.

Money shows up here as soon as a swap through your app charges a fee. It sits there safely until you cash out — nothing expires, and nothing gets swept up automatically.

## Choosing where you get paid

Before you can cash anything out, tell the portal where to send it. That is the **Payout destination** box in the Fees panel, and it asks for three things:

| | |
| --- | --- |
| **1 · Asset** | **Always USDC.** You cannot pick a different one. Whatever token the fee came in as, it gets turned into USDC when you cash out. |
| **2 · Network** | Which network you want the USDC delivered on. See [the list below](#which-networks-you-can-be-paid-on). |
| **3 · Recipient address** | The address that actually receives the money. It has to be an address on the network you just picked — a Solana address if you picked Solana, a Stellar address if you picked Stellar. It does not have to be your payout wallet, and if you pick a non-Ethereum-style network it cannot be. |

Saving this **costs one small transaction on Sonic**, because your choice is recorded on the blockchain rather than in our database. Your payout wallet has to approve that transaction itself, which also means nobody else on your team can change where your money goes. They can see the setting, but not touch it.

Changing it affects your **next** payout. Anything already on its way is unaffected.

<Warning>
  **Payouts cannot be undone.** Double-check you actually control the receiving address, and that it belongs to the network you picked. Money sent to an address you do not control, or to an address from the wrong network, is gone for good.
</Warning>

### Which networks you can be paid on

| | |
| --- | --- |
| Ethereum-style networks | Sonic, Ethereum, Arbitrum, Base, Optimism, Polygon, BNB Chain, Avalanche, Hyper, LightLink, Redbelly |
| Other networks | Solana, SUI, Stellar, Injective |

**Sonic is the cheapest and fastest**, because your fees are already sitting there and nothing has to move between networks. Every other choice adds a hop.

NEAR and Stacks are not payout options at the moment, even though you can swap to them through SODAX. The list in the portal is always the current one — it updates itself as networks become available.

## Claiming your fees

Cashing out is something you do by hand, **one token at a time**. There is no "claim everything" button.

### Before your first claim

<Steps>
  <Step title="Connect your payout wallet">
    Connect the wallet at the address you registered — the exact same one. The claim buttons only appear for that wallet. With any other wallet connected, you can still look at your balances, but there is nothing to click. That is not just the portal being strict: the money is genuinely sitting at that address, so no other wallet has anything to cash out.
  </Step>
  <Step title="Choose where you get paid">
    Until you do, every balance shows **No preferences** and nothing can be claimed. See [above](#choosing-where-you-get-paid).
  </Step>
  <Step title="Get some S into that wallet">
    Every action on a blockchain costs a small transaction fee, paid in that network's own token. Your payouts happen on Sonic, and Sonic's token is **S**. So your payout wallet needs a little S in it — a few dollars' worth covers many claims. **SODAX does not cover this for you.** The Fees panel shows your S balance next to your fees and warns you when it runs out.
  </Step>
</Steps>

### Claiming a token

1. Find the token in your list of fees.
2. Click **Approve**, and confirm in your wallet. This is a one-off permission that lets SODAX move that particular token on your behalf when you claim. You only ever do it once per token — later claims of the same token skip this step.
3. Click **Claim**, and confirm what the portal shows you.
4. Approve the transaction in your wallet.

A claim always takes the **whole balance** of that token. You cannot cash out part of it.

From there it happens on its own: the token gets swapped to USDC at the best price available, and the USDC is sent to your receiving address on the network you chose. Cashing out to a different network than Sonic means it has to travel, so give it a few minutes rather than expecting it the second you sign.

### The minimum claim amount

Very small balances cannot be cashed out. They show as **Below minimum** and simply wait in your account until they grow — either as more fees come in, or as the token's price moves.

This is not us being awkward. A tiny claim can cost more in transaction fees than it is worth, and below roughly a dollar nobody will take the other side of the swap at all, so it would just fail.

{/* TODO before publishing: state the agreed figure. Undecided as of writing — see icon-project/partner-portal#24. */}

<Note>
  The check uses our price estimate for the token. If we have no price for something unusual, we cannot check it, so it may look claimable and still turn out to be too small to go through.
</Note>

## If something is not working

| What you are seeing | What is going on | What to do |
| --- | --- | --- |
| No claim buttons anywhere | The wallet you have connected is not your registered payout wallet. | Connect the right one. The panel tells you which address it is waiting for. |
| **No preferences** on everything | You have not chosen where to get paid yet. | Fill in the Payout destination box. |
| **Below minimum** | That balance is worth too little to cash out. | Wait for it to grow, or claim a bigger one. |
| It refuses before your wallet even opens | You are trying to claim USDC that came from the same network you have chosen to be paid on — so there is nothing to swap it into. We stop this rather than let it get stuck. | Choose a different payout network, or ask your developer to move that balance off Sonic directly. |
| The transaction fails | Your payout wallet has run out of S on Sonic. | Top it up with S and try again. |

Still stuck? [Talk to us](#get-help) — include your payout address and we can look at what happened.

## For your developer

The portal's **PartnerFee address** is the `address` field of the fee configuration used by your integration. For SDK swaps, this is normally `swaps.partnerFee.address`, or `fee.address` if you use the global fee configuration. A per-intent `partnerFee` override takes precedence, so register the receiver your app actually uses.

Reading balances, setting the payout destination, approving, claiming, and recovering a claim that got stuck are available through `sodax.partners.feeClaim` in `@sodax/sdk`.

<Card title="Monetize SDK" icon="coins" href="/developers/how-to/monetize_sdk#partner-fee-claiming">
  Setting a partner fee, then the full claim flow in TypeScript.
</Card>

## Get help

<CardGroup cols={2}>
  <Card title="Discord" icon="discord" href="https://www.sodax.com/discord">
    Questions about fees, cashing out, and payout networks.
  </Card>
  <Card title="Contact the team" icon="envelope" href="/contact">
    Updating your registered PartnerFee address, and anything to do with your account.
  </Card>
</CardGroup>
