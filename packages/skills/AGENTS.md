# AGENTS.md — `@sodax/skills` router

> Tool-neutral entry point. You are looking at the consumer-facing AI material for the `@sodax/*` SDKs. If you can read multiple `SKILL.md` files, load **2–3 skills** based on what the user is building (table below). Then follow each skill's internal workflow.

> **Don't know what to build yet, or not a developer?** Load the **`sodax-build`** front-door skill first. It runs a guided interview, turns a vague idea into a product brief, and names the developer skill(s) to load next — it writes no app code. Skip it the moment an SDK, feature, or hook is already named, and route straight to the matching skill below.

## What's here

This package ships **mode-gated broad SDK skills** (`skills/<name>/SKILL.md`, one per SODAX SDK package) and a cross-cutting **front-door / ideation skill** (`sodax-build`; flat `knowledge/`, no mode split, no granular children — see the callout above), plus **nested granular skills** under every broad skill: `sodax-sdk` (one per Core SDK feature service), `sodax-dapp-kit` (one per dapp-kit feature domain), `sodax-wallet-sdk-core` (one per chain family), and `sodax-wallet-sdk-react` (one per connectivity concern). Each broad skill bundles two long-form **knowledge** subtrees: `integration/knowledge/` (writing new v2 code) and `migration-v1-to-v2/knowledge/` (porting v1 → v2). Granular skills are single-file SKILL.md that link into their parent's knowledge tree. The **installable units are the top-level skills registered in `.claude-plugin/plugin.json`** — installing a broad skill (e.g. `npx skills add … --skill sodax-sdk`) lands its full knowledge tree **and** all its nested granular SKILL.md files, so you "load a granular skill" by reading `skills/<broad>/<feature>/SKILL.md` from within the installed broad skill. (Granular skills are not installed standalone: they link up into the parent tree via `../`, which only resolves inside the broad skill.) Skills are action-oriented (when to use, workflow, anti-patterns, links into knowledge); knowledge is the reference material your workflow points at. SKILL.md gates by mode at the top — pick integration or migration based on the consumer signal.

| SDK package | Broad skill | Granular per-feature skills |
|---|---|---|
| `@sodax/sdk` | `sodax-sdk` | `sodax-sdk/swap`, `sodax-sdk/money-market`, `sodax-sdk/bridge`, `sodax-sdk/staking`, `sodax-sdk/dex`, `sodax-sdk/leverage-yield`, `sodax-sdk/migration`, `sodax-sdk/partner`, `sodax-sdk/recovery`, `sodax-sdk/sponsoring`, `sodax-sdk/backend-api`, `sodax-sdk/swaps-api`, `sodax-sdk/leverage-yield-api` |
| `@sodax/wallet-sdk-core` | `sodax-wallet-sdk-core` | `sodax-wallet-sdk-core/evm`, `sodax-wallet-sdk-core/solana`, `sodax-wallet-sdk-core/sui`, `sodax-wallet-sdk-core/bitcoin`, `sodax-wallet-sdk-core/stellar`, `sodax-wallet-sdk-core/icon`, `sodax-wallet-sdk-core/injective`, `sodax-wallet-sdk-core/near`, `sodax-wallet-sdk-core/stacks` |
| `@sodax/wallet-sdk-react` | `sodax-wallet-sdk-react` | `sodax-wallet-sdk-react/connect`, `sodax-wallet-sdk-react/wallet-modal`, `sodax-wallet-sdk-react/bridge-to-sdk`, `sodax-wallet-sdk-react/switch-chain`, `sodax-wallet-sdk-react/sign-message`, `sodax-wallet-sdk-react/walletconnect` |
| `@sodax/dapp-kit` | `sodax-dapp-kit` | `sodax-dapp-kit/swap`, `sodax-dapp-kit/money-market`, `sodax-dapp-kit/staking`, `sodax-dapp-kit/bridge`, `sodax-dapp-kit/dex`, `sodax-dapp-kit/leverage-yield`, `sodax-dapp-kit/migration`, `sodax-dapp-kit/bitcoin`, `sodax-dapp-kit/auxiliary-services` |

