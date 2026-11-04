import type { Address } from '../shared/shared.js';
import { LsodaTokens, SodaTokens } from '../chains/tokens.js';
import type { PartnerFee, Prettify } from '../common/common.js';

/**
 * A single deployed LeverageYieldVault.
 *
 * The vault is an ERC-4626 wrapper on the Sonic hub. It accepts deposits of `asset` (a
 * Sodax vault token like sodaWEETH), borrows `borrowToken` from the Sodax-forked AAVE
 * pool, swaps the borrowed amount back into the asset, and re-supplies — yielding a
 * leveraged long on the asset / borrowToken peg.
 *
 * The fields here are static descriptors of the deployed vault. Cross-chain deposits and
 * withdrawals route by the user's spoke-side token (e.g. weETH on Arbitrum); the hub-side
 * AssetToken and Sodax vault token are resolved at call time by `ConfigService`. This
 * registry exists for vault discovery and UI display, not for routing.
 */
export type LeverageYieldVault = {
  /**
   * Stable lookup key — by convention the leverage-vault share-token symbol
   * (e.g. `'lsodaWEETH'`, `'lsodaWSTETH'`). Used by `LeverageYieldService.getVault(name)`.
   */
  name: string;
  /** Deployed `LeverageYieldVault` proxy address on the Sonic hub. */
  vault: Address;
  /**
   * The vault's underlying asset on the hub — the ERC-20 a depositor effectively holds via
   * vault shares. Always a Sodax vault-token wrapper (e.g. sodaWEETH), since user deposits
   * are bridged in as the underlying hub asset and wrapped before the leverage vault deposit.
   */
  asset: Address;
  /**
   * The token the vault borrows from the Sodax-forked AAVE pool against `asset` collateral.
   * Always a Sodax vault-token wrapper (e.g. sodaETH), matching the asset side. Drives the
   * leverage direction: the position is a long on the `asset` / `borrowToken` peg.
   */
  borrowToken: Address;
  /**
   * LSD staking-APR source for the underlying asset. When present, callers can use
   * `LeverageYieldService.getEffectiveApr(vault)` to combine AAVE rates with the LSD's
   * native staking yield — the primary yield source for LSD-backed strategies. Omit for
   * non-LSD vaults; the SDK then treats the LSD yield as 0%.
   */
  lsdSource?: LeverageYieldLsdSource;
};

/**
 * Off-chain LSD staking-APR source for a leverage-yield vault. The vault's underlying asset
 * is an LSD (weETH, wstETH, …) that appreciates against its base asset (ETH) at the LSD's
 * native staking rate — yield that does **not** appear in AAVE's `currentLiquidityRate` and
 * that the SDK must therefore fetch off-chain to report an honest effective APR.
 *
 * The SDK fetches all LSD APRs from DefiLlama's per-pool endpoint
 * (`https://yields.llama.fi/chart/<poolId>`) — one CORS-friendly source that already
 * aggregates rates across LSD issuers, so no provider-specific dispatch is needed in the
 * service. Pure data — no functions — so the registry stays serialisable.
 */
export type LeverageYieldLsdSource = {
  /**
   * DefiLlama pool ID (UUID) for the LSD's staking pool. Find via the bulk `/pools`
   * endpoint, e.g. `data.filter(p => p.symbol === 'STETH' && p.project === 'lido')`.
   * Examples:
   *  - Lido stETH:   `747c1d2a-c668-4682-b9f9-296708a3dd90`
   *  - EtherFi weETH: `46bd2bdf-6d92-4066-b482-e885ee172264`
   */
  poolId: string;
  /**
   * Hardcoded APR (percentage, e.g. `3.2` for 3.2%) used when the DefiLlama fetch errors.
   * Should reflect the trailing 30-day yield from the issuer's dashboard; update via PR if
   * it drifts >50 bp from reality.
   */
  fallbackAprPct: number;
  /** Human label for UI display, e.g. `'Lido (stETH)'` or `'EtherFi (weETH)'`. */
  label: string;
};

/**
 * SDK-wide registry of known leverage vaults. Add an entry here when a vault is promoted
 * to a default; callers can also override per-instance via the `Sodax({ leverageYield:
 * { vaults: [...] } })` config slot.
 *
 * Addresses are sourced from the canonical token registries — the proxy/share-token address
 * from {@link LsodaTokens} and the hub-side `asset` / `borrowToken` from {@link SodaTokens} —
 * so a deployment-address change lives in exactly one place.
 */
