import { ChainKeys, getSupportedSolverTokens } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import { type SnippetState, buildSnippets } from './snippet';

const SRC_CHAIN = ChainKeys.BASE_MAINNET;
const DST_CHAIN = ChainKeys.SOLANA_MAINNET;
const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
const EMBED_URL = 'https://widget.sodax.com/?embed=1&srcChain=0x2105.base&dstChain=solana';

const base: SnippetState = {
  srcChain: SRC_CHAIN,
  dstChain: DST_CHAIN,
  srcToken: getSupportedSolverTokens(SRC_CHAIN)[0],
  dstToken: getSupportedSolverTokens(DST_CHAIN)[0],
  amount: '1.5',
  slippagePercent: '0.5',
  partnerFee: undefined,
};

const codeFor = (state: SnippetState, id: string): string =>
  buildSnippets(state, EMBED_URL).find(snippet => snippet.id === id)?.code ?? '';

describe('buildSnippets', () => {
  // The takeaway leads: every competitor's playground ends with something the visitor can ship.
  it('opens on the embed, then the code behind it', () => {
    expect(buildSnippets(base, EMBED_URL).map(snippet => snippet.id)).toEqual(['embed', 'widget', 'agent', 'quote']);
  });

  // The hosted embed owns signing; its integration snippet should not duplicate that flow.
  it('ships no call that signs or broadcasts', () => {
    const all = buildSnippets(base, EMBED_URL)
      .map(snippet => snippet.code)
      .join('\n');

    for (const call of ['useSwapsApiCreateIntent', 'useSwapsApiSubmitTx', 'approveAndBroadcast', 'walletProvider']) {
      expect(all).not.toContain(call);
    }
  });

  it('points both embeds at the pair the form currently shows', () => {
    expect(codeFor(base, 'embed')).toContain(EMBED_URL);
    expect(codeFor(base, 'widget')).toContain(EMBED_URL);
  });

  it('identifies the embed as a live mainnet flow requiring wallet approval', () => {
    expect(codeFor(base, 'embed')).toContain('Live mainnet swaps');
    expect(codeFor(base, 'embed')).toContain('approve transactions in their wallet');
  });

  // Brave injects window.ethereum and window.solana into a third-party frame only when the host
  // grants those features; without them the embed's connect buttons find no wallet in Brave.
  it('asks the host to expose wallets to the frame, in both embeds', () => {
    expect(codeFor(base, 'embed')).toContain('allow="ethereum; solana; clipboard-write"');
    expect(codeFor(base, 'widget')).toContain('allow="ethereum; solana; clipboard-write"');
  });

  it('validates frame identity and status before notifying the host', () => {
    const html = codeFor(base, 'embed');
    const react = codeFor(base, 'widget');
    expect(html).toContain('event.source !== frame.contentWindow || event.origin !== origin');
    expect(html).toContain("new CustomEvent('sodax:swap'");
    expect(react).toContain('event.source !== element.contentWindow || event.origin !== new URL(src).origin');
    expect(react).toContain('onSwapStatus?.(status)');
    expect(react).toContain('MessageEvent<unknown>');
    expect(html).toContain('referrerpolicy="origin"');
    expect(react).toContain('referrerPolicy="origin"');
  });

  // An agent edits the host app unattended, so the prompt has to state what the markup cannot show.
  describe('the agent prompt', () => {
    it('carries the configured embed and the constraints an agent would otherwise tidy away', () => {
      const prompt = codeFor(base, 'agent');

      expect(prompt).toContain(EMBED_URL);
      expect(prompt).toContain('allow="ethereum; solana; clipboard-write"');
      expect(prompt).toContain('do not rewrite or drop the query string');
      expect(prompt).toContain('Do not install any @sodax/* package');
      expect(prompt).toContain('real funds on mainnet');
    });

    it('names the pair in ChainKeys terms, as the code tabs do', () => {
      expect(codeFor(base, 'agent')).toContain('ChainKeys.SOLANA_MAINNET');
    });

    it('tells the reader where to paste it', () => {
      const agent = buildSnippets(base, EMBED_URL).find(snippet => snippet.id === 'agent');
      expect(agent?.note).toContain('coding agent');
    });
  });

  // The whole point of the panel: a reader pastes chain keys that exist in the version they install.
  it('names chains as ChainKeys expressions, never raw key strings', () => {
    const code = codeFor(base, 'quote');
    expect(code).toMatch(/tokenSrcChainKey: ChainKeys\.\w+/);
    expect(code).not.toContain(`'${SRC_CHAIN}'`);
  });

  it('quotes through the swaps API, which is what reaches a non-EVM chain with no wallet', () => {
    const code = codeFor(base, 'quote');
    expect(code).toContain('useSwapsApiQuote');
    expect(code).toContain('tokenDstChainKey: ChainKeys.SOLANA_MAINNET');
  });

  it('carries the form amount and the token addresses into the quote', () => {
    const code = codeFor(base, 'quote');
    expect(code).toContain(`parseUnits('1.5', ${base.srcToken?.decimals})`);
    expect(code).toContain(base.srcToken?.address ?? '');
  });

  it('turns slippage percent into integer basis points', () => {
    expect(codeFor({ ...base, slippagePercent: '0.5' }, 'quote')).toContain('9950n');
    expect(codeFor({ ...base, slippagePercent: '1' }, 'quote')).toContain('9900n');
  });

  describe('without a partner fee', () => {
    it('leaves it as a hint rather than an empty field', () => {
      expect(codeFor(base, 'quote')).toContain('Add partnerFee');
      expect(codeFor(base, 'quote')).not.toContain(`address: '${RECIPIENT}'`);
    });
  });

  describe('with a partner fee', () => {
    const withFee: SnippetState = { ...base, partnerFee: { address: RECIPIENT, percentage: 25 } };

    it('rides on the quote request, which is where the v2 API takes it', () => {
      expect(codeFor(withFee, 'quote')).toContain(`partnerFee: { address: '${RECIPIENT}', percentage: 25 }`);
    });

    // Subtracting it before quoting charges it twice — the bug the frontend documents in place.
    it('warns against deducting it a second time', () => {
      expect(codeFor(withFee, 'quote')).toContain('charges it twice');
    });
  });
});