**When to prefer a granular skill:** if the consumer has already picked a sub-domain (e.g. *"swap with Sodax"*, *"supply on money market"*, *"useSwap hook"*, *"instantiate EvmWalletProvider"*, *"add a connect button"*), load the matching granular skill — it's ~3 KB vs the broad skill's ~13 KB and points at exactly the knowledge files needed. For a React dapp that has settled on one feature, load `sodax-dapp-kit/<feature>`; for raw SDK / backend work, load `sodax-sdk/<feature>`; for a known chain in a backend/Node wallet flow, load `sodax-wallet-sdk-core/<chain>`; for a known React wallet concern (connect, wallet-modal, bridge-to-sdk, switch-chain, sign-message, walletconnect), load `sodax-wallet-sdk-react/<concern>`. Load the broad skill when the sub-domain is undecided, the task spans several, or the consumer is porting a full v1 codebase.

> **What about `@sodax/types`?** No skill. The package has no consumer-facing surface — it's pure TypeScript types, re-exported through `@sodax/sdk`. Importing `@sodax/types` directly invites version skew. The SDK skills cover all `@sodax/types` symbols you need.

## Route by consumer intent

Pick the consumer's situation, load the listed skills in order. Each entry names the **skill** + the **mode** to run it in. SKILL.md has the mode decision-tree at the top — follow that section.

| Consumer is… | Load skills (mode) |
|---|---|
| **Not sure what to build / not a developer** (no SDK, feature, or concrete product chosen yet) | `sodax-build` (front-door ideation: interview → product brief → handoff; it names the dev skills to load next). Skip the moment any SDK / feature / hook is named |
| **Scaffolding ONE specific Core SDK feature** (swap, money-market, bridge, staking, dex, leverage-yield, migration, partner, recovery, sponsoring, backend-api, swaps-api, leverage-yield-api) | `sodax-sdk/<feature>` (granular, covers both modes via internal links). Add `sodax-wallet-sdk-core` (integration) if it signs and lives outside React. Skip the broad `sodax-sdk` skill |
| **Scaffolding ONE specific dapp-kit feature in React** (swap, money-market, staking, bridge, dex, leverage-yield, migration, bitcoin, auxiliary-services) | `sodax-wallet-sdk-react` (integration) → `sodax-dapp-kit/<feature>` (granular, covers both modes via internal links). Skip the broad `sodax-dapp-kit` skill. If the wallet concern is also settled (just a connect button, modal, bridge, etc.), narrow to `sodax-wallet-sdk-react/<concern>` too |
| **Scaffolding ONE chain's wallet provider** (backend/Node/non-React: evm, solana, sui, bitcoin, stellar, icon, injective, near, stacks) | `sodax-wallet-sdk-core/<chain>` (granular, covers both modes) → `sodax-sdk/<feature>` for the operation it signs. Skip the broad `sodax-wallet-sdk-core` skill |
| **Scaffolding ONE React wallet concern** (connect, wallet-modal, bridge-to-sdk, switch-chain, sign-message, walletconnect) | `sodax-wallet-sdk-react/<concern>` (granular, covers both modes). Skip the broad `sodax-wallet-sdk-react` skill |
| **Building a NEW React dapp** | `sodax-wallet-sdk-react` (integration) → `sodax-dapp-kit` (integration) → (`sodax-sdk` (integration) only if dropping below dapp-kit) |
| **Building a NEW React app, no dapp-kit** (calling the SDK directly) | `sodax-wallet-sdk-react` (integration) → `sodax-sdk` (integration) |
| **Building a NEW Node / backend service or script** | `sodax-sdk` (integration) → `sodax-wallet-sdk-core` (integration; only if it signs) |
| **Building a NEW non-React browser flow** | `sodax-wallet-sdk-core` (integration) → `sodax-sdk` (integration) |
| **Porting an EXISTING v1 React dapp** | `sodax-wallet-sdk-react` (migration) → `sodax-dapp-kit` (migration) → `sodax-sdk` (migration). Then switch each skill to integration mode for any new code. |
| **Porting an EXISTING v1 backend** | `sodax-sdk` (migration) → `sodax-wallet-sdk-core` (migration; often no-op — additive only) |