export const leverageYieldVaults = [
  {
    name: LsodaTokens.lsodaWEETH.symbol,
    vault: LsodaTokens.lsodaWEETH.vault,
    asset: SodaTokens.sodaWEETH.address, // sodaWEETH on Sonic
    borrowToken: SodaTokens.sodaETH.address, // sodaETH on Sonic
    lsdSource: {
      // DefiLlama pool for EtherFi's weETH on Ethereum (project: 'ether.fi-stake').
      poolId: '46bd2bdf-6d92-4066-b482-e885ee172264',
      fallbackAprPct: 3.0,
      label: 'EtherFi (weETH)',
    },
  },
  {
    name: LsodaTokens.lsodaWSTETH.symbol,
    vault: LsodaTokens.lsodaWSTETH.vault,
    asset: SodaTokens.sodaWSTETH.address, // sodaWSTETH on Sonic
    borrowToken: SodaTokens.sodaETH.address, // sodaETH on Sonic
    lsdSource: {
      // DefiLlama pool for Lido's stETH on Ethereum (wstETH inherits this rate via redeem).
      poolId: '747c1d2a-c668-4682-b9f9-296708a3dd90',
      fallbackAprPct: 2.4,
      label: 'Lido (stETH)',
    },
  },
  {
    name: LsodaTokens.lsodaJITOSOL.symbol,
    vault: LsodaTokens.lsodaJITOSOL.vault,
    asset: SodaTokens.sodaJITOSOL.address, // sodaJITOSOL on Sonic
    borrowToken: SodaTokens.sodaSOL.address, // sodaSOL on Sonic
    lsdSource: {
      // DefiLlama pool for Jito's JitoSOL native staking on Solana (project: 'jito-liquid-staking').
      poolId: '0e7d0722-9054-4907-8593-567b353c0900',
      fallbackAprPct: 5.5,
      label: 'Jito (JitoSOL)',
    },
  },
  {
    name: LsodaTokens.lsodaSUSDS.symbol,
    vault: LsodaTokens.lsodaSUSDS.vault,
    asset: SodaTokens.sodaSUSDS.address, // sodaSUSDS (sUSDS) on Sonic — eMode-3 collateral
    borrowToken: SodaTokens.sodaUSSD.address, // sodaUSSD (USSD) on Sonic — eMode-3 borrowable
    lsdSource: {
      // DefiLlama pool for the Sky Savings Rate on sUSDS (project: 'sky-lending', Ethereum).
      // sUSDS appreciates against USDS at the SSR — yield AAVE's currentLiquidityRate omits.
      poolId: 'd8c4eff5-c8a9-46fc-a888-057c4c668e72',
      fallbackAprPct: 3.5,
      label: 'Sky (sUSDS)',
    },
  },
] as const satisfies readonly LeverageYieldVault[];

/**
 * A leverage position's operation slot.
 *
 * `kind` mirrors the contract's `PendingKind`: 0 none, 1 leverage, 2 deleverage, 3 debt-side open.
 * The pair matters because they can disagree — see `needsSettle`.
 */
export type LeveragePositionPendingState = {
  kind: number;
  /** The intent is still registered on `Intents`, so no second operation is permitted. */
  isLive: boolean;
  /**
   * An operation is recorded but its intent is gone, so the position still holds an open grant and
   * any debt-side contribution. Cleared by `buildSettlePosition`, which anyone may call.
   */
  needsSettle: boolean;
};

/**
 * Static descriptor of a single leverage position — one owner-controlled AAVE account
 * deployed as a clone by `LeveragePositionFactory`.
 *
 * Positions are the unpooled counterpart to {@link LeverageYieldVault}: instead of many
 * depositors sharing one ERC-4626 vault at a single target LTV, each position is its own
 * AAVE account with its own eMode category, health factor and liquidation risk. That is
 * what lets one owner hold several positions at different leverage tiers at once, which a
 * pooled vault cannot express because AAVE allows one eMode category per address.
 *
 * Unlike vaults there is no registry of these: positions are created per user at runtime
 * and discovered through `LeverageYieldService.listPositions(owner)`.
 */
