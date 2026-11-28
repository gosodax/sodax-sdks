// Test-only wallet-provider doubles: every required member is a typed `vi.fn`, so no cast is needed.
import type {
  IBitcoinWalletProvider,
  IEvmWalletProvider,
  ISolanaWalletProvider,
  IStellarWalletProvider,
} from '@sodax/types';
import { vi } from 'vitest';

export const mockEvmWalletProvider = (overrides: Partial<IEvmWalletProvider> = {}): IEvmWalletProvider => ({
  chainType: 'EVM',
  getWalletAddress: vi.fn<IEvmWalletProvider['getWalletAddress']>(),
  sendTransaction: vi.fn<IEvmWalletProvider['sendTransaction']>(),
  waitForTransactionReceipt: vi.fn<IEvmWalletProvider['waitForTransactionReceipt']>(),
  ...overrides,
});

export const mockSolanaWalletProvider = (overrides: Partial<ISolanaWalletProvider> = {}): ISolanaWalletProvider => ({
  chainType: 'SOLANA',
  getWalletAddress: vi.fn<ISolanaWalletProvider['getWalletAddress']>(),
  sendTransaction: vi.fn<ISolanaWalletProvider['sendTransaction']>(),
  waitForConfirmation: vi.fn<ISolanaWalletProvider['waitForConfirmation']>(),
  buildV0Txn: vi.fn<ISolanaWalletProvider['buildV0Txn']>(),
  getWalletBase58PublicKey: vi.fn<ISolanaWalletProvider['getWalletBase58PublicKey']>(),
  getAssociatedTokenAddress: vi.fn<ISolanaWalletProvider['getAssociatedTokenAddress']>(),
  getBalance: vi.fn<ISolanaWalletProvider['getBalance']>(),
  getTokenAccountBalance: vi.fn<ISolanaWalletProvider['getTokenAccountBalance']>(),
  ...overrides,
});

export const mockStellarWalletProvider = (
  overrides: Partial<IStellarWalletProvider> = {},
): IStellarWalletProvider => ({
  chainType: 'STELLAR',
  getWalletAddress: vi.fn<IStellarWalletProvider['getWalletAddress']>(),
  signTransaction: vi.fn<IStellarWalletProvider['signTransaction']>(),
  waitForTransactionReceipt: vi.fn<IStellarWalletProvider['waitForTransactionReceipt']>(),
  ...overrides,
});

export const mockBitcoinWalletProvider = (
  overrides: Partial<IBitcoinWalletProvider> = {},
): IBitcoinWalletProvider => ({
  chainType: 'BITCOIN',
  getWalletAddress: vi.fn<IBitcoinWalletProvider['getWalletAddress']>(),
  signTransaction: vi.fn<IBitcoinWalletProvider['signTransaction']>(),
  signEcdsaMessage: vi.fn<IBitcoinWalletProvider['signEcdsaMessage']>(),
  signBip322Message: vi.fn<IBitcoinWalletProvider['signBip322Message']>(),
  sendBitcoin: vi.fn<IBitcoinWalletProvider['sendBitcoin']>(),
  ...overrides,
});
