# SODAX Swap Widget

A hosted cross-network swap widget with a visual integration playground. Visitors can get live
quotes before connecting a wallet. For executable routes they connect, review the receiving address
and minimum output, approve when needed, and sign inside the widget.

The partner-facing page is [Swap widget](https://docs.sodax.com/widget); this README is the
repo-side reference behind it.

## Run

```bash
pnpm install
pnpm build:packages
pnpm --filter @sodax/playground dev
```

The dev server uses port 3005. Copy `example.env` to `.env` for deployment settings.

## Execution coverage

The widget implements EVM, Solana, Sui, Stellar, NEAR, Stacks and Injective source and destination
wallet connections — the list is `EXECUTABLE_CHAIN_TYPES` in `src/lib/execution.ts`. Both sides of a
route must be executable to use the in-widget signing flow. The destination is the connected account
for its chain family; same-family swaps use that family's connected account.

**Bitcoin** is deliberately excluded: it settles through a funded Bound trading wallet rather than a
signed swaps-API payload, so it is a separate flow rather than another connector.

The swaps API supplies the wider network/token list. Other routes remain available for quotes, with
an explicit **Continue on SODAX** handoff. That handoff opens the exchange; it does not prefill the
trade. Do not advertise the quote network count as executable coverage.

`EXCLUDED_CHAINS` in `src/lib/assets.ts` drops a chain from the widget entirely — not offered, not
quoted, not resolvable from a link — for networks the product no longer routes even while the API
still lists them. Removing a chain from the widget means adding it there, not filtering in the UI.

### Destination prerequisites

Stellar and NEAR can accept a swap the recipient cannot receive, which would strand the funds after
they leave the source chain. `src/lib/destinationGate.ts` reduces the dapp-kit gates to one state the
form renders, and execution stays blocked while a gate is unmet **or still resolving**:

| Destination | Prerequisite | In-widget remedy |
| --- | --- | --- |
| Stellar | Account activated | **Activate account** |
| Stellar | Trustline for the asset | **Add trustline** |
| Stellar | Spendable XLM to add that trustline | None — the recipient must fund it |
| NEAR | NEP-141 storage registered for the token | **Register storage** |

Activation is checked before the trustline: an unactivated account also reports a missing trustline,
and offering the trustline first would fail. The remedy is offered once a quote exists; a remedy the
wallet declines or that fails reports why beneath the button, and the gate is checked again when the
swap is confirmed.

The hosted iframe has its own wallet session. Its React export wraps that iframe; it does not accept
the host application's wallet provider. Wallet detection in iframes varies by browser/extension.
Use **Open in a new tab** if a wallet is unavailable in the embedded context. The link opens the
widget alone at the top level, without recreating the builder iframe.

## Playground

The builder has three panels: **Setup**, **Appearance**, and **Integrate**.

- Setup chooses the starting pair, amount, slippage, allowed networks and token lists per side.
  Lock either default token and network for a fixed source or destination. An unavailable locked
  token blocks the route rather than silently substituting another asset.
- The live preview is a real iframe at 480px or 375px (limited by available screen width). Dialogs,
  media queries, and wallet connections belong to that frame. Trying a different trade in the
  preview does not change the exported defaults in Setup. The builder caption explains that preview
  swaps use real funds; the swap review repeats the warning before confirmation.
- Appearance updates the preview without reloading it or restyling the builder. The color controls
  show resolved theme colors and accept hex entry; font, radius, density and secondary colors sit
  under Advanced appearance. Derived text and CTA labels are checked for contrast.
- Integrate provides HTML, a React iframe wrapper, an Agent prompt, and a separate SDK quote example.
  The React wrapper owns no wallet provider and supports an optional `onSwapStatus` callback. The
  Agent tab is the configured embed written as a prompt for a coding agent, stating what the markup
  cannot: the query string is the configuration, `allow` is load-bearing, there is no `@sodax/*`
  package to install, and the widget moves real funds. Its info tooltip uses the frontend bubble
  style above the icon, with viewport positioning outside the scrolling panel.
- Share copies a configuration URL. Reset all restores the default trade, restrictions, and theme.
  A copy confirms itself on the button that was pressed, so nothing resizes and the configuration
  tabs stay put; the line below the buttons carries only the paths that need an instruction.
  Setup and Appearance pause while a wallet dialog, review, preparation or activity is active in
  the preview, so an edit cannot replace an in-progress swap.
- The compact swap form shows minimum received, estimated time, and applicable partner fees before
  the main action. Network fees are confirmed in the wallet; no USD or gas estimates are invented.
- Asset search matches names, symbols and addresses, with a network filter and visible network names.

Partner fees remain deployment configuration, never visitor-editable URL fields. The Integrate
panel explains the dedicated-deployment setup path. An existing host-wallet connection, partner-ID
registry, custom recipients, exact-output quotes, and a full transaction-history list are not provided.

## Deployment configuration

| Variable | Purpose |
| --- | --- |
| `VITE_EMBED_ORIGIN` | Stable origin for the hosted widget. Set this before distributing copied embeds. |
| `VITE_SWAPS_API_KEY` | Optional API key, sent through the SDK. It is public once bundled and every portal key carries the same scopes, so use a key dedicated to this app — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices). |
| `VITE_WALLETCONNECT_PROJECT_ID` | Enables the EVM WalletConnect connector; configure allowed origins in its dashboard. |
| `VITE_SOLANA_RPC_URL` | Overrides the built-in Solana mainnet endpoint used for both SDK balance reads and wallet signing/broadcast. Optional. Configure allowed origins and public-key restrictions with your RPC provider. |
| `VITE_PARTNER_FEE_RECIPIENT` | Partner's Sonic fee address. Configure with the basis-point rate below. |
| `VITE_PARTNER_FEE_BPS` | Integer basis points, within `FEE_BPS_MAX` in `src/lib/fee.ts`. Invalid fee configuration blocks execution. |
| `VITE_GTM_ID` | Optional analytics container. Unset means no analytics container loads. |
| `VITE_GTM_IN_EMBED` | Set to `1` only when analytics should also load inside partner frames. |

