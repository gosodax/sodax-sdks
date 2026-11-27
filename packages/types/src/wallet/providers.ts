import type { SpokeChainKey, ChainType, GetChainType } from '../chains/chains.js';
import type { IBitcoinWalletProvider } from '../bitcoin/bitcoin.js';
import type { IEvmWalletProvider } from '../evm/evm.js';
import type { IIconWalletProvider } from '../icon/icon.js';
import type { IInjectiveWalletProvider } from '../injective/injective.js';
import type { INearWalletProvider } from '../near/near.js';
import type { ISolanaWalletProvider } from '../solana/solana.js';
import type { IStacksWalletProvider } from '../stacks/stacks.js';
import type { IStellarWalletProvider } from '../stellar/stellar.js';
import type { ISuiWalletProvider } from '../sui/sui.js';
import type { ITronWalletProvider } from '../tron/tron.js';
import type { IXrpWalletProvider } from '../xrp/xrp.js';
import type { ITonWalletProvider } from '../ton/ton.js';
import type { IZcashWalletProvider } from '../zcash/zcash.js';
import type { ICardanoWalletProvider } from '../cardano/cardano.js';

/** Discriminated by `chainType`, e.g. `if (w.chainType === 'EVM')` refines `w` to {@link IEvmWalletProvider}. */
export type IWalletProvider =
  | IEvmWalletProvider
  | IInjectiveWalletProvider
  | IStellarWalletProvider
  | ISuiWalletProvider
  | IIconWalletProvider
  | IBitcoinWalletProvider
  | ISolanaWalletProvider
  | IStacksWalletProvider
  | INearWalletProvider
  | ITronWalletProvider
  | IXrpWalletProvider
  | ITonWalletProvider
  | IZcashWalletProvider
  | ICardanoWalletProvider;

/** For the full {@link SpokeChainKey} union, `GetChainType<C>` distributes and the result reduces to {@link IWalletProvider}. */
export type GetWalletProviderType<C extends SpokeChainKey | ChainType> =
  GetChainType<C> extends 'EVM'
    ? IEvmWalletProvider
    : GetChainType<C> extends 'SOLANA'
      ? ISolanaWalletProvider
      : GetChainType<C> extends 'STELLAR'
        ? IStellarWalletProvider
        : GetChainType<C> extends 'ICON'
          ? IIconWalletProvider
          : GetChainType<C> extends 'SUI'
            ? ISuiWalletProvider
            : GetChainType<C> extends 'INJECTIVE'
              ? IInjectiveWalletProvider
              : GetChainType<C> extends 'STACKS'
                ? IStacksWalletProvider
                : GetChainType<C> extends 'NEAR'
                  ? INearWalletProvider
                  : GetChainType<C> extends 'BITCOIN'
                    ? IBitcoinWalletProvider
                    : GetChainType<C> extends 'TRON'
                      ? ITronWalletProvider
                      : GetChainType<C> extends 'XRP'
                        ? IXrpWalletProvider
                        : GetChainType<C> extends 'TON'
                          ? ITonWalletProvider
                          : GetChainType<C> extends 'ZCASH'
                            ? IZcashWalletProvider
                            : GetChainType<C> extends 'CARDANO'
                              ? ICardanoWalletProvider
                              : IWalletProvider;
