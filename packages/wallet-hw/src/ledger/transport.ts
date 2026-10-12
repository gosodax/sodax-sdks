import type Transport from '@ledgerhq/hw-transport';
import Eth from '@ledgerhq/hw-app-eth';
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import TransportWebUSB from '@ledgerhq/hw-transport-webusb';

/**
 * USB transport used to talk to the device. WebHID is the primary, most reliable
 * path; WebUSB is a fallback (it can conflict with Ledger Live's USB claim). Both
 * are Chromium-desktop only and require a user gesture over HTTPS.
 */
export type LedgerTransportKind = 'webhid' | 'webusb';

/**
 * Opens a Ledger USB transport. Device SDKs are kept `external` from the add-on
 * bundle (see tsup config), so they only enter a host app's graph when the Ledger
 * entry is imported.
 *
 * Must be called from a user gesture (click) — the browser permission prompt for
 * WebHID/WebUSB will otherwise reject.
 */
export async function createLedgerTransport(kind: LedgerTransportKind): Promise<Transport> {
  try {
    return kind === 'webusb' ? await TransportWebUSB.create() : await TransportWebHID.create();
  } catch (error) {
    throw toFriendlyTransportError(error, kind);
  }
}

/** Builds the Ethereum app client on top of an open transport. */
export function getEthApp(transport: Transport): Eth {
  return new Eth(transport);
}

function toFriendlyTransportError(error: unknown, kind: LedgerTransportKind): Error {
  const message = error instanceof Error ? error.message : String(error);
  // No device chosen in the browser picker, or none connected.
  if (/no device selected|access denied|cannot open device|no.*device/i.test(message)) {
    return new Error(
      `[wallet-hw] Could not connect to a Ledger device over ${kind.toUpperCase()}. Plug in and unlock your Ledger, then approve the browser prompt.`,
    );
  }
  return error instanceof Error ? error : new Error(message);
}
