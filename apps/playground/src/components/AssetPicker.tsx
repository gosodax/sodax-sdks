import { type ChainKey, tokenLogo } from '@sodax/dapp-kit';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAssetBalances } from '../hooks/useAssetBalances';
import { groupBalanceText, tokenBalanceText } from '../lib/balances';
import { type TokenChoice, chainLogo, chainName } from '../lib/chains';
import { canExecute } from '../lib/execution';
import { type AssetGroup, filterGroups, previewNetworks, sortAssetGroups } from '../lib/pickerOptions';
import { Glyph } from './AssetLogo';
import { Chevron } from './Dropdown';

/** A tile's corner mark: how many chains carry the asset, or — when only one does — which chain. */
type Mark = { kind: 'count'; value: number } | { kind: 'chain'; chain: ChainKey };

/** What a network in the flyout is, spoken: the chain, what is held there, and whether it executes. */
function networkLabel(chain: ChainKey, symbol: string, held: string | undefined): string {
  return [chainName(chain), ...(held ? [`${held} ${symbol}`] : []), ...(canExecute(chain) ? [] : ['quote only'])].join(
    ' — ',
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function GridGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" />
    </svg>
  );
}

function AllNetworksMark<K extends ChainKey>({ networks }: { networks: readonly K[] }) {
  return (
    <span className="all-networks-mark" aria-hidden="true">
      {previewNetworks(networks).map(key => (
        <Glyph key={key} className="all-networks-cell" src={chainLogo(key)} alt="" initial={chainName(key)} />
      ))}
    </span>
  );
}

function Tile({
  logo,
  alt,
  label,
  mark,
  active,
  note,
  held,
  showHeld,
  onClick,
}: {
  logo: string;
  alt: string;
  label: string;
  mark: Mark;
  active?: boolean;
  note?: string;
  /** The wallet's holding across every network this asset reaches, revealed on hover. */
  held?: string;
  /** Reserved for the whole grid at once, so a row does not change height as balances land. */
  showHeld: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`tile${active ? ' tile-active' : ''}`} title={note} onClick={onClick}>
      <span className="tile-disc">
        <Glyph key={logo} className="tile-img" src={logo} alt={alt} initial={label} />
        {mark.kind === 'count' ? (
          <span className="tile-mark tile-mark-count">
            <span>{mark.value}</span>
          </span>
        ) : (
          <Glyph
            key={chainLogo(mark.chain)}
            className="tile-mark tile-mark-chain"
            src={chainLogo(mark.chain)}
            alt={chainName(mark.chain)}
            initial={chainName(mark.chain)}
          />
        )}
      </span>
      <span className="tile-text">
        <span className="tile-label">{label}</span>
        {showHeld && <span className="tile-balance">{held}</span>}
      </span>
    </button>
  );
}

export type AssetPickerProps<K extends ChainKey = ChainKey> = {
  open: boolean;
  onClose: () => void;
  groups: readonly AssetGroup<K>[];
  networks: readonly K[];
  selected: { chain: K; symbol: string } | undefined;
  onSelect: (choice: TokenChoice<K>) => void;
};

/**
 * Port of the exchange's asset picker: one tile per asset, the chains it reaches behind a count,
 * rather than a row per token-chain pair. Not an import of sodax-frontend — that app pulls in Next,
 * Tailwind and wallet balances, none of which belong here.
 */
