import { ChainKeys } from '@sodax/sdk';
import type { IEvmWalletProvider, Sodax, SpokeChainKey } from '@sodax/sdk';
import { bySymbol } from './accept-any-token.js';

export type SupplyFromBaseParams = {
  sodax: Sodax;
  walletProvider: IEvmWalletProvider;
  userBaseAddress: `0x${string}`;
  symbol: string;
  amount: bigint;
};

/** Supplies collateral from Base, approving first only when the allowance is short. */
export async function supplyFromBase({ sodax, walletProvider, userBaseAddress, symbol, amount }: SupplyFromBaseParams) {
  const token = bySymbol(sodax.moneyMarket.getSupportedTokensByChainId(ChainKeys.BASE_MAINNET), symbol);
  const params = {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: userBaseAddress,
    token: token.address,
    amount,
    action: 'supply',
  } as const;

  const allowance = await sodax.moneyMarket.isAllowanceValid({ params });
  if (!allowance.ok) throw allowance.error;
  if (!allowance.value) {
    const approval = await sodax.moneyMarket.approve({ params, walletProvider });
    if (!approval.ok) throw approval.error;
  }

  const supplied = await sodax.moneyMarket.supply({ params, walletProvider, timeout: 120_000 });
  if (!supplied.ok) throw supplied.error;
  return supplied.value;
}

export type BorrowToNetworkParams = {
  sodax: Sodax;
  walletProvider: IEvmWalletProvider;
  userBaseAddress: `0x${string}`;
  dstChainKey: SpokeChainKey;
  dstAddress: string;
  symbol: string;
  amount: bigint;
};

/** Acts from Base and delivers the borrow on dstChainKey; the token comes from the destination list. */
export async function borrowToNetwork({
  sodax,
  walletProvider,
  userBaseAddress,
  dstChainKey,
  dstAddress,
  symbol,
  amount,
}: BorrowToNetworkParams) {
  const token = bySymbol(sodax.moneyMarket.getSupportedTokensByChainId(dstChainKey), symbol);
  const borrowed = await sodax.moneyMarket.borrow({
    params: {
      srcChainKey: ChainKeys.BASE_MAINNET,
      srcAddress: userBaseAddress,
      token: token.address,
      amount,
      action: 'borrow',
      dstChainKey,
      dstAddress,
    },
    walletProvider,
  });
  if (!borrowed.ok) throw borrowed.error;
  return borrowed.value;
}

/** Rates per reserve plus the user's totals and health factor, from on-chain reads only. */
export async function readPosition(sodax: Sodax, userBaseAddress: `0x${string}`) {
  const { data } = sodax.moneyMarket;
  const reserves = await data.getReservesHumanized();
  const userReserves = await data.getUserReservesHumanized(ChainKeys.BASE_MAINNET, userBaseAddress);
  const formattedReserves = data.formatReservesUSD(data.buildReserveDataWithPrice(reserves));
  const summary = data.formatUserSummary(data.buildUserSummaryRequest(reserves, formattedReserves, userReserves));
  return { formattedReserves, summary };
}
