# apps/playground

An embeddable SODAX swap widget and its integration playground. The widget supports wallet-backed
execution where `src/lib/execution.ts` implements the family; the API's wider asset list remains
available for quotes with an explicit exchange handoff. The playground provides style controls,
network and token restrictions, token locks, an isolated iframe preview, and integration exports.

## Commands

```bash
pnpm build:packages
pnpm --filter @sodax/playground dev
pnpm --filter @sodax/playground test
pnpm --filter @sodax/playground checkTs
pnpm --filter @sodax/playground build
pnpm --filter @sodax/playground exec biome check .
pnpm check:ai-dev-files
```

## Ownership

- `hooks/useSwapFlow.ts`: API assets, quote state, allowed networks and form state.
- `hooks/useExecution.ts`: accounts, balances, review, approvals, signing and activity tracking.
- `lib/execution.ts`: testable execution sequencing and validated wallet-family dispatch.
- `lib/destinationGate.ts`: Stellar/NEAR receiving-account prerequisites reduced to one UI state.
- `lib/activity.ts`: validated local recovery record and reconstruction of relay submissions.
- `lib/progress.ts`: one wording per lifecycle step, worn by the confirm dialog's single action.
- `lib/review.ts`: the frozen snapshot the confirm dialog renders, built from the form or from a
  restored record.
- `lib/analytics.ts`: GA4 event vocabulary and the tag policy that keeps partner frames opt-in.
- `lib/widgetSettings.ts`, `lib/urlState.ts`: validated public embed configuration.
- `lib/brand.ts`, `hooks/useBrand.ts`: theme validation and derived semantic styles.
- `lib/presets.ts`: named starting brands, declared as query strings and parsed by `readBrand`.
- `views/SwapView.tsx`, `components/SetupPanel.tsx`: compact widget and Setup/Appearance/Integrate builder.
- `components/WidgetPreview.tsx`: actual iframe preview; Setup owns export defaults, trial trades stay in-frame.
- `lib/snippet.ts`: HTML and React iframe integration, plus an optional quote example.
- `hooks/useEmbedSize.ts`, `hooks/useEmbedMessages.ts`, `lib/embedMessages.ts`: height, lifecycle and theme
  messages; validate direct parent and origin. Lifecycle payloads contain status only.

## Execution invariants

- Browsing and quoting never require a wallet. A successful quote does not prove that the widget
  can execute that route. Keep `canExecute` and mounted wallet families consistent.
- Every executable destination needs its own connected account; never reuse an EVM address for a
  non-EVM destination. Show the complete receiving address and minimum amount in the review.
- Recheck the quote before approval and after approval. Preserve the reviewed minimum through
  intent creation. Bind every EVM broadcast to the selected chain and reject malformed raw payloads.
- Use `useSwapsApiApproveAndBroadcast`: it confirms approval resets before subsequent approvals.
- Save the broadcast transaction and relay payload before calling `submitTx`. Recovery resubmits
  that same transaction; it must never create or sign a second deposit. Failed/abandoned statuses
  need a recovery/support path, not a success label or silent retry of the trade.
- Whether the relay accepted the deposit is stored on the record, never inferred from the error that
  reported it: a reload keeps the broadcast and loses the error, and a swap the relay never took can
  only be moved by resubmitting it. Mark it after `submitTx` succeeds and nowhere else.
- What a failed swap tells the visitor is ours to write, never the backend's `userMessage`. Every
  intent the widget creates is timed — `executeSwap` takes its deadline from the API — so an unfilled
  one expires and refunds itself; `userMessage` says to cancel on-chain to recover, which is the
  limit-order case (`deadline = 0`) and sends a widget user hunting for a button they never need.
  `intentCancelled` and `relayedForRefundAt` say the refund has landed or is moving. Which step gave
  out (`failedAtStep`, `failureReason`) is support's detail and the widget does not show it.
- Treat local storage as untrusted and optional. Do not store credentials or private keys. The
  activity record contains public transaction details; do not send those through analytics.
- Integrator fees come from deployment configuration, not the URL or a visitor-editable input.
  The same fee must reach the quote and intent exactly once. Invalid configuration blocks execution.
- Adding a wallet family requires its signing path, destination preparation, balance behavior and
  recovery tests. Bitcoin trading wallets and destination account preparation are distinct flows.
- Dispatch signing on the wallet's chain type, never on the payload shape: EVM, Solana, Sui, Stellar
  and Bitcoin raw transactions are all `{ from, to, value, data }` and cannot be told apart.
- Check the payload's sender against the connected account wherever the family states one — `from`,
  or NEAR's `signerId`. Injective states a hex sender while its wallet reports bech32; comparing
  those rejects every valid swap, so it is exempt by design.
- A Stacks source carries `srcPublicKey` off the connected account (`sourceExtras`): a Stacks address
  cannot yield its signer public key, so the API cannot build the intent without the wallet's.
