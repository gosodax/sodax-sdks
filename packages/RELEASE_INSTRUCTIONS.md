# Releasing SDK packages

Every publishable `@sodax/*` package shares one version, cut as a single `@sdks@<version>` git tag.
`pnpm release` bumps the versions; committing, tagging, and publishing stay human steps.

1. **Merge everything you are shipping into `main`.**

2. **Sync `release`, then merge `main` into it.** A stale `release` bumps from the wrong base — the
   wrong version, with release notes measured against it — so do not skip the fetch or the ff-only
   pull. (`CONFIG_VERSION` itself is safe: it is derived from the version, not carried forward.)

   ```bash
   git checkout release
   git fetch origin --tags
   git pull --ff-only origin release
   git pull --no-ff origin main
   ```

3. **Run `pnpm release`.** It prints the current version, the tag the notes are measured from, and
   the commits grouped by conventional-commit type, then prompts for the new version — `X.Y.Z`, or
   `X.Y.Z-rc.N` for a release candidate. Picking the number is your call; use the groups it just
   printed. An invalid or non-advancing version is refused and re-prompted. Pass it as an argument
   (`pnpm release 2.2.0`) to skip the prompt.

4. **It stops after mutating.** Every manifest is set to that version, `CONFIG_VERSION` is derived
   from it, and the gitignored `release-notes.md` is written. Nothing is committed or
   tagged for you. On failure it prints the two cleanup commands — `git checkout -- packages/` and
   `rm -f release-notes.md` — but does not run them: a partial mutation stays on disk until you do.

5. **Inspect the diff, then commit and push.** The command prints these with the version filled in:

   ```bash
   git add packages/
   git commit -m "chore: release @sdks@<version>"
   git push -u origin release
   ```

6. **Create the GitHub Release** — the tag is what triggers publishing:

   For a stable release, replace the raw `release-notes.md` with curated notes first: the
   `changelog-from-prs` skill (`.claude/skills/changelog-from-prs/`) drafts them from the PRs merged
   since the previous stable tag.

   ```bash
   gh release create "@sdks@<version>" \
     --target release \
     --title "@sdks@<version>" \
     --notes-file release-notes.md \
     --prerelease # omit for a stable release
   ```

   [`sdks-publish.yml`](https://github.com/gosodax/sodax-sdks/blob/main/.github/workflows/sdks-publish.yml)
   runs in two jobs. **Verify** has no secrets: it checks every manifest against the tag, refuses an
   `@sdks@` tag whose commit is not on `release`, then builds, typechecks, tests and export-checks the
   packages and packs them. **Publish** waits for approval in the `npm-publish` environment, checks
   each tarball against the checksum Verify recorded, and publishes those exact files in dependency
   order. It never checks out or runs repository code. The dist-tag comes from the version:
   `X.Y.Z-rc.N` under `rc`, `X.Y.Z` under `latest`.

7. **Deprecate the new `@sodax/libs` version.** It ships for transitive installs only:

   ```bash
   npm deprecate @sodax/libs@<version> "Internal package — do not depend on directly. Consumed transitively by @sodax/sdk, @sodax/wallet-sdk-core, @sodax/wallet-sdk-react. Subpaths may be removed without notice when upstream Turbopack bugs are fixed."
   ```

8. **Announce** the npm links and notes in
   [Venture 23 #sodax-sdk](https://discord.com/channels/688963201101987847/1385504703672094760) and
   [Sodax #sodax_sdk](https://discord.com/channels/880651922682560582/1425075360550223994).

**If publishing fails partway, re-run the workflow.** Publish skips any package whose version is
already on npm, so a re-run ships only what is missing. npm never allows republishing a version, so
if a version that reached npm is itself wrong, cut a new version.

Publish authenticates only with npm trusted publishing (OIDC). Each package's trusted publisher on
npmjs.com names repository `gosodax/sodax-sdks`, workflow `sdks-publish.yml` and environment
`npm-publish`; a package without one cannot publish.

## What `pnpm release` refuses to do

It stops before changing anything if:

- you are not on `release`, or the working tree is dirty
- `origin/main` or `origin/release` is stale, or `main` is not fully merged into `release`
- your `release` is missing `origin/release` or the newest `@sdks@` tag
- the version was already published by an `@sodax/<pkg>@<version>` backport tag
- the package lists in `scripts/bump-versions.sh` and `sdks-publish.yml` have drifted from
  `packages/` — this is what stops a new package being versioned but never published, or the reverse

`scripts/bump-versions.sh` is the only thing that edits versions. Never hand-edit a package
`version` or `CONFIG_VERSION` — the latter is a pure function of the former
(`major * 1e6 + minor * 1e4 + patch * 100 + (rc ?? 99)`, see
[`packages/types/README.md`](types/README.md#config-version)), and three checks enforce it: `pnpm
release` asserts the landed value, `node scripts/config-version.mjs --check` runs in the publish
workflow before every release, and
`scripts/config-version.test.mjs` asserts it on every pull request.

One consequence worth knowing before you pick a number: the encoding caps minor and patch at 99 and
rc at 98, and has no 0.x range. `pnpm release` refuses anything outside that rather than shipping a
number that would collide with another release.

## Republishing a single package

Pushing the tag `@sodax/<pkg>@<version>` runs the same workflow for that one package, with the same
checks. Prefer the unified `@sdks@*` flow for normal releases so packages stay version-aligned.

**A release never moves `latest` backwards.** The workflow refuses a stable version lower than the
package's current `latest` on npm (for example `@sodax/sdk@2.1.1` while `latest` is `2.2.0`) before
anything is published, naming the package, the version and the current `latest`. A stable backport to
an older line therefore cannot be published through CI; ship the fix forward on the current line.
