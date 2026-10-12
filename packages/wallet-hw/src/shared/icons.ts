/**
 * Brand icons as `data:` URIs so connectors are self-describing in the wallet modal
 * (`XConnector.icon`) without the host app shipping any asset.
 */

/** Ledger mark — the corner-bracket motif on a dark rounded square. */
export const LEDGER_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23000'/%3E%3Cpath fill='%23fff' d='M9 9h6v2H11v4H9V9Zm14 0v6h-2v-4h-4V9h6ZM9 17h2v4h4v2H9v-6Zm12 0h2v6h-6v-2h4v-4Z'/%3E%3C/svg%3E";

/** Trezor mark — a "T" inside a rounded shield on the brand green. */
export const TREZOR_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2300854d'/%3E%3Cpath fill='%23fff' d='M16 6c-3 0-5 2-5 4.6V13H9v9l7 4 7-4v-9h-2v-2.4C21 8 19 6 16 6Zm-3 4.6C13 9.1 14.3 8 16 8s3 1.1 3 2.6V13h-6v-2.4ZM21 20.8l-5 2.9-5-2.9V15h10v5.8Z'/%3E%3C/svg%3E";
