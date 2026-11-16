# Recipe: Setup — private-key mode

Construct a `*WalletProvider` from a raw key. Use this in Node scripts, CI, tests, indexers, bots — anywhere the runtime legitimately possesses a secret.

**Depends on:** none. **Do NOT** use this in a browser bundle.

---

## Pick the right chain

Each chain has its own discriminated union. See [`../features/<chain>.md`](../features/) for exact field names.

| Chain | Field that triggers PK mode | Credential shape |
|---|---|---|
| EVM       | `privateKey: '0x…'`                       | hex string |
| Solana    | `privateKey: Uint8Array`                  | 64-byte secret key |
| Sui       | `mnemonics: '…'`                          | BIP-39 phrase (no raw key option) |
| Bitcoin   | `type: 'PRIVATE_KEY'`, `privateKey: '0x…'`| hex string + uppercase `type` |
| Stellar   | `type: 'PRIVATE_KEY'`, `privateKey: '0x…'`| hex string + uppercase `type` |
| ICON      | `privateKey: '0x…'`                       | hex string |
| Injective | `secret: { privateKey } \| { mnemonics }` | nested credential object |
| NEAR      | `privateKey: 'ed25519:…'`, `accountId`    | algorithm-prefixed string + accountId |
| Stacks    | `privateKey: '…'`                         | string |
| Tron      | `privateKey: '…'`                         | hex string, `0x` optional |

---

## Install

```bash
pnpm add @sodax/wallet-sdk-core @sodax/types
```

If you'll hand off to `@sodax/sdk`, add it too:

```bash
pnpm add @sodax/sdk
```

---

## Pattern: EVM (representative)

```ts
import 'dotenv/config';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY as `0x${string}`;
if (!PRIVATE_KEY) throw new Error('EVM_PRIVATE_KEY is required');

const provider = new EvmWalletProvider({
  privateKey: PRIVATE_KEY,
  chainId: ChainKeys.SONIC_MAINNET,                 // pick any EvmChainKey
  rpcUrl: process.env.EVM_RPC_URL,                  // optional — defaults to viem chain's public RPC
  defaults: {
    sendTransaction: { gas: 3_000_000n },           // env-level fixed default
  },
});

const address = await provider.getWalletAddress();
console.log('Signing as:', address);
```

For other chains, swap the import and follow the field table above. Full snippets per chain live in [`../quickstart.md`](../quickstart.md).

---

## Keep the secret out of code

| Anti-pattern | Why bad | Replacement |
|---|---|---|
| `privateKey: '0xabc…'` inline | Key in version control | `process.env.EVM_PRIVATE_KEY` |
| `.env` committed to git | Same as above | `.env` in `.gitignore`, only `.env.example` committed |
| Key in a frontend bundle | Browser users can read it | Use `setup-browser-extension.md` |
| Key passed via CLI argv | Shows up in shell history | `dotenv-cli` + `.env` file |

---

## Verification

```ts
// Get-address smoke test
console.log(await provider.getWalletAddress());

// Optional: dry-run a balance read
// (chain-specific — see ../features/<chain>.md)
```

```bash
# 1. Type check passes
pnpm checkTs

# 2. Confirm only one provider import — barrel only
grep -rn "from '@sodax/wallet-sdk-core" <script-dir>
# expect zero deep paths like @sodax/wallet-sdk-core/src/...
```

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `Invalid EVM wallet config` | Config matches neither variant — no valid `privateKey` (`0x…`) and not both `walletClient` + `publicClient` | Supply exactly one valid variant. (Note: if you DO pass a valid `privateKey`, PK mode wins even if browser fields are also present — no throw.) |
| TS2322: `'string'` is not assignable to `` `0x${string}` `` | Missing hex prefix or wrong type | Read from env with `as \`0x${string}\`` after a runtime check. |
| TS: `Property 'secret' is missing` (Injective) | Used `privateKey` at top level | Wrap in `{ secret: { privateKey } }` or `{ secret: { mnemonics } }`. See [`../features/injective.md`](../features/injective.md). |
| `Unsupported EVM chain key: <key>` | Passed an EVM chain key not handled by `getEvmViemChain` | Use a `ChainKeys.*_MAINNET` constant — `chainId` is typed `EvmChainKey` and the switch is exhaustive, so this is normally a compile-time error. |

---

## Next steps

- [`bridge-to-sdk.md`](./bridge-to-sdk.md) — pass the provider to `@sodax/sdk` for swap / lend / bridge / stake.
- [`defaults-and-overrides.md`](./defaults-and-overrides.md) — tune the `defaults` slice.
- [`sign-and-broadcast.md`](./sign-and-broadcast.md) — chain-by-chain raw-tx flow.
