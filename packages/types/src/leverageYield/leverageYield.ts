import type { Address } from '../shared/shared.js';
import { LsodaTokens, SodaTokens } from '../chains/tokens.js';
import type { PartnerFee, Prettify } from '../common/common.js';

/** ERC-4626 hub vault that loops `asset` collateral against `borrowToken` debt (a leveraged long on their peg).
 * For discovery and UI only; routing resolves hub tokens from the spoke token via `ConfigService`. */
export type LeverageYieldVault = {
  /** By convention the lsoda* share-token symbol (e.g. `'lsodaWEETH'`); key for `LeverageYieldService.getVault`. */
  name: string;
  /** Proxy address on the Sonic hub. */
  vault: Address;
  /** Always a Sodax vault-token wrapper (e.g. sodaWEETH): deposits are bridged in and wrapped before depositing. */
  asset: Address;
  /** Always a Sodax vault-token wrapper (e.g. sodaETH), borrowed from the Sodax-forked AAVE pool. */
  borrowToken: Address;
  /** Enables `getEffectiveApr` to add LSD staking yield to AAVE rates; omit for non-LSD vaults (yield treated as 0%). */
  lsdSource?: LeverageYieldLsdSource;
};

/** LSD staking yield is absent from AAVE's `currentLiquidityRate`, so it is fetched from DefiLlama
 * (`https://yields.llama.fi/chart/<poolId>`). Pure data so the registry stays serialisable. */
export type LeverageYieldLsdSource = {
  /** DefiLlama pool ID (UUID); find it via the bulk `/pools` endpoint. */
  poolId: string;
  /** APR as a percentage (`3.2` = 3.2%), used when the fetch errors. Track the issuer's trailing 30-day yield;
   * update if it drifts >50 bp. */
  fallbackAprPct: number;
  label: string;
};

/** Default vaults; override per instance via `Sodax({ leverageYield: { vaults } })`. Addresses come from
 * {@link LsodaTokens} / {@link SodaTokens} so a redeploy changes one place. */
export const leverageYieldVaults = [
  {
    name: LsodaTokens.lsodaWEETH.symbol,
    vault: LsodaTokens.lsodaWEETH.vault,
    asset: SodaTokens.sodaWEETH.address,
    borrowToken: SodaTokens.sodaETH.address,
    lsdSource: {
      // EtherFi weETH on Ethereum (project: 'ether.fi-stake').
      poolId: '46bd2bdf-6d92-4066-b482-e885ee172264',
      fallbackAprPct: 3.0,
      label: 'EtherFi (weETH)',
    },
  },
  {
    name: LsodaTokens.lsodaWSTETH.symbol,
    vault: LsodaTokens.lsodaWSTETH.vault,
    asset: SodaTokens.sodaWSTETH.address,
    borrowToken: SodaTokens.sodaETH.address,
    lsdSource: {
      // Lido stETH on Ethereum; wstETH inherits this rate via redeem.
      poolId: '747c1d2a-c668-4682-b9f9-296708a3dd90',
      fallbackAprPct: 2.4,
      label: 'Lido (stETH)',
    },
  },
  {
    name: LsodaTokens.lsodaJITOSOL.symbol,
    vault: LsodaTokens.lsodaJITOSOL.vault,
    asset: SodaTokens.sodaJITOSOL.address,
    borrowToken: SodaTokens.sodaSOL.address,
    lsdSource: {
      // Jito JitoSOL on Solana (project: 'jito-liquid-staking').
      poolId: '0e7d0722-9054-4907-8593-567b353c0900',
      fallbackAprPct: 5.5,
      label: 'Jito (JitoSOL)',
    },
  },
  {
    name: LsodaTokens.lsodaSUSDS.symbol,
    vault: LsodaTokens.lsodaSUSDS.vault,
    asset: SodaTokens.sodaSUSDS.address, // eMode-3 collateral
    borrowToken: SodaTokens.sodaUSSD.address, // eMode-3 borrowable
    lsdSource: {
      // Sky Savings Rate on sUSDS (project: 'sky-lending', Ethereum).
      poolId: 'd8c4eff5-c8a9-46fc-a888-057c4c668e72',
      fallbackAprPct: 3.5,
      label: 'Sky (sUSDS)',
    },
  },
] as const satisfies readonly LeverageYieldVault[];

/** `kind` mirrors the contract's `PendingKind`: 0 none, 1 leverage, 2 deleverage, 3 debt-side open. */
export type LeveragePositionPendingState = {
  kind: number;
  /** Intent still registered on `Intents`; no second operation is permitted. */
  isLive: boolean;
  /** Operation recorded but its intent is gone, so an open grant/debt-side contribution remains.
   * Cleared by `buildSettlePosition`, which anyone may call. */
  needsSettle: boolean;
};

/** Unpooled `LeveragePositionFactory` clone: its own AAVE account, so one owner can hold several eMode tiers.
 * No registry; discover via `LeverageYieldService.listPositions(owner)`. */
export type LeveragePosition = {
  address: Address;
  /** Address permitted to operate the position — a hub EOA, the solver, or a hub Wallet. */
  owner: Address;
  /** Sodax vault token (e.g. sodaSUSDS). */
  collateral: Address;
  /** Sodax vault token (e.g. sodaUSSD). */
  borrowToken: Address;
  /** Fixed at creation; `0` means no eMode. */
  eModeCategory: number;
  /** Basis points, fixed at creation (read from the position, not config). Borrowed on top of the solver payment,
   * so adjust/exit projections must charge it. */
  feeBps: number;
  /** Zero address when no fee is charged. */
  feeReceiver: Address;
};

/** Read from the AAVE pool (the position holds no accounting). `*Base` figures are oracle base units, 8 decimals. */
export type LeveragePositionAccount = {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  /** Basis points, reflecting the position's eMode category. */
  currentLiquidationThreshold: bigint;
  /** Basis points. */
  ltv: bigint;
  /** WAD (1e18); below 1e18 the position is liquidatable. */
  healthFactor: bigint;
};

/** Exact aToken holding; use it, not the price-converted `totalCollateralBase`, to size a full exit. */
export type LeveragePositionCollateral = {
  aToken: Address;
  /** In the collateral reserve's own decimals. */
  balance: bigint;
};

export type LeverageYieldOptions = {
  partnerFee?: PartnerFee;
  /** Only for a different deployment (fork, staging); `undefined` keeps the default since config merging skips it. */
  positionFactory?: Address;
  /** Default `true`: `vaultSwap()` goes through backend submit-tx; `false` forces the client-side relay.
   * Client-side only; effective value is `sodax.config.leverageYieldUseBackendSubmitTx`. */
  useBackendSubmitTx?: boolean;
};

export type LeverageYieldConfig = Prettify<LeverageYieldDefaultConfig & LeverageYieldOptions>;

export type LeverageYieldDefaultConfig = {
  vaults: readonly LeverageYieldVault[];
  /** Defaulted because position methods fail closed without a factory. */
  positionFactory: Address;
};

export const leverageYieldConfig = {
  vaults: leverageYieldVaults,
  positionFactory: '0xF8fB7F200B6545295e1729Cf254482d7c116031C',
} as const satisfies LeverageYieldDefaultConfig;