If you don't know which situation applies, **ask the user** rather than guessing. Two signals to listen for:

- "Migrate / upgrade / port" + v1 fingerprints (`useSpokeProvider`, `*_MAINNET_CHAIN_ID`, `xChainId`, `useXWagmiStore`, `MoneyMarketError`/`IntentError`/etc.) → migration first.
- "Add / build / integrate" + no existing SODAX code → integration only.

If both: do migration first. Stale v1 patterns leak into new code if you skip it.

## How to use a skill

Each `SKILL.md` is short on purpose. Follow it like a procedure:

1. The skill's frontmatter `description` tells you the trigger conditions.
2. The body's **Workflow** section links into knowledge files. Read them in order — token budgets are sized so the right 2–3 files fit in your context.
3. The **Top traps** + **Conventions** sections are the consolidated DO / DO NOT list. Skipping them is the most common cause of generating v1 code.
4. The **Verification** section is the done-criteria. Run those checks before reporting the task complete.

## Layout reference

```
packages/skills/
├── AGENTS.md                              # You are here
├── .claude-plugin/plugin.json             # Skill registry (source of truth) — broad SDK skills + registered meta skills (granular ship bundled inside broad skills)
└── skills/                                # Broad skills are mode-gated with nested granular children; sodax-build is a flat front-door meta skill
    ├── sodax-build/                       {SKILL.md, knowledge/ (flat)} — cross-cutting front-door / ideation skill; no mode split, no granular children
    ├── sodax-sdk/                         {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/,
    │                                       <feature>/SKILL.md children — swap, money-market, bridge, staking, dex,
    │                                       leverage-yield, migration, partner, recovery, sponsoring, backend-api,
    │                                       swaps-api, leverage-yield-api}
    ├── sodax-wallet-sdk-core/             {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/,
    │                                       <chain>/SKILL.md children — evm, solana, sui, bitcoin, stellar, icon,
    │                                       injective, near, stacks}
    ├── sodax-wallet-sdk-react/            {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/
    │                                       (incl. .tsx example apps under integration/knowledge/examples/),
    │                                       <concern>/SKILL.md children — connect, wallet-modal, bridge-to-sdk,
    │                                       switch-chain, sign-message, walletconnect}
    └── sodax-dapp-kit/                    {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/,
                                            <feature>/SKILL.md children — swap, money-market, staking, bridge, dex,
                                            leverage-yield, migration, bitcoin, auxiliary-services}
```

Each `<mode>/knowledge/` subtree contains `ai-rules.md`, `quickstart.md`, `architecture.md`, `features/`, `recipes/`, `reference/`, and `chain-specifics.md` / `breaking-changes/` where applicable.

## Conventions you can rely on

- **`ai-rules.md` first.** Each mode's `<mode>/knowledge/ai-rules.md` is the consolidated DO / DO NOT list. Skipping it is the top cause of stale v1 patterns.
- **`README.md`** at every level is the tree index — useful when the skill points you at a directory rather than a file.
- **Reference tables** under `<mode>/knowledge/reference/` are for lookup, not narrative — chain keys, error codes, public API surface, hook signatures.
- **Recipes** under `<mode>/knowledge/recipes/` are self-contained — a recipe contains before/after code, steps, and verification. Don't jump between recipes for one task.
- **Token budget**: if you're loading more than 3 files for a single task, you're probably off-route — re-check the workflow.

## When SODAX is the wrong tool

If the user is doing **non-SODAX work** (UI styling, unrelated DOM, unrelated backend), this package has nothing to add. Don't load skills from here.

If the user is doing **DeFi work but explicitly NOT with SODAX** (e.g. "use Uniswap"), defer to the user's stated tool. The integration skills' descriptions all say: "do not substitute with other SDKs unless explicitly asked."

## Feedback