All Vite variables are public browser configuration; never put a private RPC credential here.
Solana is the one network the app does not leave on its SDK default: that endpoint answers browser
traffic with HTTP 403, which surfaces as an empty balance and a refused swap rather than as an
outage, so `src/config.ts` falls back to a working public endpoint. Set `VITE_SOLANA_RPC_URL` to
put a keyed provider in its place, and rebuild — Vite inlines these at build time, so changing the
variable without a rebuild changes nothing. Other networks retain their SDK RPC defaults; validate
those against expected production traffic.

## Analytics

Events go to the GTM dataLayer under GA4 naming, using the same parameter names as sodax.com, so a
widget swap lands in the reports the frontend's dimensions are already registered against.

| Event | Fires when |
| --- | --- |
| `widget_viewed` | The widget loads and the container is allowed to run. |
| `quote_received` / `quote_failed` | A configured pair settles on a quote — once per pair, not per refetch. |
| `exchange_handoff_clicked` | A quote-only route hands off to the exchange. |
| `embed_snippet_copied`, `partner_fee_set` | Builder actions. Fee events carry basis points, never the recipient. |
| `swap_submitted` | The deposit is signed and broadcast. |
| `swap_completed` | Settlement reports `solved`. |
| `swap_failed` | The flow threw, or settlement ended `failed` / abandoned. |

Two of the frontend's `swap_completed` parameters are deliberately **absent** here: `transaction_hash`,
because a widget running in a partner's frame must not emit hashes, and `input_amount_usd`, because
nothing in this app prices the input — `input_amount` carries token units instead. Reports that join
widget and site swaps must account for that. `swap_failed` carries a closed `reason` set (the phase it
broke in, `rejected`, `settlement_failed` or `abandoned`), never a raw error string.

Swap dimensions are captured at signing and validated when restored from the activity record.
Settlement reporting is marked in that record to avoid reporting again on the next reload. Older
records without dimensions still recover their transaction but cannot report attributed analytics.
Storage blocking or simultaneous tabs prevent an exactly-once analytics guarantee.

## Not yet

- **CI.** `Build Apps` in `.github/workflows/ci.yml` does not build this app, so a broken
  production build is not caught before deploy.
- **Bundle.** The entry chunk is a single ~10.6 MB (~2.5 MB gzipped) file with no code splitting,
  and it includes wallet code for families this widget cannot execute.

## Embed parameters

`?embed=1` removes the builder and page header. Use **Copy embed** for the full integration, including
an automatic height listener that checks both the widget origin and `event.source`.

