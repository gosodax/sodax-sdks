import type { ChainKey, PartnerFeePercentage, XToken } from '@sodax/dapp-kit';
import { DENSITIES, FONT_STACKS, RADIUS_SCALES } from './brand';
import { chainKeyExpression } from './chains';
import { EMBED_MIN_HEIGHT } from './embedMessages';

export type SnippetState = {
  srcChain: ChainKey;
  dstChain: ChainKey;
  srcToken: XToken | undefined;
  dstToken: XToken | undefined;
  amount: string;
  slippagePercent: string;
  partnerFee: PartnerFeePercentage | undefined;
};

export type Snippet = { id: string; label: string; code: string; note?: string };

function feeExpression(fee: PartnerFeePercentage): string {
  return `{ address: '${fee.address}', percentage: ${fee.percentage} }`;
}

/** The takeaway: the widget on the visitor's own page, opened on the pair they just configured. */
function embedSnippet(embedUrl: string): string {
  return `<!-- Live mainnet swaps. Visitors connect and approve transactions in their wallet.
     Brave shows wallets to a third-party frame only when the host allows them: keep the allow attribute. -->
<iframe
  src="${embedUrl}"
  title="SODAX swap"
  width="480"
  height="${EMBED_MIN_HEIGHT}"
  loading="lazy"
  referrerpolicy="origin"
  allow="ethereum; solana; clipboard-write"
  style="border: 0; border-radius: 24px; max-width: 100%"
></iframe>
<script>
  (() => {
    const frame = document.currentScript.previousElementSibling;
    const origin = new URL(frame.src).origin;
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'sodax:swap' && ['started', 'submitted', 'completed', 'failed'].includes(data.status)) {
        frame.dispatchEvent(new CustomEvent('sodax:swap', { detail: { status: data.status } }));
      }
      if (data.type === 'sodax:resize' && 'height' in data && typeof data.height === 'number' && Number.isFinite(data.height)) {
        frame.height = String(Math.max(${EMBED_MIN_HEIGHT}, Math.min(1600, data.height)));
      }
    });
  })();
</script>`;
}

function widgetSnippet(embedUrl: string): string {
  return `// The same embed as a component, for a React host. No SODAX package to install: the widget is
// a page, so it carries its own React, its own SDK version and its own token list.
import { useEffect, useRef } from 'react';

type SwapStatus = 'started' | 'submitted' | 'completed' | 'failed';
type SodaxSwapWidgetProps = { src?: string; height?: number; onSwapStatus?: (status: SwapStatus) => void };

export function SodaxSwapWidget({ src = '${embedUrl}', height = ${EMBED_MIN_HEIGHT}, onSwapStatus }: SodaxSwapWidgetProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const element = frame.current;
      if (!element || event.source !== element.contentWindow || event.origin !== new URL(src).origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || !('type' in data)) return;
      const status = 'status' in data ? data.status : undefined;
      if (data.type === 'sodax:swap' && (status === 'started' || status === 'submitted' || status === 'completed' || status === 'failed')) {
        onSwapStatus?.(status);
      }
      if (data.type === 'sodax:resize' && 'height' in data && typeof data.height === 'number' && Number.isFinite(data.height)) {
        element.style.height = String(Math.max(${EMBED_MIN_HEIGHT}, Math.min(1600, data.height))) + 'px';
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [src, onSwapStatus]);
  return (
    <iframe
      ref={frame}
      src={src}
      title="SODAX swap"
      loading="lazy"
      referrerPolicy="origin"
      allow="ethereum; solana; clipboard-write"
      style={{ width: '100%', maxWidth: 480, height, border: 0, borderRadius: 24 }}
    />
  );
}

// The defaults configured in Setup are query parameters, so the host page decides what it opens on:
// ?srcChain= &srcToken= &dstChain= &dstToken= &amount= &slippage= &embed=1
// The partner fee is deliberately not one of them — it is the one field that redirects money.
${themeParamsComment()}`;
}

/**
 * The theme API, listed off the constants that define it so the snippet cannot drift from what the
 * widget actually accepts.
 */
function themeParamsComment(): string {
  const options = (choices: object) => Object.keys(choices).join('|');

  return `// Styling is query parameters too — the src above already carries whatever you set here:
// ?theme=light|dark|auto
// &accent=  &cta=  &surface=  &text=      6-digit hex, no "#" (e.g. accent=7c3aed)
// &radius=${options(RADIUS_SCALES)}
// &font=${options(FONT_STACKS)}
// &density=${options(DENSITIES)}
// Set accent and surface and the rest is derived: the button label, every border and the text ramp
// are computed from them, so a brand colour cannot produce a control nobody can read.`;
}

