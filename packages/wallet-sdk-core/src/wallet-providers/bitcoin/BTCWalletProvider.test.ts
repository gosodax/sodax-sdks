import { describe, it, expect, vi, beforeEach } from 'vitest';

const signAllInputs = vi.fn();
const finalizeAllInputs = vi.fn();
const extractTransactionToHex = vi.fn().mockReturnValue('extracted-tx-hex');
const extractTransaction = vi.fn().mockReturnValue({ toHex: extractTransactionToHex });
const psbtToBase64 = vi.fn().mockReturnValue('signed-psbt-base64');
const psbtFromBase64 = vi.fn().mockReturnValue({
  signAllInputs,
  finalizeAllInputs,
  extractTransaction,
  toBase64: psbtToBase64,
});

vi.mock('bitcoinjs-lib', () => ({
  initEccLib: vi.fn(),
  networks: {
    bitcoin: { messagePrefix: 'mainnet' },
    testnet: { messagePrefix: 'testnet' },
  },
  payments: {
    p2wpkh: vi.fn().mockReturnValue({ address: 'bc1abc' }),
    p2pkh: vi.fn().mockReturnValue({ address: '1abc' }),
    p2sh: vi.fn().mockReturnValue({ address: '3abc' }),
    p2tr: vi.fn().mockReturnValue({ address: 'bc1pabc' }),
  },
  Psbt: { fromBase64: psbtFromBase64, fromHex: vi.fn() },
  crypto: { taggedHash: vi.fn() },
}));

vi.mock('@bitcoinerlab/secp256k1', () => ({}));

vi.mock('ecpair', () => ({
  ECPairFactory: () => ({
    fromPrivateKey: vi.fn().mockReturnValue({
      publicKey: Buffer.from(new Uint8Array(33)),
      privateKey: Buffer.from(new Uint8Array(32)),
    }),
  }),
}));

vi.mock('viem', () => ({ keccak256: vi.fn() }));
vi.mock('secp256k1', () => ({ default: { ecdsaSign: vi.fn() } }));
vi.mock('bip322-js', () => ({ Signer: { sign: vi.fn() } }));

vi.mock('@sodax/types', async () => {
  const actual = await vi.importActual<typeof import('@sodax/types')>('@sodax/types');
  return { ...actual, detectBitcoinAddressType: vi.fn().mockReturnValue('P2WPKH') };
});

const { BitcoinWalletProvider } = await import('./BTCWalletProvider.js');

describe('BitcoinWalletProvider', () => {
  const PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const;
  const PSBT_BASE64 = 'cHNidP8AAA==';

  function makeProvider(defaults?: { defaultFinalize?: boolean }) {
    return new BitcoinWalletProvider({
      type: 'PRIVATE_KEY',
      privateKey: PRIVATE_KEY,
      network: 'MAINNET',
      defaults,
    });
  }

  it('initializes with browser-extension config', () => {
    // biome-ignore lint/suspicious/noExplicitAny: mocked walletsKit
    const walletsKit: any = { getAccounts: vi.fn(), signPsbt: vi.fn() };
    const provider = new BitcoinWalletProvider({
      type: 'BROWSER_EXTENSION',
      walletsKit,
      network: 'MAINNET',
    });
    expect(provider.chainType).toBe('BITCOIN');
  });

  describe('signTransaction — finalize merge', () => {
    beforeEach(() => {
      signAllInputs.mockReset();
      finalizeAllInputs.mockReset();
      extractTransaction.mockClear();
      extractTransactionToHex.mockClear();
      psbtToBase64.mockClear();
    });

    it('finalizes and extracts the tx hex by default, or when finalize=true overrides defaults.defaultFinalize=false', async () => {
      expect(await makeProvider().signTransaction(PSBT_BASE64)).toBe('extracted-tx-hex');
      expect(await makeProvider({ defaultFinalize: false }).signTransaction(PSBT_BASE64, true)).toBe(
        'extracted-tx-hex',
      );

      expect(finalizeAllInputs).toHaveBeenCalledTimes(2);
      expect(extractTransaction).toHaveBeenCalledTimes(2);
      expect(psbtToBase64).not.toHaveBeenCalled();
    });

    it('returns the base64 PSBT unfinalized when defaults.defaultFinalize=false, or finalize=false overrides true', async () => {
      expect(await makeProvider({ defaultFinalize: false }).signTransaction(PSBT_BASE64)).toBe('signed-psbt-base64');
      expect(await makeProvider({ defaultFinalize: true }).signTransaction(PSBT_BASE64, false)).toBe(
        'signed-psbt-base64',
      );

      expect(finalizeAllInputs).not.toHaveBeenCalled();
      expect(extractTransaction).not.toHaveBeenCalled();
      expect(psbtToBase64).toHaveBeenCalledTimes(2);
    });
  });
});
