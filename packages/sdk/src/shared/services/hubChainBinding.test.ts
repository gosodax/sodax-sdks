/**
 * Chain binding for the hub-scoped static services (audit gh-741, EVM chain binding).
 *
 * Permit2Service and Erc4626Service are re-exported from `shared/services/index.ts`, so their
 * signed sends are public entry points. Both target hub contracts, but a wallet broadcasts on ITS
 * active chain — so every send must carry `expectedChainId` or an unlimited Permit2 allowance /
 * vault call lands on whatever sits at that address on the chain the wallet drifted to.
 *
 * Table-driven on purpose: a new signed method added without the binding fails here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hash } from 'viem';
import { ChainKeys } from '@sodax/types';
import { getEvmViemChain } from '../utils/constant-utils.js';
import { Permit2Service } from './Permit2Service.js';
import { Erc4626Service } from './Erc4626Service.js';
import { mockEvmWalletProvider } from '../../test-utils/walletProviders.js';

const HUB_CHAIN_ID = getEvmViemChain(ChainKeys.SONIC_MAINNET).id;

const SENDER: Address = '0x4444444444444444444444444444444444444444';
const PERMIT2: Address = '0x1111111111111111111111111111111111111111';
const VAULT: Address = '0x2222222222222222222222222222222222222222';
const TOKEN: Address = '0x3333333333333333333333333333333333333333';
const SPENDER: Address = '0x5555555555555555555555555555555555555555';
const TX_HASH: Hash = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

const SIGNATURE = `0x${'ab'.repeat(65)}` as const;
const PERMIT_DETAILS = { token: TOKEN, amount: 1n, expiration: 1, nonce: 0 };
const PERMIT_SINGLE = { details: PERMIT_DETAILS, spender: SPENDER, sigDeadline: 1n };

const mockWalletProvider = mockEvmWalletProvider();

// Every signed send in the two hub-scoped services, invoked with `raw` left at its default.
const SENDS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['Permit2Service.approve', () => Permit2Service.approve(SENDER, PERMIT2, TOKEN, SPENDER, 1n, 1, mockWalletProvider)],
  [
    'Permit2Service.permit',
    () => Permit2Service.permit(SENDER, PERMIT2, SENDER, PERMIT_SINGLE, SIGNATURE, mockWalletProvider),
  ],
  [
    'Permit2Service.permitBatch',
    () =>
      Permit2Service.permitBatch(
        SENDER,
        PERMIT2,
        SENDER,
        { details: [PERMIT_DETAILS], spender: SPENDER, sigDeadline: 1n },
        SIGNATURE,
        mockWalletProvider,
      ),
  ],
  [
    'Permit2Service.transferFrom',
    () => Permit2Service.transferFrom(SENDER, PERMIT2, SENDER, SPENDER, 1n, TOKEN, mockWalletProvider),
  ],
  [
    'Permit2Service.transferFromBatch',
    () =>
      Permit2Service.transferFromBatch(
        SENDER,
        PERMIT2,
        [{ from: SENDER, to: SPENDER, amount: 1n, token: TOKEN }],
        mockWalletProvider,
      ),
  ],
  [
    'Permit2Service.lockdown',
    () => Permit2Service.lockdown(SENDER, PERMIT2, [{ token: TOKEN, spender: SPENDER }], mockWalletProvider),
  ],
  [
    'Permit2Service.invalidateNonces',
    () => Permit2Service.invalidateNonces(SENDER, PERMIT2, TOKEN, SPENDER, 1, mockWalletProvider),
  ],
  ['Erc4626Service.deposit', () => Erc4626Service.deposit(VAULT, 1n, SENDER, mockWalletProvider)],
  ['Erc4626Service.mint', () => Erc4626Service.mint(VAULT, 1n, SENDER, mockWalletProvider)],
  ['Erc4626Service.withdraw', () => Erc4626Service.withdraw(VAULT, 1n, SENDER, SENDER, mockWalletProvider)],
  ['Erc4626Service.redeem', () => Erc4626Service.redeem(VAULT, 1n, SENDER, SENDER, mockWalletProvider)],
];

describe('hub-scoped services bind every signed send to the hub chain', () => {
  beforeEach(() => {
    vi.mocked(mockWalletProvider.getWalletAddress).mockResolvedValue(SENDER);
    vi.mocked(mockWalletProvider.sendTransaction).mockResolvedValue(TX_HASH);
  });

  it('passes expectedChainId on all eleven signed entry points', async () => {
    expect(SENDS).toHaveLength(11);
    expect(HUB_CHAIN_ID).toBe(146);
    for (const [label, send] of SENDS) {
      vi.mocked(mockWalletProvider.sendTransaction).mockClear();

      await send();

      expect(mockWalletProvider.sendTransaction, label).toHaveBeenCalledWith(expect.anything(), {
        expectedChainId: HUB_CHAIN_ID,
      });
    }
  });
});

describe('raw mode still returns unsent calldata', () => {
  beforeEach(() => {
    vi.mocked(mockWalletProvider.getWalletAddress).mockResolvedValue(SENDER);
    vi.mocked(mockWalletProvider.sendTransaction).mockClear();
  });

  it('Permit2Service.approve and Erc4626Service.deposit with raw: true never reach the wallet', async () => {
    const approveTx = await Permit2Service.approve(SENDER, PERMIT2, TOKEN, SPENDER, 1n, 1, mockWalletProvider, true);
    expect(approveTx).toMatchObject({ from: SENDER, to: PERMIT2, value: 0n });

    const depositTx = await Erc4626Service.deposit(VAULT, 1n, SENDER, mockWalletProvider, true);
    expect(depositTx).toMatchObject({ from: SENDER, to: VAULT, value: 0n });

    expect(mockWalletProvider.sendTransaction).not.toHaveBeenCalled();
  });
});
