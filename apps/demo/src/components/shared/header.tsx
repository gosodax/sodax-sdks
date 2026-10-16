import React from 'react';
import { NavLink, useLocation, useMatch } from 'react-router';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { WalletModal } from '@/components/shared/wallet-modal';
import { SodaxSettingsModal } from '@/components/shared/SodaxSettingsModal';
import { useXAccounts } from '@sodax/wallet-sdk-react';
import { useAppStore } from '@/zustand/useAppStore';
import { ChevronDown, Menu, Settings2, Wallet } from 'lucide-react';
import { ROUTES } from '@/constants';
import { hasActiveOverrides } from '@/lib/sodaxSettings';

type NavItem = { to: string; label: string };
type NavEntry = NavItem | { label: string; items: NavItem[] };

// Grouped so every entry fits on one line: SDK/API pairs and rarely-used pages fold into menus.
const navEntries: NavEntry[] = [
  { to: ROUTES.MONEY_MARKET, label: 'Money Market' },
  {
    label: 'Swaps',
    items: [
      { to: ROUTES.SWAPS_SDK, label: 'Swaps (SDK)' },
      { to: ROUTES.SWAPS_API, label: 'Swaps (API)' },
    ],
  },
  {
    label: 'Bridge',
    items: [
      { to: ROUTES.BRIDGE, label: 'Bridge (SDK)' },
      { to: ROUTES.BRIDGE_API, label: 'Bridge (API)' },
    ],
  },
  {
    label: 'Leverage Yield',
    items: [
      { to: ROUTES.LEVERAGE_YIELD, label: 'Leverage Yield (SDK)' },
      { to: ROUTES.LEVERAGE_YIELD_API, label: 'Leverage Yield (API)' },
      { to: ROUTES.LEVERAGE_POSITIONS, label: 'Leverage Positions' },
    ],
  },
  {
    label: 'More',
    items: [
      { to: ROUTES.STAKING, label: 'Staking' },
      { to: ROUTES.DEX, label: 'Dex' },
      { to: ROUTES.ORACLE, label: 'Oracle' },
      { to: ROUTES.PARTNER_FEE_CLAIM, label: 'Partner Fee Claim' },
      { to: ROUTES.RECOVERY, label: 'Recovery' },
    ],
  },
];

const navItemClass = (isActive: boolean) =>
  `flex items-center gap-1 whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium tracking-wide transition-all cursor-pointer ${
    isActive ? 'bg-cherry-brighter text-cherry-dark' : 'text-cream-white hover:bg-cherry-soda hover:text-white'
  }`;

const menuItemClass = (isActive: boolean) =>
  `block whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'bg-cherry-brighter text-cherry-dark' : 'text-cherry-dark hover:bg-cream'
  }`;