- A destination whose receiving account is not ready blocks execution before signing, including
  while the check is still in flight. Never let a swap leave the source chain to strand. The form
  offers the remedy only once a quote exists, surfaces the remedy's own failure, and `confirm`
  re-checks the gate against the reviewed minimum.

## Embed and UI

- `?embed=1` renders only the widget; URL rewrites preserve embed mode, branding and restrictions.
- The address bar is rewritten through `toBrowserSearch`, which omits every value equal to the seeded
  default, so a visitor who opens the widget and changes nothing keeps a bare URL. That is lossless
  only because the reader applies the same defaults for an absent key — move a default and both sides
  move together. A framed widget keeps the complete `toSearch` string: a lock resolves its pinned pair
  from `seed`, and a stripped URL would unpin it on the frame's own reload. `toSearch` stays complete
  for the share link and the exported snippet, which must state the pair a partner chose.
- Token allowlists use chain-and-symbol identities; empty explicit lists and unavailable locked defaults
  permit no route. Flip must respect both sides’ restrictions.
- Network and token options come from the swaps API; names/logos/explorers come from SDK exports.
  Do not hardcode network inventories or promise exclusivity for assets. The one client-side
  exception is `EXCLUDED_CHAINS` in `lib/assets.ts`: chains the API still lists but the product no
  longer routes. Add there, never filter in the UI.
- `VITE_EMBED_ORIGIN` selects the stable hosted deployment used by exported snippets. Vite variables
  are public. WalletConnect requires the deployment operator's project ID.
- The builder does not restore or report execution activity; its iframe owns the swap lifecycle.
- The hosted iframe owns its wallet session. Do not describe its React wrapper as a native component
  sharing the host wallet. Keep the standalone-opening fallback for wallets unavailable in frames.
  Unframed, embed mode is that tab: the widget keeps its embed width centred in the window rather than
  filling it, and the link that opens a new tab is not drawn in the tab it opens.
- Analytics in partner frames remains opt-in through `VITE_GTM_IN_EMBED`; no wallet addresses or hashes.
  Swap events reuse sodax.com's GA4 parameter names but must keep omitting `transaction_hash`, and
  `input_amount_usd` while nothing here prices the input. Failure reasons stay a closed set.
- Use native dialogs, keyboard-operable controls, readable errors and responsive layouts. Keep partner
  controls and technical setup in the builder, not inside the user's swap form.
- The note below the action carries the SODAX attribution and nothing else of ours — no custody
  reassurance, no follow-us line. The widget renders inside someone else's product, and that product
  reassures its own users; on a quote-only pair the note states the route's limit and its handoff instead.
- The form is the exchange's currency panel: the symbol and its chevron open the picker, the network
  and the connected balance share the line beneath it, and the flip disc centres on the seam between
  the two panels. Wallet chips name their side and sit above the form, never between the legs.
- The confirm dialog is the exchange's too: both legs either side of the wait, one action carrying
  every step from the wallet prompt to settlement, and the fee lines behind a disclosure. It is the
  only place a swap lives — there is no activity card, and nothing below the form restates a swap,
  lists its transactions or names the step that failed. It stays open through settlement, a restored
  record reopens it, and the form's primary action asks a dismissed one back. Only a settled swap
  leaves with its record on close; a failed one keeps its hashes for support and frees the form from
  its own explicit action, so an Escape is never what discards them. It is closable from the moment
  the deposit is broadcast, because
  tracking can stall for reasons neither end controls. What the card used to carry alone lives in the
  dialog now: stalled tracking and blocked storage take the message slot when there is no failure to
  report, and support is offered only on a failure whose funds are still unaccounted for. The
  exchange's follow-us line is the exchange's; a partner's users never see it. Once a deposit is
  broadcast the dialog carries its explorer link, and the destination's once a fill hash exists —
  that hash is on a chain whether or not this dialog can track it, and it is what support asks for.
- The dialog renders a snapshot taken when it opened, never the live form: the form re-quotes behind
  it and a reload reseeds it from the URL, and neither may restate a swap that is already signed. A
  restored snapshot resolves its decimals and symbols from the live asset list rather than from the
  stored record, and draws no legs at all when it cannot — an amount scaled by trusted-from-storage
  decimals is worse than the summary. What it resolves *by* is the record's own spoke-side token
  addresses, which is why they are stored: the saved `IntentResponseV2` is the hub's struct, and its
  `inputToken` / `outputToken` are Sonic assets that name nothing in a spoke chain's token list. The
  source amount is stored for the same reason and read from the same place — that struct's
  `inputAmount` is already net of the partner fee, so a dialog rebuilt from it restates the swap
  lower than the visitor confirmed it. The reviewed minimum has no such twin and stays the intent's.
- A swap the full snapshot cannot state still gets the dialog, from the record's own `summary`: the
  stored line, the status, the resubmission and the hashes, with the legs left out. That is what the
  summary is stored for, and it is why the dialog mounts beside the asset-loading and asset-error
  forms rather than after them — an outage arrives when a deposit is already on a chain.
