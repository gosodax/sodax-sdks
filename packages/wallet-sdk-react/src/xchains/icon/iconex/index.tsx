const ICONEX_RELAY_RESPONSE = 'ICONEX_RELAY_RESPONSE';
const ICONEX_RELAY_REQUEST = 'ICONEX_RELAY_REQUEST';

export enum ICONexRequestEventType {
  REQUEST_HAS_ACCOUNT = 'REQUEST_HAS_ACCOUNT',
  REQUEST_HAS_ADDRESS = 'REQUEST_HAS_ADDRESS',
  REQUEST_ADDRESS = 'REQUEST_ADDRESS',
  REQUEST_JSON = 'REQUEST_JSON',
  REQUEST_SIGNING = 'REQUEST_SIGNING',
}

export enum ICONexResponseEventType {
  RESPONSE_HAS_ACCOUNT = 'RESPONSE_HAS_ACCOUNT',
  RESPONSE_HAS_ADDRESS = 'RESPONSE_HAS_ADDRESS',
  RESPONSE_ADDRESS = 'RESPONSE_ADDRESS',
  RESPONSE_JSON = 'RESPONSE_JSON',
  RESPONSE_SIGNING = 'RESPONSE_SIGNING',
}

export interface ICONexRequestEvent {
  type: ICONexRequestEventType;
  // Request payload varies by event type (JSON-RPC params, signing data, etc).
  // `unknown` forces callers to validate before using — safer than `any`.
  payload?: unknown;
}

export interface ICONexResponseEvent {
  type: ICONexResponseEventType;
  // Response payload is always a string: wallet address, tx hash, or signature.
  payload?: string;
}

export type ICONexEvent = ICONexRequestEvent | ICONexResponseEvent;

// A dismissed prompt sends nothing back (the relay defines cancel events for SIGNING/JSON-RPC
// only), so this bound is the only thing that frees the channel for the next request.
export const ICONEX_REQUEST_TIMEOUT_MS = 60_000;
// Non-interactive hydration must not hold the FIFO queue for the full interactive timeout.
export const ICONEX_HYDRATION_TIMEOUT_MS = 30_000;

const EXPECTED_RESPONSE: Record<ICONexRequestEventType, ICONexResponseEventType> = {
  [ICONexRequestEventType.REQUEST_HAS_ACCOUNT]: ICONexResponseEventType.RESPONSE_HAS_ACCOUNT,
  [ICONexRequestEventType.REQUEST_HAS_ADDRESS]: ICONexResponseEventType.RESPONSE_HAS_ADDRESS,
  [ICONexRequestEventType.REQUEST_ADDRESS]: ICONexResponseEventType.RESPONSE_ADDRESS,
  [ICONexRequestEventType.REQUEST_JSON]: ICONexResponseEventType.RESPONSE_JSON,
  [ICONexRequestEventType.REQUEST_SIGNING]: ICONexResponseEventType.RESPONSE_SIGNING,
};

// The ICONEX relay is one shared window-event channel with no per-request id.
// Serialize so at most one request is in flight (a response can't resolve another
// request's promise), correlate by expected response type, time out, and always
// remove the listener on settle. (Security audit WALLET-L-1.)
// Residual: a late response to a timed-out request can satisfy the NEXT same-type request —
// benign for REQUEST_ADDRESS (payload is the wallet's own address) and unfixable without ids.
let iconexQueue: Promise<unknown> = Promise.resolve();

export const request = (
  event: ICONexRequestEvent,
  timeoutMs: number = ICONEX_REQUEST_TIMEOUT_MS,
): Promise<ICONexResponseEvent> => {
  const run = (): Promise<ICONexResponseEvent> =>
    new Promise<ICONexResponseEvent>((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('ICONEX relay requests require a browser environment'));
        return;
      }
      const expected = EXPECTED_RESPONSE[event.type];
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const settle = (apply: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener(ICONEX_RELAY_RESPONSE, handler);
        apply();
      };
      const handler = (evt: Event) => {
        const detail = (evt as CustomEvent<ICONexResponseEvent>).detail;
        if (detail?.type !== expected) return; // ignore uncorrelated responses
        settle(() => resolve(detail));
      };
      timer = setTimeout(() => settle(() => reject(new Error('ICONEX relay request timed out'))), timeoutMs);
      window.addEventListener(ICONEX_RELAY_RESPONSE, handler);
      window.dispatchEvent(new CustomEvent(ICONEX_RELAY_REQUEST, { detail: event }));
    });

  const result = iconexQueue.then(run);
  iconexQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};
