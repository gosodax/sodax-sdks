/**
 * Renders every data-sodax-config placeholder on a page from the backend config
 * API v2, the source of truth for what is live (an SDK release can list a token
 * the backend does not serve yet). A placeholder's own markup is the fallback.
 * Views, attributes and rationale: README.md → "Live config tables".
 */
(() => {
  const CONFIG_URL = 'https://api.sodax.com/v2/be/config/all';
  const HUB_CHAIN = 'sonic';
  const RENDERED_ATTR = 'data-sodax-rendered';

  let configPromise = null;

  const loadConfig = () => {
    configPromise ??= fetch(CONFIG_URL, { headers: { Accept: 'application/json' } })
      .then(response => {
        if (!response.ok) throw new Error(`bad status ${response.status}`);
        return response.json();
      })
      .then(body => {
        const config = body?.config;
        if (!config?.chains || typeof config.chains !== 'object') {
          throw new Error('unexpected config shape');
        }
        return { version: body.version, config };
      });

    return configPromise;
  };

  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  };

  // Config values are data, never markup: text goes in as textContent, and an address
  // (base58, Sui coin type, Injective factory/ibc denom) is allowlisted before a URL.
  const SAFE_ADDRESS = /^[A-Za-z0-9:._/-]{1,128}$/;
  const safeAddress = address => SAFE_ADDRESS.test(address) && !address.split('/').includes('..');

  const httpsUrl = (base, value) => {
    if (!base) return null;
    if (value && !safeAddress(String(value))) return null;
    try {
      const url = new URL(String(base) + (value ?? ''));
      return url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  };

  const externalLink = (href, child) => {
    const link = node('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.appendChild(child);
    return link;
  };

  const addressCell = (chain, address, isNative) => {
    const cell = node('td');
    if (!address) {
      cell.appendChild(node('span', 'sodax-config-muted', '—'));
      return cell;
    }

    const code = node('code', null, address);
    const href = isNative ? null : httpsUrl(chain?.chain?.explorer?.addressUrl, address);
    cell.appendChild(href ? externalLink(href, code) : code);

    if (isNative) {
      cell.appendChild(document.createTextNode(' '));
      cell.appendChild(node('span', 'sodax-config-muted', '(native)'));
    }

    return cell;
  };

  const chainName = (chains, key) => chains[key]?.chain?.name ?? key;

  /** Hub first, then by display name — the config's own key order is not stable. */
  const orderedChainKeys = (chains, keys) =>
    [...keys].sort((a, b) => {
      if (a === HUB_CHAIN) return -1;
      if (b === HUB_CHAIN) return 1;
      return chainName(chains, a).localeCompare(chainName(chains, b));
    });

  const table = (headings, rows) => {
    const wrapper = node('div', 'sodax-config-table');
    const element = node('table');

    const headRow = node('tr');
    for (const heading of headings) headRow.appendChild(node('th', null, heading));
    const head = node('thead');
    head.appendChild(headRow);
    element.appendChild(head);

    const body = node('tbody');
    for (const row of rows) body.appendChild(row);
    element.appendChild(body);

    wrapper.appendChild(element);
    return wrapper;
  };

  const replace = (target, children) => {
    target.textContent = '';
    for (const child of children) target.appendChild(child);
    target.setAttribute(RENDERED_ATTR, 'true');
  };

  const setText = (target, text) => {
    target.textContent = text;
    target.setAttribute(RENDERED_ATTR, 'true');
  };

  /** data-type="EVM" | "non-EVM" and a comma-separated data-exclude of chain keys. */
  const selectedChainKeys = (target, chains) => {
    const type = target.getAttribute('data-type');
    const excluded = (target.getAttribute('data-exclude') ?? '').split(',').map(key => key.trim());

    return orderedChainKeys(
      chains,
      Object.keys(chains).filter(key => {
        if (excluded.includes(key)) return false;
        if (type === 'EVM') return chains[key]?.chain?.type === 'EVM';
        if (type === 'non-EVM') return chains[key]?.chain?.type !== 'EVM';
        return true;
      }),
    );
  };

  const renderChainNames = (target, data) => {
    const { chains } = data.config;
    const names = selectedChainKeys(target, chains).map(key => chainName(chains, key));
    if (names.length === 0) throw new Error('no chains for selection');
    setText(target, names.join(', '));
  };

  const renderChains = (target, data) => {
    const { chains } = data.config;
    const rows = selectedChainKeys(target, chains).map(key => {
      const meta = chains[key]?.chain ?? {};
      const row = node('tr');

      row.appendChild(node('td', null, meta.name ?? key));
      row.appendChild(node('td', null, meta.type ?? '—'));

      const keyCell = node('td');
      keyCell.appendChild(node('code', null, key));
      row.appendChild(keyCell);

      const explorerCell = node('td');
      const href = httpsUrl(meta.explorer?.baseUrl);
      explorerCell.appendChild(
        href ? externalLink(href, node('span', null, new URL(href).host)) : node('span', 'sodax-config-muted', '—'),
      );
      row.appendChild(explorerCell);

      return row;
    });

    replace(target, [table(['Network', 'Type', 'Chain key', 'Explorer'], rows)]);
  };

  const tokenRow = (chains, chainKey, token) => {
    const chain = chains[chainKey];
    const row = node('tr');

    const symbolCell = node('td');
    symbolCell.appendChild(node('strong', null, token.symbol ?? '—'));
    if (token.name && token.name !== token.symbol) {
      symbolCell.appendChild(document.createTextNode(' '));
      symbolCell.appendChild(node('span', 'sodax-config-muted', token.name));
    }
    row.appendChild(symbolCell);

    row.appendChild(
      addressCell(chain, token.address, Boolean(chain?.nativeToken) && chain.nativeToken === token.address),
    );
    row.appendChild(addressCell(chains[HUB_CHAIN], token.hubAsset, false));

    return row;
  };

  const renderTokensByChain = (target, data, tokensByChain) => {
    const { chains } = data.config;
    const requested = target.getAttribute('data-chain');
    const keys = Object.keys(tokensByChain).filter(
      key => Array.isArray(tokensByChain[key]) && tokensByChain[key].length > 0 && (!requested || key === requested),
    );
    if (keys.length === 0) throw new Error(`no tokens for ${requested ?? 'any chain'}`);

    const sections = orderedChainKeys(chains, keys).map(key => {
      const section = node('div', 'sodax-config-section');
      if (!requested) section.appendChild(node('h3', 'sodax-config-heading', chainName(chains, key)));
      section.appendChild(
        table(
          ['Token', `Address on ${chainName(chains, key)}`, 'Hub asset (Sonic)'],
          tokensByChain[key].map(token => tokenRow(chains, key, token)),
        ),
      );
      return section;
    });

    replace(target, sections);
  };

  const renderSwapTokens = (target, data) => {
    const tokens = data.config.swaps?.supportedTokens;
    if (!tokens) throw new Error('no swap tokens in config');
    renderTokensByChain(target, data, tokens);
  };

  const renderMoneyMarketTokens = (target, data) => {
    const tokens = data.config.moneyMarket?.supportedTokens;
    if (!tokens) throw new Error('no money market tokens in config');
    renderTokensByChain(target, data, tokens);
  };

  const uniqueSymbols = (tokensByChain, chainKey) => {
    const symbols = new Set();
    for (const [key, tokens] of Object.entries(tokensByChain ?? {})) {
      if (chainKey && key !== chainKey) continue;
      for (const token of tokens ?? []) {
        if (token?.symbol) symbols.add(token.symbol);
      }
    }
    return symbols.size;
  };

  const metricValue = (data, metric, chainKey) => {
    const { chains, swaps, moneyMarket } = data.config;
    const reserves = moneyMarket?.supportedReserveAssets;

    if (metric === 'networks') return Object.keys(chains).length;
    if (metric === 'reserve-assets') return Array.isArray(reserves) ? reserves.length : null;
    if (metric === 'swap-tokens') return uniqueSymbols(swaps?.supportedTokens);
    if (metric === 'money-market-tokens') return uniqueSymbols(moneyMarket?.supportedTokens);
    if (metric === 'chain-swap-tokens') return uniqueSymbols(swaps?.supportedTokens, chainKey);
    if (metric === 'chain-money-market-tokens') return uniqueSymbols(moneyMarket?.supportedTokens, chainKey);
    return null;
  };

  const renderCount = (target, data) => {
    const value = metricValue(data, target.getAttribute('data-metric'), target.getAttribute('data-chain'));
    if (typeof value !== 'number' || value === 0) throw new Error('no value for metric');
    setText(target, value.toLocaleString('en-US') + (target.getAttribute('data-suffix') ?? ''));
  };

  const renderVersion = (target, data) => {
    if (typeof data.version !== 'number') throw new Error('no config version');
    setText(target, String(data.version));
  };

  const VIEWS = {
    chains: renderChains,
    'chain-names': renderChainNames,
    'swap-tokens': renderSwapTokens,
    'money-market-tokens': renderMoneyMarketTokens,
    count: renderCount,
    version: renderVersion,
  };

  const pending = () => [...document.querySelectorAll(`[data-sodax-config]:not([${RENDERED_ATTR}])`)];

  const paint = () => {
    const targets = pending();
    if (targets.length === 0) return;

    loadConfig()
      .then(data => {
        for (const target of targets) {
          const render = VIEWS[target.getAttribute('data-sodax-config')];
          if (!render) continue;
          try {
            render(target, data);
          } catch {
            // Leave this placeholder's fallback markup in place.
          }
        }
      })
      .catch(() => {});
  };

  const injectStyles = () => {
    const style = document.createElement('style');
    style.textContent = [
      '.sodax-config-table{overflow-x:auto}',
      '.sodax-config-table table{width:100%}',
      '.sodax-config-table code{white-space:nowrap}',
      '.sodax-config-section+.sodax-config-section{margin-top:1.5rem}',
      '.sodax-config-muted{opacity:.65;font-weight:400}',
    ].join('');
    document.head.appendChild(style);
  };

  const start = () => {
    injectStyles();
    paint();

    // Mintlify is a client-routed SPA: this file runs once per hard navigation,
    // so watch for placeholders that arrive with a later in-app navigation.
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled || pending().length === 0) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        paint();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();