function quoteSnippet(state: SnippetState): string {
  const { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee } = state;
  const bps = Math.round((100 - Number(slippagePercent || '0')) * 100);

  const fee = partnerFee
    ? `
      // Applied once by the API before it quotes, so quotedAmount is already net of it. Never
      // subtract it yourself — that charges it twice. percentage is basis points: 100 = 1%.
      partnerFee: ${feeExpression(partnerFee)},`
    : `
      // Earning on the trade? Add partnerFee: { address, percentage } — SODAX takes no share of it.`;

  return `import { useSwapsApiQuote, ChainKeys } from '@sodax/dapp-kit';
import { parseUnits } from 'viem';

// ${srcToken?.symbol ?? 'TOKEN'} on ${chainKeyExpression(srcChain)} → ${dstToken?.symbol ?? 'TOKEN'} on ${chainKeyExpression(dstChain)}
// Quotes are available before a wallet is connected.
const { data: quote, isFetching } = useSwapsApiQuote({
  params: {
    body: {
      tokenSrc: '${srcToken?.address ?? '0x…'}',
      tokenSrcChainKey: ${chainKeyExpression(srcChain)},
      tokenDst: '${dstToken?.address ?? '0x…'}',
      tokenDstChainKey: ${chainKeyExpression(dstChain)},
      amount: parseUnits('${amount || '0'}', ${srcToken?.decimals ?? 18}).toString(),
      quoteType: 'exact_input',${fee}
    },
  },
  // A "no path" answer is a business result, not a transient failure — retrying only delays it.
  queryOptions: { retry: false, refetchInterval: 10000 },
});

// ${slippagePercent || '0'}% slippage, as integer basis points — never float math on token amounts.
const minOutputAmount = quote && (BigInt(quote.quotedAmount) * ${bps}n) / 10_000n;`;
}

/**
 * The same embed as instructions for a coding agent. It states the constraints an agent cannot infer
 * from the markup — the query string is the configuration, the allow attribute is load-bearing, and
 * the widget spends real funds — because those are what an agent otherwise "tidies" away.
 */
function agentPrompt(state: SnippetState, embedUrl: string): string {
  const { srcChain, dstChain, srcToken, dstToken } = state;

  return `Add the SODAX swap widget to this app.

It is a hosted page embedded in an iframe. Do not install any @sodax/* package, do not build a
wallet connection for it, and do not rewrite or drop the query string in the URL below — it carries
the configured pair, amount, slippage and theme. The widget connects its own wallet.

1. Put this where the swap should appear, matching the framework this app already uses (in React or
   Next, a client component wrapping the same iframe):

<iframe
  src="${embedUrl}"
  title="SODAX swap"
  width="480"
  height="${EMBED_MIN_HEIGHT}"
  loading="lazy"
  referrerpolicy="origin"
  allow="ethereum; solana; clipboard-write"
  style="border: 0; border-radius: 24px; max-width: 100%"
></iframe>

2. Keep the allow attribute exactly as written. Brave exposes window.ethereum and window.solana to a
   third-party frame only when the host page grants those features; without it the connect buttons
   find no wallet.

3. Optional, and worth doing: listen for the widget's messages on window, and ignore any whose
   event.source is not that iframe's contentWindow or whose event.origin is not the URL's origin.
   - { type: 'sodax:resize', height } — set the iframe height, clamped to ${EMBED_MIN_HEIGHT}-1600.
   - { type: 'sodax:swap', status } — 'started', 'submitted', 'completed' or 'failed'. Status only:
     no addresses and no transaction hashes, so do not expect them.
   - Post { type: 'sodax:theme', theme: 'light' | 'dark' | 'auto' } to it to follow this app's theme.

4. Verify by loading the page: the widget should render on ${srcToken?.symbol ?? 'the source token'} (${chainKeyExpression(srcChain)}) to ${dstToken?.symbol ?? 'the destination token'} (${chainKeyExpression(dstChain)}), and resize to its content.
   It swaps real funds on mainnet — check that it loads and quotes, and leave executing a swap to a
   human with a funded wallet.`;
}

/**
 * The hosted embed owns execution; the quote tab is an optional lower-level integration example.
 *
 * Labels are one word so four tabs hold one row in the builder's column; the note carries what the
 * label used to, and every tab has one so the panel does not resize as the reader moves between them.
 */
export function buildSnippets(state: SnippetState, embedUrl: string): Snippet[] {
  return [
    {
      id: 'embed',
      label: 'HTML',
      code: embedSnippet(embedUrl),
      note: 'One iframe and a listener, for any page that serves HTML.',
    },
    {
      id: 'widget',
      label: 'React',
      code: widgetSnippet(embedUrl),
      note: 'The same embed as a component, for a React host.',
    },
    {
      id: 'agent',
      label: 'Agent',
      code: agentPrompt(state, embedUrl),
      note: 'Paste this prompt into your coding agent to get the widget installed.',
    },
    {
      id: 'quote',
      label: 'SDK',
      code: quoteSnippet(state),
      note: 'The lower-level route: install @sodax/dapp-kit and quote the swap yourself.',
    },
  ];
}