If an agent generates wrong code despite following a skill, that's a doc bug — file an issue at https://github.com/icon-project/sodax-sdks/issues with the prompt and the incorrect output. The package is structurally CI-guarded (frontmatter + link resolution); prose-level claims benefit from real-world feedback.

## Maintaining this package

The sections above are the consumer-facing router (shipped via npm + the `skills` CLI); the rest of this file is for maintainers editing this package. It contains **no runtime code** — it delivers agent-native documentation: short SKILL.md files (with YAML frontmatter) and long-form knowledge trees, one bundle per SDK package. The `migration-v1-to-v2/` subtree is named that (not `migration/`) to (a) avoid ambiguity with per-feature `features/migration.md` (ICX/bnUSD token migration) and (b) future-proof for a hypothetical `migration-v2-to-v3/`.

### Granular skills

Each broad skill has **nested granular skills** at `skills/<broad>/<sub-domain>/SKILL.md`. The split axis differs per package — pick whatever the consumer decides upfront and whatever maps 1:1 to a coherent slice of the broad knowledge tree:

- `sodax-sdk` — one per Core SDK feature service.
- `sodax-dapp-kit` — one per dapp-kit feature domain, matching the feature-knowledge filenames.
- `sodax-wallet-sdk-core` — one per chain family. The axis is chain, not feature; hooks/services are uniform across chains while per-chain config, methods, and gotchas differ.
- `sodax-wallet-sdk-react` — one per connectivity concern, each backed by a dedicated integration recipe.

They exist so agents can load just one workflow (~3 KB) instead of the whole broad SKILL.md (~13 KB) plus its broad knowledge index.

Granular skills are **one file each** (`<sub-domain>/SKILL.md`). They do **NOT** ship their own `integration/knowledge/` or `migration-v1-to-v2/knowledge/` subtrees — they link directly into the parent broad skill's knowledge tree (`../integration/knowledge/features/<feature>.md`, `../integration/knowledge/recipes/<recipe>.md`, etc.).

**Granular skills are bundled, not separately published.** `plugin.json` registers **only the top-level skills** (the broad SDK skills plus the registered meta skill). Each broad skill's directory already contains its nested granular `SKILL.md` files, so installing a broad skill (e.g. `npx skills add … --skill sodax-sdk`) lands every granular file alongside the knowledge tree; the broad SKILL.md's "prefer a granular skill" table then links to `./swap/SKILL.md` etc., which resolve in the consumer's install. Granular skills are deliberately **not** registered because they are not self-contained: a granular `SKILL.md` links **up** into its parent's tree (`../integration/knowledge/...`), and the `skills` CLI copies only a skill's own directory — so installing a granular skill standalone would leave every `../knowledge` link dangling. Keeping the registry to the top-level skills also concentrates skills.sh install telemetry (which drives search ranking) instead of diluting it across the many bundled granular rows. To add a new granular skill, drop a `<feature>/SKILL.md` into the broad skill dir and add its row to the parent's "Prefer a granular skill" table (`check:ai-structural` fails without it) — do **not** add it to `plugin.json`. Agents only auto-discover top-level skills, so that row is how they find it.

**Family rule:** every granular skill shares its parent broad skill's family. Family is the broad-skill name (`sdk`, `wallet-sdk-core`, `wallet-sdk-react`, `dapp-kit`). Cross-family clickable links remain forbidden; intra-family links (broad ↔ granular, granular ↔ granular within the same broad parent) are explicitly allowed.

### Meta / ideation skills (cross-cutting front door)

`sodax-build` is a **deliberately different category** from the per-package SDK skills — a single cross-cutting "front-door" skill that sits *upstream* of them. A non-technical or undecided user loads it first; it runs a guided interview, produces a product brief, and hands off to the dev skills by name. It writes no app code.

Three deliberate exemptions distinguish it from a broad skill — all intentional, not drift:

