import {
  ChainKeys,
  type CreateIntentParamsV2,
  type IntentResponseV2,
  type EvmRawTransaction,
  type ISuiWalletProvider,
} from '@sodax/dapp-kit';
import { describe, expect, it, vi } from 'vitest';
import {
  executeSwap,
  canExecute,
  toIntentRequest,
  broadcast,
  isUserRejection,
  executionError,
  sourceExtras,
  type ExecutionDependencies,
} from './execution';
import { readActivity, submissionFor, type Activity } from './activity';

const address = '0x1234567890abcdef1234567890abcdef12345678';
const tx: EvmRawTransaction = { from: address, to: address, value: 0n, data: '0x' };
const body: CreateIntentParamsV2 = {
  srcChainKey: ChainKeys.BASE_MAINNET,
  dstChainKey: ChainKeys.SOLANA_MAINNET,
  srcAddress: address,
  dstAddress: 'recipient',
  inputToken: address,
  outputToken: 'mint',
  inputAmount: '1000000',
  minOutputAmount: '990',
  deadline: '0',
  allowPartialFill: false,
  partnerFee: { address, percentage: 25 },
};
const intent: IntentResponseV2 = {
  intentId: '9007199254740993',
  creator: address,
  inputToken: address,
  outputToken: address,
  inputAmount: '1000000',
  minOutputAmount: '990',
  deadline: '2000000000',
  allowPartialFill: false,
  srcChain: '8453',
  dstChain: '123',
  srcAddress: address,
  dstAddress: address,
  solver: address,
  data: '0x',
};

function setup(allowed = true) {
  const calls: string[] = [];
  const deps: ExecutionDependencies = {
    api: {
      getQuote: vi.fn(async () => ({ ok: true as const, value: { quotedAmount: '1000' } })),
      checkAllowance: vi.fn(async () => ({ ok: true as const, value: { valid: allowed } })),
      getDeadline: vi.fn(async () => ({ ok: true as const, value: { deadline: '2000000000' } })),
      createIntent: vi.fn(async () => ({
        ok: true as const,
        value: { tx, intent, relayData: { address, payload: '0x00' } },
      })),
      submitTx: vi.fn(async () => {
        calls.push('submit');
        return { ok: true as const, value: { success: true, data: { status: 'inserted' as const, message: 'OK' } } };
      }),
    },
    approve: vi.fn(async () => {
      calls.push('approve');
    }),
    sign: vi.fn(async () => {
      calls.push('sign');
      return '0x1234';
    }),
    onPhase: vi.fn(),
    onBroadcast: vi.fn(() => calls.push('save')),
    onRelayAccepted: vi.fn(() => calls.push('accepted')),
  };
  return { deps, calls };
}

// A Stacks address cannot yield its signer public key, so an intent built without one is refused.
describe('sourceExtras', () => {
  it('carries the signer public key for a Stacks source and for nothing else', () => {
    expect(sourceExtras('STACKS', '02deadbeef')).toEqual({ srcPublicKey: '02deadbeef' });
    expect(sourceExtras('EVM', '02deadbeef')).toEqual({});
    expect(sourceExtras('SOLANA', '02deadbeef')).toEqual({});
    expect(sourceExtras('STACKS', undefined)).toEqual({});
  });

  it('reaches the intent the swaps API builds', async () => {
    const { deps } = setup();
    const stacks = { ...body, ...sourceExtras('STACKS', '02deadbeef') };
    await executeSwap(stacks, deps);
    expect(deps.api.createIntent).toHaveBeenCalledWith(expect.objectContaining({ srcPublicKey: '02deadbeef' }));
  });
});