Both generated embeds set `allow="ethereum; solana; clipboard-write"` on the `<iframe>`. Brave injects wallet providers
into a third-party frame only when the host page grants those features
([provider availability](https://wallet-docs.brave.com/provider-availability/)); other browsers ignore
the names. Keep the attribute when moving the iframe into your own markup.

| Parameters | Values |
| --- | --- |
| `srcChain`, `dstChain` | SDK chain keys, resolved against the live token list |
| `srcToken`, `dstToken` | Token symbols resolved within the chosen chain |
| `amount`, `slippage` | Decimal amount and percentage tolerance |
| `allowedSrc`, `allowedDst` | Comma-separated SDK chain keys; absent/empty means all API-listed networks |
| `allowedSrcTokens`, `allowedDstTokens` | Comma-separated `chainKey:symbol` identities; absent means all tokens, present but empty permits none |
| `lockSrc`, `lockDst` | `1` locks that side to its configured default token and network; both must be explicitly supplied |
| `theme` | `light`, `dark`, `auto` |
| `accent`, `cta`, `surface`, `text` | Six-digit hex colors without `#` |
| `radius`, `font`, `density` | Supported values from `src/lib/brand.ts` |

Unknown chain names are discarded. Restrictions control this UI, not access to the public API.
A configured restriction with no currently listed assets cannot execute a swap. Fee settings are
never taken from URL parameters.

A `surface` with no `theme` decides the theme itself, and both themes derive from it. Every link
this builder writes spells out that implied `theme` as well, because the pre-paint script in
`index.html` reads the URL without doing colour maths. Keep both parameters when hand-writing an
embed URL: with only `surface`, the first paint uses the visitor's stored or system theme and flips
to the surface's own once the widget mounts.

### Host messages

Messages target the direct host origin (from `ancestorOrigins`, then the referrer), never `*`.
Generated embeds use `referrerpolicy="origin"` so browsers without `ancestorOrigins` can resolve the
host without receiving its full URL. Without a resolvable origin, no message is sent. Always verify
both `event.origin` and `event.source === frame.contentWindow` in a host listener.

| Outgoing message | Meaning |
| --- | --- |
| `{ type: 'sodax:resize', height }` | Content height; generated listeners clamp it to `EMBED_MIN_HEIGHT`–1600px |
| `{ type: 'sodax:ready' }` | Widget mounted; does not assert that assets or wallets are ready |
| `{ type: 'sodax:swap', status: 'started' }` | User confirmed a review and execution checks began |
| `{ type: 'sodax:swap', status: 'submitted' }` | Deposit broadcast and recovery data saved or attempted; settlement remains pending |
| `{ type: 'sodax:swap', status: 'completed' }` | Backend reports solved |
| `{ type: 'sodax:swap', status: 'failed' }` | Execution failed before broadcast, or settlement failed/was abandoned |

Lifecycle messages contain status only, no wallet addresses, amounts, hashes or raw errors. A relay
submission error after a broadcast stays pending for recovery, rather than emitting a terminal failure.
The HTML snippet dispatches a `sodax:swap` CustomEvent on the frame; the React wrapper calls
`onSwapStatus`. These are UI notifications, not proof of payment: confirm settlement server-side for
any business action. Delivery is best effort, not an exactly-once or replayable event stream.

A host can send `{ type: 'sodax:theme', theme: 'light' | 'dark' | 'auto' }` to the widget origin after
`sodax:ready`. Only messages from the direct parent with its exact resolved origin are accepted.
Theme changes never connect wallets or request signatures. The builder additionally uses same-origin
`sodax:preview-brand` and `sodax:preview-busy` messages for its isolated preview.

The deployment allows framing with `frame-ancestors *`.

## Transaction lifecycle and recovery

1. Show live quotes (debounced input, refreshed every ten seconds).
2. Connect source and destination wallets; display source balance and MAX for non-native tokens.
3. Review the recipient, minimum received and partner fee. Network fees are confirmed in the wallet.
4. Recheck the quote and allowance; confirm any allowance reset/approval through dapp-kit.
5. Recheck the price after approval, get a fresh deadline, build the intent and request a signature.
6. Persist the broadcast hash, intent, reviewed token addresses and amount, and relay payload before
   submitting to the backend.
7. Track settlement until solved, failed or abandoned, with explorer links and support access.

**Retry tracking** resubmits the saved transaction hash and payload; it never signs a new deposit.
It is offered from the record rather than from the error that raised it, so a reload between the
broadcast and a relay that has not accepted the deposit still reaches it.
The latest activity is restored after refresh when local storage is available. If storage is blocked,
the widget warns the user to retain the transaction hash. Failed/abandoned swaps show a support path;
an integrated on-chain refund workflow is not implemented in this widget.

The review is a real-mainnet confirmation, not a simulated trade. No automatic reconnect or automatic
transaction signing is requested by the widget. Native-token MAX is intentionally unavailable until
there is a reliable chain-specific gas reserve calculation.

## Verification and release

```bash
pnpm --filter @sodax/playground test
pnpm --filter @sodax/playground checkTs
pnpm exec biome check apps/playground
pnpm --filter @sodax/playground build
```

Tests exercise execution order, changing quotes, failed approvals, rejected signatures, interrupted
relay submission, activity restoration, URL restrictions and the existing asset/theme utilities.
Before a public production release, a wallet owner must verify funded mainnet swaps for every
advertised family, plus WalletConnect/mobile and third-party iframe behavior on the deployment's
actual origin. Mocked tests and quote-only browser checks cannot establish settlement reliability.
