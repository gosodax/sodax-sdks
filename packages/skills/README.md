# @sodax/skills

AI-agent skills and knowledge for building on the **SODAX** cross-chain DeFi platform. Drop this into your repo and your AI coding agent writes v2-correct `@sodax/*` SDK code on the first try.

**Full setup** (skills CLI, npm, monorepo/local install, wiring agents to `AGENTS.md`): [docs/ai-integration-guide.md](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md).

## Install

Using the [`skills` CLI](https://github.com/vercel-labs/skills) from Vercel Labs — the open agent-skills ecosystem CLI (supports Claude Code, Cursor, Codex, GitHub Copilot, and 50+ other agents):

```bash
# From the root of your consumer repo
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

The five installable skills listed in `.claude-plugin/plugin.json` land in your repo — the `sodax-build` front-door / ideation skill plus the four mode-gated per-SDK-package skills (each with two knowledge subtrees: `integration/` for new v2 code, `migration-v1-to-v2/` for v1→v2 porting). The CLI does **not** copy the package-level `AGENTS.md`; agents auto-discover each skill from its `SKILL.md` frontmatter. Re-running the command picks up the latest content.

> **npm fallback** (web chats or when you prefer a devDependency): `pnpm add -D @sodax/skills`, then point your agent at `node_modules/@sodax/skills/AGENTS.md`. See the [integration guide](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md#wire-your-agent).

## What you get

| Bundle | Contains |
|---|---|
| **Front-door skill** at `skills/sodax-build/SKILL.md` | A cross-cutting ideation skill for when you don't know what to build yet. It interviews you, turns the idea into a product brief, and hands off to the right developer skill(s). Writes no app code; flat `knowledge/` tree (no integration/migration split). |
| **Mode-gated per-SDK-package skills** under `skills/sodax-<pkg>/SKILL.md` | One skill per SODAX SDK package. `<pkg>` ∈ `sdk`, `wallet-sdk-core`, `wallet-sdk-react`, `dapp-kit`. Each SKILL.md gates by mode (integration vs migration) at the top of the body. |
| **Granular skills** bundled inside each broad skill at `skills/sodax-<pkg>/<sub-domain>/SKILL.md` | Every broad skill ships focused single-domain children: `sodax-sdk` / `sodax-dapp-kit` per feature (swap, money-market, bridge, staking, dex, …); `sodax-wallet-sdk-core` per chain (evm, solana, sui, bitcoin, stellar, icon, injective, near, stacks); `sodax-wallet-sdk-react` per connectivity concern (connect, wallet-modal, bridge-to-sdk, switch-chain, sign-message, walletconnect, privy). They install **with** their parent broad skill (not as separate packages); once installed, load one when the task is already scoped to a single sub-domain — it points at exactly the knowledge files for it instead of the whole broad skill. |
| **Knowledge** under `skills/sodax-<pkg>/{integration,migration-v1-to-v2}/knowledge/` | Long-form supporting docs — features, recipes, reference tables, breaking-change writeups, code examples. Each skill ships both mode subtrees so `npx skills add` copies the full reference together. |
| **`AGENTS.md`** at the package root | Tool-neutral router: maps the consumer's stated task to the right skill + mode. Ships on npm, so it is the entry point for the `pnpm add -D @sodax/skills` and `file:` installs — the skills CLI does not copy it. |

Skills are short and action-oriented (workflow + anti-patterns + links). Knowledge is the lookup material. Don't read knowledge files top-to-bottom — the skill tells the agent which file is relevant for the current task.

## Which skill applies?

After install, your agent picks based on what you're building. Quick guide:

| You're building | Load these skills (mode) |
|---|---|
| Not sure what to build yet / not a developer | `sodax-build` — it interviews you, writes a product brief, and names the skill to load next |
| Backend / Node app (no React) using `@sodax/sdk` | `sodax-sdk` (integration) + `sodax-wallet-sdk-core` (integration; if signing) |
| React dapp using `@sodax/dapp-kit` | `sodax-dapp-kit` (integration) + `sodax-wallet-sdk-react` (integration; always) + `sodax-sdk` (integration; for any unwrapped operations) |
| React app calling the SDK directly (no `dapp-kit`) | `sodax-sdk` (integration) + `sodax-wallet-sdk-react` (integration) |
| **Porting v1 code** | Same skills, switched to migration mode (each SKILL.md mode-gates by consumer signal). |

`AGENTS.md` says the same thing in router form — your agent reads it first and picks.

## Why this exists

LLM training data drifts: snippets from chat often use stale method names, reshaped types, or outdated error codes. Public docs help humans, not agents — an agent only reads what's in its context window. This package ships the right material in agent-native form so the agent reads it before generating code. The content is version-locked to the SDK — upgrade `@sodax/skills`, the docs upgrade with it.

## Feedback

If your agent generates wrong code despite reading the docs, that's a doc bug — please open an issue on the [SODAX SDKs repo](https://github.com/icon-project/sodax-sdks/issues) with the prompt and the incorrect output. The per-skill `knowledge/` subtrees are structurally CI-guarded (frontmatter, link resolution); prose claims benefit from real-world feedback.
