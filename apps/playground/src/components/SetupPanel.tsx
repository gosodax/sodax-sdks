import { appIdSignupUrl } from '../lib/appId';
import { type Ref, useState } from 'react';
import type { SwapFlow } from '../hooks/useSwapFlow';
import { chainName, executableFamilies } from '../lib/chains';
import { canExecute } from '../lib/execution';
import { networkAllowed, tokenId } from '../lib/widgetSettings';
import { Dropdown } from './Dropdown';

function SideSettings({ flow, source }: { flow: SwapFlow; source: boolean }) {
  const [search, setSearch] = useState('');
  const networksKey = source ? 'sourceNetworks' : 'destinationNetworks';
  const tokensKey = source ? 'sourceTokens' : 'destinationTokens';
  const lockKey = source ? 'lockSource' : 'lockDestination';
  const networks = source ? flow.sourceNetworks : flow.destinationNetworks;
  const choices = source ? flow.sourceChoices : flow.destinationChoices;
  const chain = source ? flow.srcChain : flow.dstChain;
  const token = source ? flow.srcToken : flow.dstToken;
  const label = source ? 'Send from' : 'Receive on';
  const onChain = choices.filter(choice => choice.chain === chain);
  const permitted = flow.widget[tokensKey];
  const options = flow.allChoices.filter(choice => networkAllowed(choice.chain, flow.widget[networksKey]));
  const visible = options.filter(choice =>
    `${choice.token.symbol} ${choice.token.name} ${chainName(choice.chain)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <fieldset className="setup-side">
      <legend>{label}</legend>
      <div className="setup-pair">
        <div className="brand-cell">
          <span>Default network</span>
          <Dropdown
            label={`${label} default network`}
            placeholder="No networks available"
            value={chain}
            options={networks.map(value => ({ value, label: chainName(value) }))}
            onChange={next => {
              if (source) flow.setSrcChain(next);
              else flow.setDstChain(next);
            }}
          />
        </div>
        <div className="brand-cell">
          <span>Default token</span>
          <Dropdown
            label={`${label} default token`}
            placeholder="No tokens available"
            value={token?.symbol}
            options={onChain.map(choice => ({ value: choice.token.symbol, label: choice.token.symbol }))}
            onChange={symbol => {
              const next = onChain.find(choice => choice.token.symbol === symbol)?.token;
              if (source) flow.setSrcToken(next);
              else flow.setDstToken(next);
            }}
          />
        </div>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={!!flow.widget[lockKey]}
          onChange={event => flow.setWidget(current => ({ ...current, [lockKey]: event.target.checked }))}
        />
        Lock this token and network
      </label>
      <details className="disclosure">
        <summary>Allowed networks &amp; tokens</summary>
        <p className="muted small">Choose what users can select when this side is unlocked.</p>
        <button
          className="btn"
          type="button"
          onClick={() => flow.setWidget(current => ({ ...current, [networksKey]: [], [tokensKey]: undefined }))}
        >
          Allow all
        </button>
        <div className="network-checks setup-networks">
          {flow.chains.map(value => (
            <label key={value}>
              <input
                type="checkbox"
                checked={networkAllowed(value, flow.widget[networksKey])}
                onChange={event => {
                  const checked = event.target.checked;
                  flow.setWidget(current => {
                    const active = current[networksKey].length ? current[networksKey] : flow.chains;
                    const next = checked ? [...new Set([...active, value])] : active.filter(item => item !== value);
                    return next.length ? { ...current, [networksKey]: next } : current;
                  });
                }}
              />
              {chainName(value)}
              {!canExecute(value) && <span className="muted small">Quote only</span>}
            </label>
          ))}
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={permitted !== undefined}
            onChange={event =>
              flow.setWidget(current => ({
                ...current,
                [tokensKey]: event.target.checked ? options.map(tokenId) : undefined,
              }))
            }
          />
          Limit selectable tokens
        </label>
        {permitted !== undefined && (
          <>
            <input
              className="input token-search"
              aria-label={`${label} search allowed tokens`}
              placeholder="Search tokens or networks…"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            <div className="token-checks">
              {visible.map(choice => (
                <label className="check-row" key={tokenId(choice)}>
                  <input
                    type="checkbox"
                    checked={permitted.includes(tokenId(choice))}
                    onChange={event => {
                      const checked = event.target.checked;
                      const id = tokenId(choice);
                      flow.setWidget(current => ({
                        ...current,
                        [tokensKey]: checked
                          ? [...new Set([...(current[tokensKey] ?? []), id])]
                          : current[tokensKey]?.filter(value => value !== id),
                      }));
                    }}
                  />
                  <span>
                    {choice.token.symbol} <span className="muted">· {chainName(choice.chain)}</span>
                  </span>
                </label>
              ))}
              {!visible.length && <p className="muted small">No matching tokens.</p>}
            </div>
            {!choices.length && (
              <p className="alert" role="status">
                Allow at least one available token to preview and export.
              </p>
            )}
          </>
        )}
      </details>
    </fieldset>
  );
}

export function SetupPanel({
  flow,
  appIdInput,
  appIdRequested,
}: {
  flow: SwapFlow;
  appIdInput?: Ref<HTMLInputElement>;
  appIdRequested?: boolean;
}) {
  const appIdMissing = !!appIdRequested && !flow.appId.trim();
  return (
    <section className="card setup-card">
      <h3>Set up your swap</h3>
      <p className="muted small">Choose the starting trade and what your users can change.</p>
      <label className="brand-cell">
        App ID (required)
        <input
          ref={appIdInput}
          className="input"
          aria-invalid={appIdMissing}
          placeholder="wgt_…"
          spellCheck={false}
          value={flow.appId}
          onChange={event => flow.setAppId(event.target.value)}
        />
      </label>
      {flow.appId.trim() && !flow.validAppId ? (
        <p className="alert" role="status">
          That app ID is not valid. Copy it from the dev portal.
        </p>
      ) : (
        <p className={appIdMissing ? 'small field-error' : 'muted small'}>
          {appIdMissing && 'Add your app ID to copy the embed. '}Create one for free in the{' '}
          <a href={appIdSignupUrl('builder')} target="_blank" rel="noreferrer">
            {appIdMissing ? 'dev portal ↗' : 'SODAX dev portal ↗'}
          </a>
          {!appIdMissing && ', where you also set your fee.'}
        </p>
      )}
      <SideSettings flow={flow} source />
      <SideSettings flow={flow} source={false} />
      <div className="setup-pair">
        <label className="brand-cell">
          Starting amount
          <input
            className="input"
            inputMode="decimal"
            value={flow.amount}
            onChange={event => flow.setAmount(event.target.value)}
          />
        </label>
        <label className="brand-cell">
          Slippage (%)
          <input
            className="input"
            inputMode="decimal"
            value={flow.slippagePercent}
            onChange={event => flow.setSlippagePercent(event.target.value)}
          />
        </label>
      </div>
      {!flow.isLoadingAssets && (!flow.isAmountValid || !flow.isSlippageValid) && (
        <p className="alert" role="status">
          Enter a positive amount and slippage from 0% to less than 100%.
        </p>
      )}
      <details className="disclosure">
        <summary>Which networks swap in the widget</summary>
        <p className="muted small">
          Swaps on {executableFamilies()} complete in the widget. Networks marked Quote only send users to the SODAX
          exchange to finish the trade.
        </p>
      </details>
    </section>
  );
}
