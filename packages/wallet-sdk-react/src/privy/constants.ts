/** wagmi connector id of the Privy email wallet — also its `xConnectorId`. */
export const PRIVY_CONNECTOR_ID = 'privy';
export const PRIVY_CONNECTOR_NAME = 'Email (Privy)';
/** Oldest `@privy-io/react-auth` this integration is tested against; `privy()` skips older ones. */
export const MIN_PRIVY_VERSION = '3.40.0';

// Only non-interactive work is timed. A login modal on screen and pass-through signing requests never are:
// a user may be typing a one-time or MFA code.
/** The whole page-load restore; wagmi reconnects wallets in sequence, so others wait on this. */
export const RECONNECT_BUDGET_MS = 3_000;
/** Privy `ready` before opening the login modal. */
export const READY_CONNECT_MS = 15_000;
/** Privy's login modal appearing after `login()`, which returns without one while Privy still holds a user. */
export const LOGIN_OPEN_MS = 5_000;
/** The embedded wallet appearing after login or creation, and a `createWallet()` call. */
export const WALLET_MS = 30_000;
/** Each connector-internal call into Privy (provider, chain id, chain switch, logout). */
export const INTERNAL_CALL_MS = 10_000;