- The destination leg states the reviewed minimum, not the live quote: it is the one number that is
  still true after the deposit is broadcast, and it satisfies the review's minimum-amount duty at the
  same time. The complete receiving address stays beside it, out of the disclosure.
- The message slot above the legs is always rendered, empty or not. A dialog carrying a swap must not
  jump when a step reports back, and its reserved height is per width — the same sentence needs a
  third line in a narrow frame.
- `index.css` is ordered, not specific. A `.btn` variant declared before `.btn` silently loses every
  property the two share — keep variants below it, and check the computed style, not the rule.
- The asset picker's dialog states a height, not a max-height: its grid and network sheet size against
  it, and a max- one leaves it indefinite, so each list grows past the dialog instead of scrolling in it.
  Centre a list that can overflow with `safe center`, or its first rows land where no scroll reaches.
  It opens inside the frame the host gives the widget, so an exported embed reserves `EMBED_MIN_HEIGHT`
  and its resize handler never drops below it; the widget's ground fills the surplus. The builder's
  preview answers to the Setup card instead: `useContentHeight` measures that card and keeps the last
  measurement once it unmounts, so the frame ends level with it on Appearance and Integrate too rather
  than resizing per tab. The studio column is the viewport, never the card, so sizing the frame to the
  column is what once left its border hanging below the widget. Both are carried as custom properties
  because which one applies is a layout question: `--widget-height` floors the stacked layouts,
  `--builder-height` sets the side-by-side one, capped at the column. Its header gap and caption
  margin are load-bearing — they are the height the frame reaches the card with.
- Stacked, the preview precedes the builder in the markup and the actions follow it: a partner
  opening the page narrow came to see the widget, not to scroll a Setup card to reach it. The
  side-by-side layout places all four children of `.app-main` explicitly rather than reordering
  them, so the builder keeps the left column without the markup owing it that order. Its two
  queries are exclusive at 1180/1181 — the stacked one is every other viewport, a short desktop
  window included.
- The picker names what the wallet holds, as the exchange does: an asset's total across its networks
  under the hovered tile, and the hovered network's own amount in place of the flyout's caption.
  Balances are read per chain while the dialog is open, never on a timer behind a closed one.
- `lib/pickerOptions.ts` owns the grid's order and nothing else decides it: what the wallet holds,
  that holding's USD total, then `lib/pickerRanking.ts`'s curated tiers, then alphabetical. Review
  the tiers against the exchange's list rather than editing them here. `sortAssetGroups` takes prices
  as an optional argument and nothing in the widget supplies them — adding a price source is the one
  change that turns the value rule on, and it puts a third-party host in a partner's page. Its
  `MARK_ORDER` is the same kind of curated list for chains: the decided non-EVM priority the all-networks
  mark leads with, a display order and never an inventory — what a chain reaches still comes from the API.
- `components/Dropdown.tsx` is the design system's navigation menu as a form control; use it rather
  than `<select>`, whose popup the OS draws in its own colours. Its panel is a top-layer popover
  because the builder's cards and scrolling column would clip an anchored one, so its position is a
  snapshot: anything that moves the trigger closes it. Keys resolve through `lib/dropdown.ts`.
- Preview appearance changes must not restyle the builder or reload an active swap. Setup edits are
  blocked while its preview has a wallet dialog, review, preparation or activity.
- Preserve the SODAX B2B palette and semantic CSS roles. Brand overrides validate values and derive
  contrast. Theme resolves pre-paint in `index.html` and must agree with `useBrand`; that script does
  no colour maths, which is why `writeBrand` spells out the theme a surface implies; a hand-written
  URL carrying only `surface` paints the stored theme until `useBrand` mounts. That script reads
  `?theme=` only in embed mode: the builder rewrites its own URL with the brand it is previewing, and
  `useBrand` leaves the builder's document alone, so reading it there lets a preview restyle the page. A preset seeds
  that same state; it must not name a real third-party brand or load a font outside `FONT_STACKS`.
- A brand states one surface and both themes derive from it: the theme that surface already is renders
  it exactly, the other gets a ground derived from it, so `?theme=` and `sodax:theme` reach a branded
  embed. With no `theme` the surface decides — never invert a ground a partner chose. Corrections are
  reported per theme; pooling them reports one the theme on screen did not make.
- No UI framework or icon-library dependency. Import SDK/types through `@sodax/dapp-kit`.
- `polyfill.ts` must remain the first entry import; the SDK graph needs `Buffer` during evaluation.
- Swap is the only flow. Do not turn the swap widget into a multi-product dashboard; another product
  is another widget.

Run mocked execution tests, the production build, and browser checks for both the playground and
embed. Mainnet signing must be validated by a funded wallet owner before calling a release production
ready. Record untested families or wallet environments explicitly.