function NavDropdown({ label, items }: { label: string; items: NavItem[] }) {
  const [open, setOpen] = React.useState(false);
  const { pathname } = useLocation();
  const childActive = items.some(item => pathname.startsWith(item.to));

  // Close on focus leaving the wrapper (not a blur timeout): keyboard users can Tab into the
  // menu, and a slow click can't unmount the link before its click event fires.
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) {
      setOpen(false);
    }
  };

  return (
    <div className="relative" onBlur={onBlur} onKeyDown={e => e.key === 'Escape' && setOpen(false)}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={navItemClass(childActive)}>
        {label}
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 min-w-44 bg-white rounded-lg shadow-lg border border-cherry-grey/20 p-1.5 z-50">
          {items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) => menuItemClass(isActive)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function NavigationMenu() {
  return (
    <nav className="hidden xl:flex items-center gap-1">
      {navEntries.map(entry =>
        'items' in entry ? (
          <NavDropdown key={entry.label} label={entry.label} items={entry.items} />
        ) : (
          <NavLink key={entry.to} to={entry.to} className={({ isActive }) => navItemClass(isActive)}>
            {entry.label}
          </NavLink>
        ),
      )}
    </nav>
  );
}

// A string className (not NavLink's function form): SheetClose's Slot merges className by string concatenation.
function MobileNavLink({ to, label }: NavItem) {
  const isActive = useMatch({ path: to, end: false }) !== null;
  return (
    <SheetClose asChild>
      <NavLink to={to} className={menuItemClass(isActive)}>
        {label}
      </NavLink>
    </SheetClose>
  );
}

// The one-line nav does not fit below xl, so it moves into a sheet there.
function MobileNav() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="cherryOutline" size="sm" className="xl:hidden" aria-label="Open navigation">
          <Menu className="w-4 h-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" aria-describedby={undefined} className="overflow-y-auto">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <nav className="flex flex-col gap-1 mt-6">
          {navEntries.map(entry =>
            'items' in entry ? (
              <div key={entry.label} className="flex flex-col gap-1">
                <span className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-clay">
                  {entry.label}
                </span>
                {entry.items.map(item => (
                  <MobileNavLink key={item.to} {...item} />
                ))}
              </div>
            ) : (
              <MobileNavLink key={entry.to} {...entry} />
            ),
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export default function Header() {
  const { isWalletModalOpen, openWalletModal, closeWalletModal, sodaxSettings } = useAppStore();
  const xAccounts = useXAccounts();
  const [showChains, setShowChains] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);

  const connectedXAccounts = Object.values(xAccounts).filter(xAccount => xAccount?.address);

  return (
    <header className="bg-cherry-dark border-b border-cherry-soda/20 sticky top-0 z-50 backdrop-blur-sm">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center gap-2 sm:gap-4 py-3">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <MobileNav />
            <NavLink to="/" className="whitespace-nowrap text-lg font-bold tracking-wide text-cream-white">
              SODAX <span className="font-normal opacity-60 max-sm:hidden">demo</span>
            </NavLink>
            <NavigationMenu />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={() => setShowSettings(true)}
              variant="cherryOutline"
              size="sm"
              className="relative"
              title="Sodax Settings"
            >
              <Settings2 className="w-4 h-4" />
              <span className="max-sm:sr-only">Settings</span>
              {hasActiveOverrides(sodaxSettings) && (
                <span
                  className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full"
                  title="Overrides active"
                />
              )}
            </Button>

            {connectedXAccounts.length > 0 ? (
              <>
                <div className="relative">
                  <Button
                    onClick={() => setShowChains(!showChains)}
                    onBlur={() => setTimeout(() => setShowChains(false), 200)}
                    className="flex items-center gap-2 px-3 py-1.5 max-[360px]:gap-1 max-[360px]:px-2 bg-cherry-bright/20 rounded-lg hover:bg-cherry-soda/30 transition-colors"
                  >
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-sm text-cream-white font-medium whitespace-nowrap">
                      {connectedXAccounts.length}
                      <span className="max-sm:sr-only"> Chain{connectedXAccounts.length > 1 ? 's' : ''}</span>
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-cream-white transition-transform ${showChains ? 'rotate-180' : ''}`}
                    />
                  </Button>

                  {showChains && (
                    <div className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] bg-white rounded-lg shadow-lg border border-cherry-grey/20 p-3 z-50">
                      <h4 className="font-semibold text-sm text-cherry-dark mb-3">Connected Chains</h4>
                      <div className="space-y-2">
                        {connectedXAccounts.map((xAccount, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-2 p-2 rounded-lg bg-cream/50 hover:bg-cream transition-colors"
                          >
                            <div className="w-2 h-2 bg-cherry-soda rounded-full" />
                            <span className="text-sm font-medium text-cherry-dark">{xAccount?.xChainType}</span>
                            {xAccount?.address && (
                              <code className="ml-auto text-xs text-clay font-mono">
                                {xAccount.address.slice(0, 6)}...{xAccount.address.slice(-4)}
                              </code>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <Button onClick={openWalletModal} variant="cherryOutline" size="sm">
                  <Wallet className="w-4 h-4" />
                  <span className="max-sm:sr-only">Wallet</span>
                </Button>
              </>
            ) : (
              <Button onClick={openWalletModal} variant="cherryOutline" size="sm" className="whitespace-nowrap">
                <Wallet className="w-4 h-4" />
                <span>
                  Connect<span className="max-[360px]:sr-only"> Wallet</span>
                </span>
              </Button>
            )}
          </div>
        </div>
      </div>
      <WalletModal isOpen={isWalletModalOpen} onDismiss={closeWalletModal} />
      <SodaxSettingsModal open={showSettings} onOpenChange={setShowSettings} />
    </header>
  );
}
