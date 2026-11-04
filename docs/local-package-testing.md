# Testing `@sodax/*` packages locally from another project

`pnpm pack:local` builds the `@sodax/*` workspace packages into tarballs that install cleanly in a
project **outside** this repo — for trying an unreleased SDK change against a real consumer app
before it is published to npm.

```bash
pnpm pack:local --version 2.0.0-local.1 --packages @sodax/sdk
```

The run ends by printing a block ready to paste into the consuming project's `package.json`
`"dependencies"`:

```json
{
  "dependencies": {
    "@sodax/sdk": "file:/abs/path/to/sodax-sdks/pack-local-out/sodax-sdk-2.0.0-local.1.tgz"
  }
}
```

The same snippet, plus the re-packing notes below, is written to `HOW_TO_USE.md` next to the
tarballs.

## Why not plain `pnpm pack`

`pnpm pack` resolves `catalog:` correctly, but it also rewrites `workspace:*` to a plain version
number. A packed `@sodax/sdk` would then declare `"@sodax/types": "2.0.0-rc.17"` and pull that
package **from the npm registry** — silently mixing your local build with published dependencies,
or failing outright on a version that was never published.

`pack:local` packs the whole `@sodax` dependency closure and rewrites each intra-`@sodax`
dependency to an absolute `file:` path pointing at its sibling tarball, so the closure resolves
with no registry lookups. The paths are absolute because a relative `file:` inside a
tarball-installed dependency resolves inconsistently across npm, pnpm, and yarn — which also means
the tarballs are only valid on the machine that produced them.

## Options

| Option | Meaning |
| --- | --- |
| `--version <version>` | Version stamped onto every packed package. Required, must be valid semver. |
| `--stamp` | Append a UTC timestamp to `--version` so each run is a distinct version. |
| `--packages <names>` | Comma-separated entry packages (`@sodax/` prefix optional). Their `@sodax` dependencies are pulled in automatically. Defaults to every publishable workspace package. |
| `--out <dir>` | Output directory, relative to the repo root. Default `pack-local-out/` (git-ignored). |
| `--no-build` | Skip the turbo build and pack whatever is already in `dist/`. |
| `--no-clean` | Keep tarballs from previous runs instead of clearing the output directory first. |
| `--dry-run` | Print the resolved closure, and what cleanup would remove, without building, rewriting, or packing. |

Only entry packages need naming — `--packages @sodax/dapp-kit` also packs `sdk`, `libs`,
`swaps-api`, and `types`. Consumers likewise only need the entry package in their `package.json`;
the transitive `@sodax` packages come along on their own. Add them explicitly only if the project
imports from them directly.

## A run starts from a clean output directory

Every run clears the output directory before packing, so what is left afterwards is exactly one
closure at one version. Without that, output accumulates: tarballs for versions nobody installs any
more, and — the actual hazard — a tarball for a package that has since dropped out of the closure.
Each packed manifest points at its siblings by absolute `file:` path into this directory, so a
leftover sibling from an earlier build stays resolvable and can be installed next to freshly packed
ones.

Cleanup only removes what the script itself writes: `sodax-<package>-<version>.tgz` files and the
generated `HOW_TO_USE.md`. Anything else in the directory is left untouched, which matters because
`--out` can point anywhere. It runs **after** the build, so a failed build leaves the previous
tarballs intact and installable rather than emptying the directory.

Pass `--no-clean` to accumulate instead — useful when a consumer has several versions pinned at once.

## Re-packing

Package managers cache tarballs by path, so re-packing the **same** version to the **same** path
leaves the consumer installing the stale copy. Either use a fresh version each run:

```bash
pnpm pack:local --version 2.0.0-local.1 --stamp   # -> 2.0.0-local.1.20260801093000
```

or clear the consumer's install:

```bash
rm -rf node_modules && rm -f package-lock.json pnpm-lock.yaml yarn.lock && npm install
```

The script warns when it re-packs a version that already exists in the output directory.

## Notes

- The script rewrites `packages/*/package.json` in place while packing and restores the original
  bytes in a `finally` block and on `SIGINT`/`SIGTERM`. An interrupted run leaves the working tree
  clean.
- These versions are for local testing only. Never commit one, and never publish a `pack:local`
  tarball — real releases go through the release flow in
  [RELEASE_INSTRUCTIONS.md](../packages/RELEASE_INSTRUCTIONS.md).
