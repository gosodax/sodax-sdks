import { XService } from '@/core/XService.js';
import { isNativeToken } from '@/utils/index.js';
import type { XToken } from '@sodax/types';
import { type Connection, PublicKey } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token';
import type { WalletContextState } from '@solana/wallet-adapter-react';

export class SolanaXService extends XService {
  private static instance: SolanaXService;

  public connection: Connection | undefined;
  public wallet: WalletContextState | undefined;

  private constructor() {
    super('SOLANA');
  }

  public static getInstance(): SolanaXService {
    if (!SolanaXService.instance) {
      SolanaXService.instance = new SolanaXService();
    }
    return SolanaXService.instance;
  }

  /**
   * Batches native SOL and SPL / Token-2022 balance reads into as few RPC calls as possible.
   * Rejects when any RPC request fails, so a failed request is never reported as zero balances.
   */
  override async getBalances(address: string | undefined, xTokens: readonly XToken[]): Promise<Record<string, bigint>> {
    if (!address) return {};

    const balances = xTokens.map(() => 0n);
    const toRecord = () =>
      xTokens.reduce<Record<string, bigint>>((result, xToken, index) => {
        result[xToken.address] = balances[index] ?? 0n;
        return result;
      }, {});

    const connection = this.connection;
    if (!connection) return toRecord();

    let owner: PublicKey;
    try {
      owner = new PublicKey(address);
    } catch {
      return toRecord();
    }

    const nativeIndexes: number[] = [];
    const tokenCandidates: {
      index: number;
      candidates: { programId: PublicKey; ata: PublicKey }[];
    }[] = [];

    for (const [index, xToken] of xTokens.entries()) {
      try {
        if (isNativeToken(xToken)) {
          nativeIndexes.push(index);
          continue;
        }

        const mint = new PublicKey(xToken.address);
        tokenCandidates.push({
          index,
          candidates: [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map(programId => ({
            programId,
            ata: getAssociatedTokenAddressSync(mint, owner, true, programId),
          })),
        });
      } catch {
        // Invalid token metadata leaves this input's compatibility fallback at zero.
      }
    }

    const nativeBalancePromise = nativeIndexes.length
      ? connection.getBalance(owner).then(balance => BigInt(balance))
      : Promise.resolve(0n);

    const batchPromises: Promise<void>[] = [];
    for (let start = 0; start < tokenCandidates.length; start += 50) {
      const chunk = tokenCandidates.slice(start, start + 50);
      const candidates = chunk.flatMap(entry =>
        entry.candidates.map(candidate => ({ ...candidate, index: entry.index })),
      );

      batchPromises.push(
        connection.getMultipleAccountsInfo(candidates.map(candidate => candidate.ata)).then(accounts => {
          for (const [candidateIndex, candidate] of candidates.entries()) {
            const info = accounts[candidateIndex];
            if (!info) continue;
            try {
              balances[candidate.index] =
                (balances[candidate.index] ?? 0n) + unpackAccount(candidate.ata, info, candidate.programId).amount;
            } catch {
              // Not a token account for this candidate's program — ignore it.
            }
          }
        }),
      );
    }

    const [nativeBalance] = await Promise.all([nativeBalancePromise, Promise.all(batchPromises)]);
    for (const index of nativeIndexes) balances[index] = nativeBalance;

    return toRecord();
  }

  override async getBalance(address: string | undefined, xToken: XToken): Promise<bigint> {
    if (!address) return BigInt(0);

    const connection = this.connection;
    if (!connection) {
      return BigInt(0);
    }

    try {
      if (isNativeToken(xToken)) {
        const newBalance = await connection.getBalance(new PublicKey(address));
        return BigInt(newBalance);
      }

      const owner = new PublicKey(address);
      const mint = new PublicKey(xToken.address);

      // The mint belongs to either the legacy SPL Token program or Token-2022 (e.g. xStock
      // tokens like CRCLx), and the two derive different ATAs. Read the candidate ATA for each
      // in one getMultipleAccounts call (a fast, direct keyed lookup) and use the one that exists.
      const candidates = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map(programId => ({
        programId,
        ata: getAssociatedTokenAddressSync(mint, owner, true, programId),
      }));

      const accounts = await connection.getMultipleAccountsInfo(candidates.map(c => c.ata));

      // A mint is owned by exactly one program, so normally only one ATA exists. Summing (and
      // skipping anything that isn't a token account for that program) keeps the result correct
      // even if a stray account sits at the other candidate address.
      let balance = BigInt(0);
      for (const [i, candidate] of candidates.entries()) {
        const info = accounts[i];
        if (!info) continue;
        try {
          balance += unpackAccount(candidate.ata, info, candidate.programId).amount;
        } catch {
          // Not a token account for this program — ignore it.
        }
      }
      return balance;
    } catch {
      return BigInt(0);
    }
  }
}