describe('swap execution', () => {
  it('persists the broadcast before submitting and uses the reviewed minimum and partner fee', async () => {
    const { deps, calls } = setup();
    await executeSwap(body, deps);
    // Acceptance is reported last and only on success, so a record is never marked submitted while
    // the relay could still refuse it — that mark is what a reload reads instead of a lost error.
    expect(calls).toEqual(['sign', 'save', 'submit', 'accepted']);
    expect(deps.api.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ amount: body.inputAmount, partnerFee: body.partnerFee }),
    );
    expect(deps.api.createIntent).toHaveBeenCalledWith({ ...body, deadline: '2000000000' });
    expect(deps.api.submitTx).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: '0x1234', intent: toIntentRequest(intent) }),
    );
  });
  it('waits for approval and rechecks the price before signing', async () => {
    const { deps, calls } = setup(false);
    await executeSwap(body, deps);
    expect(calls).toEqual(['approve', 'sign', 'save', 'submit', 'accepted']);
    expect(deps.api.getQuote).toHaveBeenCalledTimes(2);
  });
  it('stops before approval when the reviewed minimum is no longer available', async () => {
    const { deps } = setup(false);
    vi.mocked(deps.api.getQuote).mockResolvedValue({ ok: true as const, value: { quotedAmount: '989' } });
    await expect(executeSwap(body, deps)).rejects.toThrow('quote changed');
    expect(deps.approve).not.toHaveBeenCalled();
    expect(deps.sign).not.toHaveBeenCalled();
  });
  it('does not sign a deposit after an approval failure', async () => {
    const { deps } = setup(false);
    vi.mocked(deps.approve).mockRejectedValue(new Error('Approval reverted'));
    await expect(executeSwap(body, deps)).rejects.toThrow('Approval reverted');
    expect(deps.sign).not.toHaveBeenCalled();
    expect(deps.api.submitTx).not.toHaveBeenCalled();
  });
  it('retains the broadcast when the relay is unavailable', async () => {
    const { deps, calls } = setup();
    vi.mocked(deps.api.submitTx).mockResolvedValue({ ok: false, error: new Error('Offline') });
    await expect(executeSwap(body, deps)).rejects.toThrow('Offline');
    expect(calls).toEqual(['sign', 'save']);
    expect(deps.onBroadcast).toHaveBeenCalledWith(expect.objectContaining({ txHash: '0x1234' }), intent);
    expect(deps.sign).toHaveBeenCalledTimes(1);
    // The deposit is out and the relay does not have it. Leaving the record unmarked is what keeps
    // the resubmission reachable after a reload, when the error that raised it is gone.
    expect(deps.onRelayAccepted).not.toHaveBeenCalled();
  });
  it('does not submit or persist when a wallet declines signing', async () => {
    const { deps } = setup();
    vi.mocked(deps.sign).mockRejectedValue(new Error('User rejected'));
    await expect(executeSwap(body, deps)).rejects.toThrow('User rejected');
    expect(deps.onBroadcast).not.toHaveBeenCalled();
    expect(deps.api.submitTx).not.toHaveBeenCalled();
  });
  it('binds EVM signing to the selected chain', async () => {
    const send = vi.fn(async (): Promise<`0x${string}`> => '0x1234');
    await broadcast(ChainKeys.BASE_MAINNET, tx, {
      chainType: 'EVM',
      getWalletAddress: async () => address,
      sendTransaction: send,
      waitForTransactionReceipt: vi.fn(),
    });
    expect(send).toHaveBeenCalledWith(tx, { expectedChainId: 8453 });
  });
  it('rejects a wallet of the wrong family without sending', async () => {
    const send = vi.fn();
    await expect(
      broadcast(ChainKeys.SOLANA_MAINNET, tx, {
        chainType: 'EVM',
        getWalletAddress: async () => address,
        sendTransaction: send,
        waitForTransactionReceipt: vi.fn(),
      }),
    ).rejects.toThrow('Reconnect');
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps unsupported execution families explicit', () => {
    expect(canExecute(ChainKeys.BASE_MAINNET)).toBe(true);
    expect(canExecute(ChainKeys.SOLANA_MAINNET)).toBe(true);
    expect(canExecute(ChainKeys.SUI_MAINNET)).toBe(true);
    expect(canExecute(ChainKeys.STELLAR_MAINNET)).toBe(true);
    expect(canExecute(ChainKeys.NEAR_MAINNET)).toBe(true);
    expect(canExecute(ChainKeys.STACKS_MAINNET)).toBe(true);
    expect(canExecute(ChainKeys.INJECTIVE_MAINNET)).toBe(true);
    // Bitcoin settles through a funded Bound trading wallet, not a signed swaps-API payload.
    expect(canExecute(ChainKeys.BITCOIN_MAINNET)).toBe(false);
  });
  it('refuses a transaction built for another signing account', async () => {
    const send = vi.fn();
    await expect(
      broadcast(ChainKeys.BASE_MAINNET, tx, {
        chainType: 'EVM',
        getWalletAddress: async () => '0x0000000000000000000000000000000000000001',
        sendTransaction: send,
        waitForTransactionReceipt: vi.fn(),
      }),
    ).rejects.toThrow('signing account changed');
    expect(send).not.toHaveBeenCalled();
  });
  it('passes Solana transaction data to its wallet signer', async () => {
    const sign = vi.fn(async () => 'solana-signature');
    const solanaTx = { from: 'solana-account', to: 'program', value: 0n, data: 'base64' };
    expect(
      await broadcast(ChainKeys.SOLANA_MAINNET, solanaTx, {
        chainType: 'SOLANA',
        getWalletAddress: async () => 'solana-account',
        signAndSendTransaction: sign,
        sendTransaction: vi.fn(),
        waitForConfirmation: vi.fn(),
        buildV0Txn: vi.fn(),
        getWalletBase58PublicKey: vi.fn(),
        getAssociatedTokenAddress: vi.fn(),
        getBalance: vi.fn(),
        getTokenAccountBalance: vi.fn(),
      }),
    ).toBe('solana-signature');
    expect(sign).toHaveBeenCalledWith(solanaTx);
  });
  it('passes Sui serialized transaction data to its execution method', async () => {
    const sign = vi.fn<ISuiWalletProvider['signAndExecuteTxn']>(async () => 'sui-digest');
    await broadcast(ChainKeys.SUI_MAINNET, tx, {
      chainType: 'SUI',
      getWalletAddress: async () => address,
      signAndExecuteTxn: sign,
      getCoins: vi.fn(),
      viewContract: vi.fn(),
    });
    expect(await sign.mock.calls[0]?.[0].toJSON()).toBe(tx.data);
  });

  it('signs a Stellar transfer with its wallet signer', async () => {
    const sign = vi.fn(async () => 'stellar-hash');
    const stellarTx = { from: 'GSENDER', to: 'GVAULT', value: 0n, data: 'xdr' };
    expect(
      await broadcast(ChainKeys.STELLAR_MAINNET, stellarTx, {
        chainType: 'STELLAR',
        getWalletAddress: async () => 'GSENDER',
        signAndSendTransaction: sign,
        signTransaction: vi.fn(),
        waitForTransactionReceipt: vi.fn(),
      }),
    ).toBe('stellar-hash');
    expect(sign).toHaveBeenCalledWith(stellarTx);
  });

  // NEAR carries its sender as `signerId`, so the account check reads that rather than `from`.
  it('submits a NEAR call and refuses one built for another account', async () => {
    const sign = vi.fn(async () => 'near-hash');
    const nearTx = { signerId: 'alice.near', params: { contractId: 'vault.near', method: 'ft_transfer', args: {} } };
    const provider = (address: string) => ({
      chainType: 'NEAR' as const,
      getWalletAddress: async () => address,
      getRawTransaction: vi.fn(),
      signAndSubmitTxn: sign,
    });
    expect(await broadcast(ChainKeys.NEAR_MAINNET, nearTx, provider('alice.near'))).toBe('near-hash');
    expect(sign).toHaveBeenCalledWith(nearTx);
    await expect(broadcast(ChainKeys.NEAR_MAINNET, nearTx, provider('bob.near'))).rejects.toThrow(
      'signing account changed',
    );
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('signs a Stacks payload and rejects an empty one', async () => {
    const sign = vi.fn(async () => 'stacks-txid');
    const provider = {
      chainType: 'STACKS' as const,
      getWalletAddress: async () => 'SP-SENDER',
      getPublicKey: vi.fn(),
      getBalance: vi.fn(),
      sendTransaction: vi.fn(),
      signAndSendTransaction: sign,
    };
    expect(await broadcast(ChainKeys.STACKS_MAINNET, { payload: 'deadbeef' }, provider)).toBe('stacks-txid');
    await expect(broadcast(ChainKeys.STACKS_MAINNET, { payload: '' }, provider)).rejects.toThrow('cannot sign');
    expect(sign).toHaveBeenCalledTimes(1);
  });

  // Injective reports a hex `from` while the wallet reports bech32, so the sender check must not run.
  it('signs an Injective doc without comparing its hex sender to the bech32 account', async () => {
    const sign = vi.fn(async () => 'injective-hash');
    const injectiveTx = {
      from: address,
      to: address,
      signedDoc: {
        bodyBytes: new Uint8Array([1]),
        authInfoBytes: new Uint8Array([2]),
        chainId: 'injective-1',
        accountNumber: 1n,
      },
    } as const;
    expect(
      await broadcast(ChainKeys.INJECTIVE_MAINNET, injectiveTx, {
        chainType: 'INJECTIVE',
        getWalletAddress: async () => 'inj1sender',
        execute: vi.fn(),
        signAndSendTransaction: sign,
      }),
    ).toBe('injective-hash');
    expect(sign).toHaveBeenCalledWith(injectiveTx);
  });

  it('refuses a payload shaped for another family', async () => {
    const sign = vi.fn();
    await expect(
      broadcast(
        ChainKeys.NEAR_MAINNET,
        { payload: 'stacks-only' },
        {
          chainType: 'NEAR',
          getWalletAddress: async () => 'alice.near',
          getRawTransaction: vi.fn(),
          signAndSubmitTxn: sign,
        },
      ),
    ).rejects.toThrow('cannot sign');
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('activity recovery', () => {
  const activity: Activity = {
    txHash: '0x1234',
    srcChainKey: ChainKeys.BASE_MAINNET,
    dstChainKey: ChainKeys.SOLANA_MAINNET,
    srcTokenAddress: address,
    dstTokenAddress: 'mint',
    inputAmount: '1000',
    walletAddress: address,
    recipient: 'recipient',
    summary: '1 ETH → USDC',
    createdAt: 1000,
    intent,
    relayData: '0x00',
  };
  it('restores the exact relay request without losing bigint precision', () => {
    const restored = readActivity(JSON.stringify(activity));
    expect(restored).toEqual(activity);
    if (!restored) throw new Error('Activity did not restore');
    expect(submissionFor(restored).intent.intentId).toBe(9007199254740993n);
    expect(submissionFor(restored).txHash).toBe(activity.txHash);
  });
  it('restores captured analytics and settlement reporting without trusting arbitrary fields', () => {
    const pair = {
      source_chain: activity.srcChainKey,
      destination_chain: activity.dstChainKey,
      input_token_symbol: 'ETH',
      output_token_symbol: 'USDC',
      input_amount: '1',
      has_partner_fee: false,
    };
    expect(readActivity(JSON.stringify({ ...activity, pair, settlementReported: true }))?.pair).toEqual(pair);
    expect(readActivity(JSON.stringify({ ...activity, pair, settlementReported: true }))?.settlementReported).toBe(
      true,
    );
    expect(
      readActivity(JSON.stringify({ ...activity, pair: { ...pair, input_amount: 'secret' } }))?.pair,
    ).toBeUndefined();
    expect(readActivity(JSON.stringify({ ...activity, pair: { ...pair, wallet: 'private' } }))?.pair).toEqual(pair);
  });
  it('rejects corrupted storage and untrusted chain keys', () => {
    expect(readActivity('{')).toBeUndefined();
    expect(readActivity(JSON.stringify({ ...activity, srcChainKey: 'toString' }))).toBeUndefined();
    expect(readActivity(JSON.stringify({ ...activity, intent: { ...intent, inputAmount: '1.5' } }))).toBeUndefined();
    expect(readActivity(JSON.stringify({ ...activity, txHash: '<script>' }))).toBeUndefined();
  });
  // A record without them cannot name its tokens on a spoke chain, so it can never open a dialog.
  it('rejects a record carrying no spoke-side token identity', () => {
    const { srcTokenAddress: _src, ...noSource } = activity;
    const { dstTokenAddress: _dst, ...noDestination } = activity;
    expect(readActivity(JSON.stringify(noSource))).toBeUndefined();
    expect(readActivity(JSON.stringify(noDestination))).toBeUndefined();
    expect(readActivity(JSON.stringify({ ...activity, dstTokenAddress: '' }))).toBeUndefined();
  });
});

describe('isUserRejection', () => {
  it('separates a declined signature from a real failure, so the two do not share a reason', () => {
    expect(isUserRejection(new Error('User rejected the request'))).toBe(true);
    expect(isUserRejection(new Error('MetaMask Tx Signature: User denied transaction signature'))).toBe(true);
    expect(isUserRejection(new Error('insufficient funds for gas'))).toBe(false);
    expect(isUserRejection('not an error')).toBe(false);
  });
});

describe('executionError', () => {
  it('explains blocked RPC access without exposing the response payload', () => {
    const cause = new Error('403 : {"jsonrpc":"2.0","error":{"code":403,"message":"Access forbidden"}}');
    expect(executionError(cause)).toBe(
      'The network connection refused this request (403). Please try again once the connection is restored.',
    );
  });

  it('does not label a rejected RPC request as a wallet rejection', () => {
    expect(executionError(new Error('RPC rejected the request: 403'))).toContain('network connection');
    expect(executionError(new Error('User rejected the request'))).toBe(
      'Request declined in your wallet. You can try again.',
    );
  });
});
