/**
 * The two numbers more than one control on this page has to agree on.
 *
 * Deliberately short. Everything else here — `REPAY_OVERSHOOT`, `WITHDRAW_TARGET_HF`, `PROBE_USD`,
 * `MIN_ADJUSTMENT` — is used in exactly one file and carries the reasoning that justifies it right
 * beside the code, which moving it here would strand. A constants module earns its place by removing
 * a way for two copies to drift, not by collecting every literal.
 */

/**
 * Below this a position is empty enough to treat as closed rather than offering another leg, and a
 * leg rounds to nothing worth showing. In the pool oracle's base currency.
 *
 * Shared because the two readings must agree: the panel decides a row is closed on this and the
 * close control decides whether a repay leg is still needed on it, so a drift shows a row that
 * offers an action it has already declared unnecessary.
 */
export const DUST_BASE = 0.01;

/**
 * How far under the pool's own LTV ceiling to stop, so a borrow does not revert on rounding.
 *
 * Shared because it is the same promise in both directions: the ceiling the create slider offers and
 * the one the adjust slider offers have to be the same number, or opening at the maximum and then
 * adjusting to the maximum disagree about what the maximum is. It was previously named here and
 * written as a bare `0.98` in the create card, where a grep for the name did not find it.
 */
export const MAX_LEVERAGE_SAFETY = 0.98;