export type LeveragePosition = {
  /** Deployed `LeveragePosition` clone address on the Sonic hub. */
  address: Address;
  /** Address permitted to operate the position — a hub EOA, the solver, or a hub Wallet. */
  owner: Address;
  /** Hub-side collateral supplied to AAVE, a Sodax vault token (e.g. sodaSUSDS). */
  collateral: Address;
  /** Hub-side asset borrowed against the collateral, a Sodax vault token (e.g. sodaUSSD). */
  borrowToken: Address;
  /** AAVE eMode category, fixed at creation. `0` means no eMode. */
  eModeCategory: number;
  /**
   * The position's own partner fee in basis points, FIXED AT CREATION.
   *
   * Read from the position, not from config: config can change and an open can pass a per-call
   * override, so what a new position would carry is not what this one does. The fee is borrowed on
   * top of what the solver is paid, so any projection of an adjust or exit has to charge it.
   */
  feeBps: number;
  /** Who that fee is paid to. Zero address when none is charged. */
  feeReceiver: Address;
};

/**
 * Live AAVE account snapshot for a leverage position. Read from the pool rather than the
 * position contract, which holds no accounting of its own.
 *
 * All base-currency figures use the pool's oracle base unit (8 decimals on the Sodax fork).
 */
export type LeveragePositionAccount = {
  /** Total collateral in the pool's base currency. */
  totalCollateralBase: bigint;
  /** Total debt in the pool's base currency. */
  totalDebtBase: bigint;
  /** Remaining borrowing power in the pool's base currency. */
  availableBorrowsBase: bigint;
  /** Liquidation threshold in basis points, reflecting the position's eMode category. */
  currentLiquidationThreshold: bigint;
  /** Current loan-to-value in basis points. */
  ltv: bigint;
  /** Health factor in WAD (1e18). Below 1e18 the position is liquidatable. */
  healthFactor: bigint;
};

/**
 * A position's collateral holding, read straight off the aToken.
 *
 * The counterpart to {@link LeveragePositionAccount}'s `totalCollateralBase`, which is an oracle
 * base-currency figure at 8 decimals — right for display, useless for sizing a full exit, because
 * converting it back through a price lands near the balance rather than on it.
 */
export type LeveragePositionCollateral = {
  /** The reserve's aToken. Holding this *is* the collateral position. */
  aToken: Address;
  /** Exact aToken balance, in the collateral reserve's own decimals. */
  balance: bigint;
};

// options for the leverage yield service to be configured by the integrator
export type LeverageYieldOptions = {
  partnerFee?: PartnerFee; // enables override of global partner fee
  /**
   * Overrides the deployed `LeveragePositionFactory` in {@link leverageYieldConfig}.
   *
   * Only needed to point at a different deployment — a fork, a staging factory, or a new
   * one before the default catches up. Omitting it (or passing `undefined`) keeps the
   * default: config merging skips `undefined`, so an absent override cannot blank it.
   */
  positionFactory?: Address;
  /**
   * Route `vaultSwap()` (and so `deposit`/`withdraw`) through the backend submit-tx flow. Default
   * `true`, like the swaps/bridge toggles — omitting it leaves the backend path ON. Set `false` to
   * opt out and force the fully client-side relay. Client-side only — not part of backend
   * SodaxDefaultConfig. Read the effective value via `sodax.config.leverageYieldUseBackendSubmitTx`.
   */
  useBackendSubmitTx?: boolean;
};

export type LeverageYieldConfig = Prettify<LeverageYieldDefaultConfig & LeverageYieldOptions>;

export type LeverageYieldDefaultConfig = {
  vaults: readonly LeverageYieldVault[];
  /**
   * Deployed `LeveragePositionFactory` on the Sonic hub.
   *
   * Defaulted so the position methods work out of the box: they fail closed on a missing
   * factory rather than guessing an address, which previously meant every integrator had
   * to supply this before a single position call would run.
   */
  positionFactory: Address;
};

export const leverageYieldConfig = {
  vaults: leverageYieldVaults,
  positionFactory: '0xF8fB7F200B6545295e1729Cf254482d7c116031C',
} as const satisfies LeverageYieldDefaultConfig;