- **It is not a `sodax-<pkg>` skill.** It maps to no SDK package and has no granular children. Its "family" (for the cross-package link check) is `build`.
- **No integration/migration split — a flat `knowledge/` tree.** There is no v1→v2 axis for ideation. `check-skills.sh` 5b (which requires both mode subtrees) iterates only `EXPECTED_BROAD_SKILLS`, so the meta skill is exempt; it is registered + frontmatter-validated via a separate `EXPECTED_META_SKILLS` allowlist in 5a.
- **Dev-skill references are prose-only.** Because its family is `build`, ANY clickable link or GitHub URL into `sodax-sdk` / `sodax-dapp-kit` / `sodax-wallet-sdk-core` / `sodax-wallet-sdk-react` would trip the cross-package check. It names the dev skills in prose (backticks) only, and links exclusively within its own `knowledge/`.

**Self-contained but grounded.** The skill needs no network to run, but its facts are derived from repo source. Qualitative facts (what a feature does, the intent/solver swap model) are baked in; enumerable/exact values (chain lists, token symbols, fee caps) are NOT — each grounded knowledge file carries a "Source & freshness" header telling the agent to fetch the canonical `packages/types/...` / `packages/sdk/...` source before quoting exact values. Citing those source paths is CI-safe: the cross-package URL check only forbids URLs into `packages/skills/skills/sodax-<pkg>/...`.

**Evals.** A trigger-regression corpus lives at `scripts/_evals/sodax-build.json` — deliberately **outside** the shipped `skills/` tree so it is never copied into a consumer's install (`package.json` `files` excludes `scripts/`). Not a CI gate today; a fixture for future automated trigger testing.

To add another meta skill later: drop `skills/<name>/SKILL.md` + a flat `knowledge/`, register it in `plugin.json`, and add it to `EXPECTED_META_SKILLS` in `scripts/check-skills.sh`.

### Separation of concerns

- **Skills are action-oriented**: workflow, anti-patterns, decision points, links into knowledge. Body should fit in an agent's working context. Keep each SKILL.md short.
- **Knowledge is reference-oriented**: feature playbooks, recipe-style how-tos, reference tables (chain keys, error codes, hook signatures). Long-form, indexed by skill workflow steps. Do **not** duplicate knowledge inside SKILL.md.
- **AGENTS.md is the router**: consumer states their task → AGENTS.md tells the agent which skills to load. Replaces the per-package `ai-exported/AGENTS.md` entries that used to live inside each SDK package.

### Editing rules