export function AssetPicker<K extends ChainKey>({
  open,
  onClose,
  groups,
  networks,
  selected,
  onSelect,
}: AssetPickerProps<K>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const openCell = useRef<HTMLDivElement>(null);
  const flyout = useRef<HTMLDivElement>(null);
  const [flyoutShift, setFlyoutShift] = useState(0);
  const [query, setQuery] = useState('');
  const [network, setNetwork] = useState<K>();
  const [isNetworkOpen, setNetworkOpen] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const [hovered, setHovered] = useState<K>();

  useEffect(() => {
    if (open) {
      setQuery('');
      setNetwork(undefined);
      setNetworkOpen(false);
      setExpanded(undefined);
      setHovered(undefined);
      if (!dialog.current?.open) dialog.current?.showModal();
      searchInput.current?.focus();
    } else dialog.current?.close();
  }, [open]);

  // A flyout is centred on its tile, and the grid it sits in scrolls — so a tile in an outer column
  // would open half outside the scroller, which clips it. Measure the tile, never the flyout: the
  // flyout already carries the last nudge, and measuring that would compound it.
  useLayoutEffect(() => {
    const cell = openCell.current?.getBoundingClientRect();
    const bounds = grid.current?.getBoundingClientRect();
    const width = flyout.current?.getBoundingClientRect().width;
    if (!expanded || !cell || !bounds || !width) {
      setFlyoutShift(0);
      return;
    }

    const left = cell.left + cell.width / 2 - width / 2;
    const right = left + width;
    setFlyoutShift(left < bounds.left ? bounds.left - left : right > bounds.right ? bounds.right - right : 0);
  }, [expanded]);

  const balances = useAssetBalances(groups, open);
  // Balances are a fresh object every render, so a memo over them would store work it always redoes.
  // Both passes are one step per symbol, small enough to run with the render that reads them.
  const visible = filterGroups(sortAssetGroups(groups, balances), query, network);
  // Held amounts are read across the whole list, not the filtered view: the line the grid reserves
  // for them must not come and go as a search narrows the tiles.
  const heldBySymbol = new Map(groups.map(group => [group.symbol, groupBalanceText(balances, group.choices)]));
  const showHeld = [...heldBySymbol.values()].some(Boolean);

  // An open flyout or network sheet is a layer over the grid: dismissing it must not close the picker.
  const layered = isNetworkOpen || expanded !== undefined;
  const closeLayers = () => {
    setNetworkOpen(false);
    setExpanded(undefined);
  };

  const pick = (choice: TokenChoice<K>) => {
    onSelect(choice);
    onClose();
  };

  const openGroup = (group: AssetGroup<K>) => {
    const [only] = group.choices;
    if (only && group.choices.length === 1) {
      pick(only);
      return;
    }
    setNetworkOpen(false);
    setHovered(undefined);
    setExpanded(current => (current === group.symbol ? undefined : group.symbol));
  };

  return (
    <dialog
      ref={dialog}
      className="picker"
      aria-label="Choose an asset"
      onClose={onClose}
      onCancel={event => {
        if (!layered) return;
        event.preventDefault();
        closeLayers();
      }}
      onClick={event => {
        if (event.target === dialog.current) onClose();
      }}
    >
      {/* Clicks inside land on this element, so the backdrop test above closes only on the backdrop. */}
      <div className="picker-body">
        <button type="button" className="picker-close" aria-label="Close asset picker" onClick={onClose}>
          ×
        </button>

        <div className="picker-search">
          {isNetworkOpen ? <GridGlyph /> : <SearchGlyph />}
          <input
            ref={searchInput}
            type="text"
            aria-label={isNetworkOpen ? 'Select a network' : 'Search assets'}
            placeholder={isNetworkOpen ? 'Select a network' : 'Search assets…'}
            value={query}
            readOnly={isNetworkOpen}
            onChange={event => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="picker-toolbar"
            aria-expanded={isNetworkOpen}
            aria-label={network ? `Network: ${chainName(network)}` : 'All networks'}
            onClick={() => {
              setExpanded(undefined);
              setNetworkOpen(isOpen => !isOpen);
            }}
          >
            {network ? (
              <Glyph
                key={chainLogo(network)}
                className="picker-toolbar-chain"
                src={chainLogo(network)}
                alt=""
                initial={chainName(network)}
              />
            ) : (
              <AllNetworksMark networks={networks} />
            )}
            <Chevron up={isNetworkOpen} className="picker-chevron" />
          </button>
        </div>

        <div className={`picker-stage${isNetworkOpen ? ' picker-stage-sheet' : ''}`}>
          <div
            ref={grid}
            className={`tile-grid${isNetworkOpen ? ' tile-grid-behind' : ''}${layered ? ' tile-grid-locked' : ''}`}
          >
            {visible.length === 0 ? (
              <p className="muted small picker-empty">No matching assets. Try another network or search.</p>
            ) : (
              visible.map(group => {
                const [first] = group.choices;
                if (!first) return null;
                const isOpen = expanded === group.symbol;
                const spread = group.choices.length > 1;
                const onNetwork = isOpen ? group.choices.find(choice => choice.chain === hovered) : undefined;
                const onNetworkHeld = onNetwork && tokenBalanceText(balances, onNetwork);
                return (
                  <div
                    key={group.symbol}
                    ref={isOpen ? openCell : undefined}
                    className={`tile-cell${isOpen ? ' tile-cell-open' : ''}${expanded && !isOpen ? ' tile-cell-dim' : ''}`}
                  >
                    <Tile
                      logo={tokenLogo(group.symbol)}
                      alt={group.symbol}
                      label={group.symbol}
                      mark={
                        spread ? { kind: 'count', value: group.choices.length } : { kind: 'chain', chain: first.chain }
                      }
                      active={selected?.symbol === group.symbol}
                      note={!spread && !canExecute(first.chain) ? `Quote only on ${chainName(first.chain)}` : undefined}
                      held={heldBySymbol.get(group.symbol)}
                      showHeld={showHeld}
                      onClick={() => openGroup(group)}
                    />
                    {isOpen && (
                      <div
                        ref={flyout}
                        className="chain-flyout"
                        style={{ transform: `translateX(calc(-50% + ${flyoutShift}px))` }}
                      >
                        {/* The caption is the network's own line: what is held there, or the asset on it. */}
                        <p className="chain-flyout-caption">
                          {!onNetwork
                            ? 'Choose a network'
                            : onNetworkHeld
                              ? `${onNetworkHeld} ${group.symbol}`
                              : `${group.symbol} on ${chainName(onNetwork.chain)}`}
                        </p>
                        <div className="chain-flyout-row">
                          {group.choices.map(choice => {
                            const chainHeld = tokenBalanceText(balances, choice);
                            return (
                              <button
                                key={choice.chain}
                                type="button"
                                className={`chain-flyout-icon${chainHeld ? ' chain-flyout-icon-funded' : ''}${
                                  selected?.chain === choice.chain && selected.symbol === group.symbol
                                    ? ' chain-flyout-icon-active'
                                    : ''
                                }`}
                                aria-label={networkLabel(choice.chain, group.symbol, chainHeld)}
                                onMouseEnter={() => setHovered(choice.chain)}
                                onMouseLeave={() => setHovered(undefined)}
                                onFocus={() => setHovered(choice.chain)}
                                onBlur={() => setHovered(undefined)}
                                onClick={() => pick(choice)}
                              >
                                <Glyph
                                  key={chainLogo(choice.chain)}
                                  className="chain-flyout-logo"
                                  src={chainLogo(choice.chain)}
                                  alt=""
                                  initial={chainName(choice.chain)}
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {layered && (
            <button type="button" className="picker-scrim" aria-label="Dismiss network options" onClick={closeLayers} />
          )}

          {isNetworkOpen && (
            <div className="network-overlay">
              <button
                type="button"
                className={network ? 'network-row' : 'network-row network-row-active'}
                onClick={() => {
                  setNetwork(undefined);
                  setNetworkOpen(false);
                }}
              >
                <AllNetworksMark networks={networks} />
                All
              </button>
              {networks.map(key => (
                <button
                  key={key}
                  type="button"
                  className={key === network ? 'network-row network-row-active' : 'network-row'}
                  onClick={() => {
                    setNetwork(key);
                    setNetworkOpen(false);
                  }}
                >
                  <Glyph
                    key={chainLogo(key)}
                    className="network-logo"
                    src={chainLogo(key)}
                    alt=""
                    initial={chainName(key)}
                  />
                  <span className="network-row-text">
                    {chainName(key)}
                    {!canExecute(key) && <span className="muted small">Quote only</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