- **SKILL.md frontmatter is load-bearing.** For a broad top-level skill at `skills/<broad>/SKILL.md`, `name` must equal the directory basename (e.g. `name: sodax-sdk`). For a nested granular skill at `skills/<broad>/<feature>/SKILL.md`, `name` must equal `<broad>-<feature>` (e.g. `name: sodax-sdk-swap`) — namespaced so each granular name stays unique and never collides with its parent (these names are still validated even though granular skills are bundled, not registered). `description` triggers selection — write it concretely with explicit trigger phrases (the agent looks at description alone to decide whether to load the skill). See existing skills for examples.
- **`description:` MUST be a single-quoted YAML scalar.** The [`vercel-labs/skills` CLI](https://github.com/vercel-labs/skills) parses frontmatter with strict YAML 1.2 — a plain (unquoted) scalar that contains `: ` (colon-space, the YAML mapping indicator) fails to parse and the skill is silently skipped at install time. Wrap every description in single quotes (`description: '...'`), doubling any apostrophe inside (`'` → `''`). Block scalars (`>-`) are also valid YAML but churn diffs and change rendering — prefer single quotes. The `check:ai-structural` validator parses each frontmatter through a real YAML parser to catch violations; it's stricter than the bash-grep check it replaced for exactly this reason.
- **Optional frontmatter: `license` + `metadata`.** Beyond the required `name` / `description`, every SKILL.md also carries `license: MIT` (matches `package.json`) and a `metadata` block with `version` and `author: sodax`. These are the portable optional fields the [`vercel-labs/skills` CLI](https://github.com/vercel-labs/skills) and skills.sh understand (`metadata` is free-form k/v; `version` conventionally tracks semver). **Quote the version** (`version: '0.0.1'`) — an unquoted two-segment value like `1.0` would parse as the YAML number `1`. The fields are additive; `check:ai-structural` only asserts `name` / `description` and does not whitelist, so extra keys are safe.
- **Skills link into knowledge by relative path.** From a SKILL.md, target paths look like `./integration/knowledge/ai-rules.md` or `./migration-v1-to-v2/knowledge/README.md`. Cross-mode links (between the two subtrees of the same skill) use a `<other-mode>/knowledge/<target>` segment, prefixed by `../` repeated enough times to climb out of the source subtree: depth-0 knowledge files (e.g. `<mode>/knowledge/README.md`, `quickstart.md`) use a `../../` prefix; depth-1 files (e.g. `<mode>/knowledge/features/*.md`, `<mode>/knowledge/recipes/*.md`) use `../../../`. The `check-skills.sh` validator verifies all resolve.
- **Cross-SDK-package references are forbidden.** A skill MUST NOT link to (or cite a relative/absolute path into) a skill belonging to a different SDK package **family** (`sdk`, `wallet-sdk-core`, `wallet-sdk-react`, `dapp-kit`). Concretely: `sodax-dapp-kit` knowledge MUST NOT reference `sodax-sdk`, `sodax-wallet-sdk-react`, or `sodax-wallet-sdk-core` content via `../../<other-skill>/...`, GitHub URLs, or any other clickable form. Use prose pointers naming the sibling skill instead (e.g., *"load the `sodax-sdk` skill (integration mode)"*). **Intra-family links are allowed**: integration ↔ migration-v1-to-v2 subtrees within the SAME broad skill, broad ↔ granular within the same family (e.g. `sodax-sdk` ↔ `sodax-sdk/swap`), and granular ↔ granular under the same broad parent. These all ship together and document the same SDK package.
- **Knowledge files** retain the structure they had under each package's `ai-exported/<mode>/` tree: `README.md`, `ai-rules.md`, `features/`, `recipes/`, `reference/`, plus `architecture.md`, `quickstart.md`, `chain-specifics.md`, and `breaking-changes/` where applicable. New files go under whichever subdirectory fits; both skills and knowledge are expected to evolve as the SDK does.
- **No `bin`, no build, no runtime TypeScript** in this package — markdown only. `tsc` ships as a devDep purely so the validator scripts can typecheck doc fixtures. `pnpm --filter @sodax/skills check:ai` is the local validation gate; CI runs the same thing via the existing `check:ai` turbo task.

### Conventions inherited from the old `ai-exported/` tree

- Two modes per SDK package, encoded as subtrees inside a single skill: `migration-v1-to-v2/knowledge/` (v1 → v2 reference, renames, mechanical port recipes) and `integration/knowledge/` (pure v2 reference, idiomatic patterns, public API surface). SKILL.md mode-gates by consumer signal.
- v1 mentions belong in `migration-v1-to-v2/knowledge/`. `integration/knowledge/` text stays pure v2 — no historicizing prose, no "this replaces the old X" callouts. Cross-link to `migration-v1-to-v2/knowledge/` when an agent might carry forward a v1 idiom.
- Out of scope for either subtree: workflow scripts (`find | xargs perl -i -pe …` — tooling preference), app-specific references (`apps/web`, `apps/demo`), integrator code design, generic engineering hygiene unrelated to a specific SDK API behavior.

### Validation

```bash
pnpm --filter @sodax/skills check:ai
```

Chains seven sub-scripts. Each catches a distinct bug class — green guards together prove syntactic + structural correctness, but **NOT** prose-level accuracy.

| Sub-script | What it enforces | Source of truth | Opt-out |
|---|---|---|---|
| `check:ai-structural` | `.claude-plugin/plugin.json` parses and registers exactly the expected broad SDK skills + meta skills (the `EXPECTED_*` arrays in `check-skills.sh` are the source of truth); every SKILL.md (broad + bundled granular + meta) has valid `name:` / `description:` frontmatter; no orphan top-level skill dirs; every relative `.md` link resolves; every granular skill is linked from its parent SKILL.md (its "Prefer a granular skill" row), every `integration/knowledge/features/*.md` is named in the parent's integration section, and every registered description fits Claude Code's 1,536-character skill-listing cap. | this package's filesystem | none — structural |
| `check:ai-imports` | Every `import … from '@sodax/<pkg>'` statement in `skills/sodax-<pkg>/{integration,migration-v1-to-v2}/knowledge/**/*.md` + each SDK package's README/AGENTS.md typechecks against `packages/<pkg>/src/index.ts`. Catches deleted / renamed exports. | `packages/<pkg>/src/index.ts` via fixture tsconfig `paths` | none |
| `check:ai-snippets` | Every fenced ts/tsx code block in `skills/sodax-{dapp-kit,wallet-sdk-react}/{integration,migration-v1-to-v2}/knowledge/**/*.md` typechecks against the real SDK. Catches call-shape drift. Pattern-style blocks can opt out with the marker; real working examples still validate. | same as imports, plus `_ai-snippets-fixture/_preamble.d.ts` ambients | `// @ai-snippets-skip` as first content line of the block |
| `check:ai-tsx-examples` | Every standalone `.tsx` file under `skills/sodax-<pkg>/integration/knowledge/examples/` typechecks as a complete module against the live `src/`. Catches export drift, hook-shape drift, and renamed-param drift in runnable user-facing examples. | each SDK package's `src/index.ts` (and `xchains/*` sub-paths for wallet-sdk-react) via fixture tsconfig `paths` | none — illustrative blocks live in `.md` via `@ai-snippets-skip`; `integration/knowledge/examples/` is for runnable code only |
| `check:ai-keys` | Every `queryKey: [...]` / `mutationKey: [...]` literal in `skills/sodax-dapp-kit/{integration,migration-v1-to-v2}/knowledge/**/*.md` has a matching prefix in `packages/dapp-kit/src/hooks/**/*.ts`. Catches `'stakingInfo'` vs `'info'`-style drift. | `packages/dapp-kit/src/hooks/**/*.ts` | `<!-- ai-keys-allow -->` or `// ai-keys-allow` within 3 preceding lines |
| `check:ai-consistency` | Every polling-interval claim ("polls 3s") near a `useFoo` mention matches the source `refetchInterval` for that hook. | same as keys | `<!-- ai-consistency-allow -->` within 6 preceding lines |
| `check:ai-safety` | No fenced code block under `skills/` (nor any standalone `.tsx` example) sends a zero minimum output (`minOutputAmount: 0n` and friends) or `skipSimulation: true`. Agents copy examples verbatim, so an unsafe example ships straight into user code; prose may still name the patterns. | this package's filesystem | `ai-safety-allow` in a comment on the same line |

Run individually for faster feedback: `pnpm run check:ai-imports`, `pnpm run check:ai-keys`, etc.

**Prose accuracy is gated separately.** An `AI Files Drift Check` workflow runs per pull request: it works out which knowledge files the changed source could invalidate, has a read-only agent compare the claims in them against that source, then re-reads each cited quote before letting any finding count. It flags a claim the current source disproves and warns when new public surface reaches no knowledge file. It is advisory until the `AI_DRIFT_ENFORCE` repository variable is set, and is not runnable locally — the guards above are what you run before pushing.

### Distribution

Two paths:

1. **GitHub-based via the [`skills` CLI](https://github.com/vercel-labs/skills)** (primary): `npx skills@latest add icon-project/sodax-sdks/packages/skills`. Drops skills into the consumer's repo through the CLI-supported agent targets.
2. **npm** (fallback for web chats / unsupported tools): `pnpm add -D @sodax/skills`. Consumers point their agent at `node_modules/@sodax/skills/AGENTS.md`.

The `files` field in `package.json` controls the npm-shipped surface (`.claude-plugin`, `skills`, `AGENTS.md`, `README.md`). Knowledge ships inside each skill, so it travels with `skills/`.

### Release

Published via `.github/workflows/sodax-skills-publish.yml`, triggered by `@sodax/skills@x.y.z` git tag (same convention as the other `@sodax/*` packages).
